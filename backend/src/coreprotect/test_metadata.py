import base64
import json
from pathlib import Path

import pytest

from src.coreprotect import metadata
from src.coreprotect.test_activity import read

FIXTURES = {k: base64.b64decode(v) for k, v in json.loads(
    Path(__file__).with_name('testdata').joinpath('metadata.json').read_text()).items()}


@pytest.mark.parametrize('fixture,expected', [
    ('guava', 'Mythril Ingot [MMOItems MATERIALS:MYTHRIL_INGOT]'),
    ('mythril', 'Mythril Ingot [MMOItems MATERIALS:MYTHRIL_INGOT]'),
    ('alloy', 'Mythril-Steel Alloy [MMOItems CRAFTING:ALLOY]'),
    ('renamed', 'iron_ingot (renamed: Mythril Ingot)'),
    ('no_name', 'Coke [MMOItems MATERIALS:COKE]'),
    ('unicode', '🔥 Coke [MMOItems MATERIALS:COKE]'),
    ('vanilla', 'iron_ingot'),
    ('cycle', 'iron_ingot'),
])
def test_item_labels_from_java_streams(fixture, expected):
    assert metadata.item_label(FIXTURES[fixture], 'iron_ingot') == expected


def test_mob_identity_and_historical_named_mobs():
    assert metadata.mob_label(FIXTURES['mob'], FIXTURES['mythic'], 'zombie') == 'Cursed Ghoul [MythicMobs cursed_ghoul]'
    assert metadata.mob_label(FIXTURES['mob'], None, 'zombie') == 'zombie (named: Cursed Ghoul)'
    assert metadata.mob_label(FIXTURES['mob'], FIXTURES['wrong_marker'], 'zombie') == 'zombie (named: Cursed Ghoul)'
    assert metadata.mob_label(None, FIXTURES['mythic'], 'zombie') == 'Cursed Ghoul [MythicMobs cursed_ghoul]'


def test_malformed_and_oversized_data_falls_back():
    for data in (None, b'', b'x' * (metadata.MAX_BLOB + 1), b'\xac\xed\0\x05\x71\x00\x7e\xff\xff'):
        assert metadata.item_label(data, 'iron_ingot') == 'iron_ingot'
    for end in range(len(FIXTURES['mythril'])):
        assert metadata.item_label(FIXTURES['mythril'][:end], 'iron_ingot') == 'iron_ingot'


def test_decompression_and_depth_limits():
    import gzip
    encoded = base64.b64encode(gzip.compress(b'x' * (metadata.MAX_EXPANDED + 1))).decode()
    with pytest.raises(ValueError, match='expansion limit'):
        metadata._custom(encoded)
    # Nested named NBT compounds hit the depth limit, independent of input bytes.
    stream = metadata._Nbt((b'\x0a\x00\x00' * 40) + b'\0' * 41)
    with pytest.raises(ValueError, match='metadata limit'):
        stream.read(10)


def test_page_labels_include_containers_and_kills_without_raw_data(coreprotect):
    me = coreprotect.user('Hazel', '0615a817-8cb4-4aef-95f7-f6c9bf7611b8')
    item = coreprotect.item(me, 4, 3)
    chest = coreprotect.container(me, 3, 1)
    entity_chest = coreprotect.execute(
        'INSERT INTO co_entity_container (time,user,wid,x,y,z,type,amount,action,metadata,entity_spawn_rowid) '
        'VALUES (2,?,1,0,0,0,3,2,1,?,1)', (me, FIXTURES['alloy']))
    entity = coreprotect.execute('INSERT INTO co_entity (time,data) VALUES (1,?)', (FIXTURES['mob'],))
    kill = coreprotect.block(me, 1, 3, type_id=1, data=entity)
    coreprotect.execute('UPDATE co_item SET data=? WHERE rowid=?', (FIXTURES['mythril'], item))
    coreprotect.execute('UPDATE co_container SET metadata=? WHERE rowid=?', (FIXTURES['renamed'], chest))
    coreprotect.execute('UPDATE co_block SET meta=? WHERE rowid=?', (FIXTURES['mythic'], kill))
    entries = read(coreprotect, [me])['entries']
    assert [e['target'] for e in entries] == [
        'Mythril Ingot [MMOItems MATERIALS:MYTHRIL_INGOT]',
        'iron_ingot (renamed: Mythril Ingot)',
        'Mythril-Steel Alloy [MMOItems CRAFTING:ALLOY]',
        'Cursed Ghoul [MythicMobs cursed_ghoul]',
    ]
    text = json.dumps(entries)
    assert 'private' not in text and 'blob' not in text and 'never exposed' not in text
    first = read(coreprotect, [me], limit=1)
    second = read(coreprotect, [me], before=first['next'], limit=1)
    assert first['entries'][0]['id'] != second['entries'][0]['id']


def test_metadata_queries_only_read_final_page(coreprotect, monkeypatch):
    from src.coreprotect.reader import Reader
    me = coreprotect.user('Hazel', '0615a817-8cb4-4aef-95f7-f6c9bf7611b8')
    for t in range(20):
        coreprotect.item(me, t, 3)
    fetched = []
    original = Reader.rows
    def capture(self, sql, params=()):
        if 'AS blob' in sql:
            fetched.append((sql, params))
        return original(self, sql, params)
    monkeypatch.setattr(Reader, 'rows', capture)
    read(coreprotect, [me], limit=2)
    assert len(fetched) == 1
    assert len(fetched[0][1]) == 3  # byte limit plus exactly two rowids
    assert 'CASE WHEN length(data)' in fetched[0][0]


def test_mob_fields_fail_independently():
    assert metadata.mob_label(b"invalid", FIXTURES['mythic'], 'zombie') == 'Cursed Ghoul [MythicMobs cursed_ghoul]'
    assert metadata.mob_label(FIXTURES['mob'], b"invalid", 'zombie') == 'zombie (named: Cursed Ghoul)'


@pytest.mark.parametrize('name', ['[Boss] Cursed Ghoul', '{Boss} Ghoul', '"Ghoul"', '[1]'])
def test_legacy_mob_names_are_literal(name):
    assert metadata.clean_name(name) == name
    assert metadata.clean_name('[Boss] Ghoul', component=True) == '[Boss] Ghoul'
