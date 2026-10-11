"""Skin ids that would clash with the site's own addresses."""

import pytest

from src.skins.naming import SlugError, build_staff_submission_id, build_submission_id


def test_a_staff_skin_cannot_take_the_editor_address():
    with pytest.raises(SlugError):
        build_staff_submission_id("New")
    assert build_staff_submission_id("New", "dev") == "dev_new"
    assert build_staff_submission_id("New Moon") == "new_moon"


def test_player_skins_called_new_keep_their_name_prefix():
    assert build_submission_id("Steve", "New") == "steve_new"
