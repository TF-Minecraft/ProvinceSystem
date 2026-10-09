"""Friday review and publish deadlines. No Discord install required."""

from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import schedule

BERLIN = ZoneInfo("Europe/Berlin")


class DeadlineTest(unittest.TestCase):
    def test_review_opens_at_friday_noon(self) -> None:
        self.assertFalse(
            schedule.review_due("2026-W39", datetime(2026, 9, 25, 11, 59, tzinfo=BERLIN), BERLIN)
        )
        self.assertTrue(
            schedule.review_due("2026-W39", datetime(2026, 9, 25, 12, 0, tzinfo=BERLIN), BERLIN)
        )

    def test_publish_opens_at_friday_evening(self) -> None:
        noon = datetime(2026, 9, 25, 12, 0, tzinfo=BERLIN)
        evening = datetime(2026, 9, 25, 18, 0, tzinfo=BERLIN)
        self.assertFalse(schedule.publish_due("2026-W39", noon, BERLIN))
        self.assertTrue(schedule.publish_due("2026-W39", evening, BERLIN))

    def test_previous_week_crosses_the_year(self) -> None:
        self.assertEqual(schedule.previous_week("2026-W01"), "2025-W52")

    def test_friday_noon_opens_the_next_note_week(self) -> None:
        self.assertEqual(
            schedule.note_week(datetime(2026, 9, 25, 11, 59, tzinfo=BERLIN), BERLIN),
            "2026-W39",
        )
        self.assertEqual(
            schedule.note_week(datetime(2026, 9, 25, 12, 0, tzinfo=BERLIN), BERLIN),
            "2026-W40",
        )

    def test_commands_stay_on_the_unreleased_week_after_noon(self) -> None:
        during = datetime(2026, 9, 25, 15, 0, tzinfo=BERLIN)
        self.assertEqual(schedule.note_week(during, BERLIN), "2026-W40")
        self.assertEqual(
            schedule.held_review_week(
                during, BERLIN, released=False, postponed=False, has_notes=True
            ),
            "2026-W39",
        )
        self.assertEqual(
            schedule.held_review_week(
                during, BERLIN, released=True, postponed=False, has_notes=True
            ),
            "2026-W40",
        )
        self.assertEqual(
            schedule.held_review_week(
                during, BERLIN, released=False, postponed=True, has_notes=True
            ),
            "2026-W40",
        )
        self.assertEqual(
            schedule.held_review_week(
                during, BERLIN, released=False, postponed=False, has_notes=False
            ),
            "2026-W40",
        )

    def test_a_missed_release_stays_selected_into_the_next_week(self) -> None:
        monday = datetime(2026, 9, 28, 10, 0, tzinfo=BERLIN)
        self.assertEqual(
            schedule.held_review_week(
                monday, BERLIN, released=False, postponed=False, has_notes=True
            ),
            "2026-W39",
        )
        self.assertEqual(
            schedule.held_review_week(
                monday, BERLIN, released=True, postponed=False, has_notes=True
            ),
            "2026-W40",
        )

    def test_next_week_is_not_due_on_this_friday(self) -> None:
        during_review = datetime(2026, 9, 25, 15, 0, tzinfo=BERLIN)
        self.assertFalse(schedule.review_due("2026-W40", during_review, BERLIN))
        self.assertFalse(schedule.publish_due("2026-W40", during_review, BERLIN))


if __name__ == "__main__":
    unittest.main()
