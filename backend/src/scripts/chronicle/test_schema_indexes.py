"""Native migrations retain the archive index used by map/timestamp queries."""
from src import database


def test_archive_index_covers_map_and_archived_at(postgres):
    with database.connect() as conn:
        row = conn.execute(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' "
            "AND tablename = 'map_chronicle_snapshots_archive' "
            "AND indexname = 'idx_map_chronicle_snapshots_archive_map'"
        ).fetchone()
    assert row is not None
    assert "(map_id, archived_at)" in row["indexdef"]
