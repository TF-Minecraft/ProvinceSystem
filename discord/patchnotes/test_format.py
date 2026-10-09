"""Pure checks for the Discord weekly message. No Discord install required."""

from __future__ import annotations

import unittest

import format as notes_format

DISCORD_LIMIT = notes_format.DISCORD_LIMIT
folders_message = notes_format.folders_message
postponement_message = notes_format.postponement_message
review_lines = notes_format.review_lines
review_notice = notes_format.review_notice
review_parts = notes_format.review_parts
updates_message = notes_format.updates_message
week_label = notes_format.week_label
week_page_url = notes_format.week_page_url
review_page_url = notes_format.review_page_url


class PostponementMessageTest(unittest.TestCase):
    def test_says_the_week_was_held(self) -> None:
        text = postponement_message("2026-W39")
        self.assertIn("postponed until next week", text)
        self.assertIn("Week of", text)
        self.assertLessEqual(len(text), DISCORD_LIMIT)


class WeekLabelTest(unittest.TestCase):
    def test_names_the_monday(self) -> None:
        self.assertEqual(week_label("2026-W01"), "Week of 29 December 2025")
        self.assertEqual(week_label("2026-W02"), "Week of 5 January 2026")

    def test_unknown_key_is_unchanged(self) -> None:
        self.assertEqual(week_label("this-week"), "this-week")


class UpdatesMessageTest(unittest.TestCase):
    def test_posts_highlights_and_leaves_technical_off_the_list(self) -> None:
        text = updates_message(
            "2026-W39",
            [
                {"section": "fixed", "body": "Fixed a door"},
                {"section": "new", "body": "Added a station"},
                {"section": "technical", "body": "Rebuilt a plugin", "deny_reason": "secret"},
                {"section": "adjusted", "body": "Lowered a price"},
            ],
            "https://www.tfminecraft.net/updates",
        )
        self.assertIn("**Highlights**\n• Added a station\n• Lowered a price", text)
        self.assertNotIn("Fixed a door", text)
        self.assertNotIn("Rebuilt a plugin", text)
        self.assertNotIn("secret", text)
        self.assertNotIn("**New**", text)
        self.assertIn("The full notes are on the site.", text)
        self.assertIn("https://www.tfminecraft.net/updates/2026-W39", text)
        self.assertEqual(text.count("• "), 2)
        self.assertNotIn("<@&", text)

    def test_a_marked_highlight_is_the_summary(self) -> None:
        text = updates_message(
            "2026-W39",
            [
                {"section": "adjusted", "body": "Mage gear now scales by ingot tier.", "highlight": True},
                {"section": "adjusted", "body": "Food recipes changed."},
            ],
            "https://www.tfminecraft.net/updates",
        )
        self.assertIn("• Mage gear now scales by ingot tier.", text)
        self.assertNotIn("Food recipes", text)
        self.assertIn("The full notes are on the site.", text)

    def test_mention_is_only_included_when_asked(self) -> None:
        text = updates_message(
            "2026-W39",
            [{"section": "new", "body": "Added a station"}],
            "https://www.tfminecraft.net/updates",
            mention="<@&1124721131165847682>",
        )
        self.assertTrue(text.startswith("<@&1124721131165847682>"))

    def test_long_week_stays_within_discord_and_keeps_the_link(self) -> None:
        bullets = [
            {"section": "new", "body": "Added a station " + ("x" * 400)}
            for _ in range(12)
        ]
        text = updates_message("2026-W39", bullets, "https://www.tfminecraft.net/updates")
        self.assertLessEqual(len(text), DISCORD_LIMIT)
        self.assertTrue(text.endswith("https://www.tfminecraft.net/updates/2026-W39"))
        self.assertIn("The full notes are on the site.", text)
        self.assertEqual(text.count("• "), notes_format.HEADLINES_PER_SECTION)


class WeekPageUrlTest(unittest.TestCase):
    def test_appends_the_week_to_the_landing_page(self) -> None:
        self.assertEqual(
            week_page_url("https://www.tfminecraft.net/updates", "2026-W39"),
            "https://www.tfminecraft.net/updates/2026-W39",
        )
        self.assertEqual(
            week_page_url("https://www.tfminecraft.net/updates/", "2026-W39"),
            "https://www.tfminecraft.net/updates/2026-W39",
        )
        self.assertEqual(
            week_page_url("https://www.tfminecraft.net/updates/2026-W39", "2026-W39"),
            "https://www.tfminecraft.net/updates/2026-W39",
        )

    def test_builds_the_staff_review_url(self) -> None:
        self.assertEqual(
            review_page_url("https://www.tfminecraft.net/updates/", "2026-W39"),
            "https://www.tfminecraft.net/updates/review?week=2026-W39",
        )


class ReviewMessageTest(unittest.TestCase):
    def test_embed_lists_player_sections_and_leaves_technical_off(self) -> None:
        text = review_lines(
            [
                {"section": "technical", "body": "Rebuilt a plugin"},
                {"section": "new", "body": "Custom masks can be skinned onto your character."},
                {"section": "fixed", "body": "Every scoop of a soup keeps its full food value."},
                {"section": "adjusted", "body": "Adjusted the cost of Ally."},
            ]
        )
        self.assertLess(text.index("**New**"), text.index("**Fixed**"))
        self.assertLess(text.index("**Fixed**"), text.index("**Adjusted**"))
        self.assertIn("• Custom masks can be skinned onto your character.", text)
        self.assertNotIn("Rebuilt a plugin", text)
        self.assertLessEqual(len(text), notes_format.REVIEW_DESCRIPTION_LIMIT)

    def test_marks_hidden_knowledge_and_omits_a_deny_reason(self) -> None:
        text = review_lines(
            [
                {
                    "section": "new",
                    "body": "Named a lore item",
                    "warning": "Lore items are hidden knowledge.",
                    "deny_reason": "custom masks can be submitted via token",
                }
            ]
        )
        self.assertIn("(hidden knowledge)", text)
        self.assertNotIn("submitted via token", text)

    def test_review_lines_stay_in_the_embed_and_count_overflow(self) -> None:
        bullets = [
            {"section": "fixed", "body": f"Fixed door {i:03d} " + ("x" * 50)}
            for i in range(70)
        ]
        notice = review_notice("2026-W39", page_url="https://www.tfminecraft.net/updates")
        content, description = review_parts(notice, bullets)
        self.assertLessEqual(len(content), DISCORD_LIMIT)
        self.assertLessEqual(len(description), notes_format.REVIEW_DESCRIPTION_LIMIT)
        self.assertIn("Read and edit every line here:", content)
        self.assertIn("Fixed door 000", description)
        self.assertNotIn("Fixed door 069", description)
        self.assertRegex(description, r"… \d+ more lines are on the review page\.")

    def test_a_long_week_stays_within_one_embed(self) -> None:
        bullets = [
            {"section": "fixed", "body": "Fixed a door " + ("x" * 80)}
            for _ in range(80)
        ]
        text = review_lines(bullets)
        self.assertLessEqual(len(text), notes_format.REVIEW_DESCRIPTION_LIMIT)
        self.assertRegex(text, r"… \d+ more lines are on the review page\.")

    def test_notice_says_one_deny_rewrites_the_note(self) -> None:
        text = review_notice(
            "2026-W39",
            mention="<@&1045375274528821318>",
            page_url="https://www.tfminecraft.net/updates",
        )
        self.assertIn("Deny once with everything that should change.", text)
        self.assertIn("It is not the new wording.", text)
        self.assertIn("<@&1045375274528821318>", text)
        self.assertLessEqual(len(text), DISCORD_LIMIT)

    def test_notice_has_section_counts_and_review_link(self) -> None:
        text = review_notice(
            "2026-W39",
            bullets=[
                {"section": "new"},
                {"section": "new"},
                {"section": "fixed"},
                {"section": "technical"},
            ],
            page_url="https://www.tfminecraft.net/updates",
        )
        self.assertIn("2 new, 1 fixed, 0 adjusted, 1 technical.", text)
        self.assertIn(
            "Read and edit every line here: https://www.tfminecraft.net/updates/review?week=2026-W39",
            text,
        )

    def test_a_rewrite_notice_does_not_ping_again(self) -> None:
        text = review_notice("2026-W39", rewritten=True)
        self.assertIn("Rewritten from that feedback.", text)
        self.assertNotIn("<@&", text)
        self.assertNotIn("Deny once", text)


class FoldersMessageTest(unittest.TestCase):
    def test_groups_repo_content_and_added_folders(self) -> None:
        text = folders_message(
            [
                {"name": "Cooking", "origin": "repo", "status": "active", "sync_task": True},
                {
                    "name": "MythicDungeons",
                    "origin": "content",
                    "status": "active",
                    "dangerous": True,
                },
                {"name": "Essentials", "origin": "added", "status": "pending"},
                {
                    "name": "LuckPerms",
                    "origin": "added",
                    "status": "rejected",
                    "reject_reason": "Nothing in that folder is safe to track",
                },
            ]
        )
        self.assertIn("**GitHub plugins**", text)
        self.assertIn("Cooking — watching — GitHub update queued", text)
        self.assertIn("MythicDungeons — watching — notes stay vague", text)
        self.assertNotIn("secretmaze", text)
        self.assertIn("Essentials — checking", text)
        self.assertIn("Nothing in that folder is safe to track", text)
        self.assertLessEqual(len(text), DISCORD_LIMIT)


class WeeklyPostTest(unittest.TestCase):
    POST = {"label": "5.3", "act": None, "messages": ["# Update 5.3\nHi", "# 🔧 Fixes\n- One"], "source": "writer"}

    def test_title_names_the_act_on_act_weeks(self) -> None:
        self.assertEqual(notes_format.post_title(self.POST), "Update 5.3")
        self.assertEqual(notes_format.post_title({**self.POST, "act": "Act 1"}), "Act 1 (Update 5.3)")

    def test_ping_goes_in_front_of_the_first_message_only(self) -> None:
        messages = notes_format.post_messages(self.POST, "<@&42>")
        self.assertEqual(messages, ["<@&42>\n# Update 5.3\nHi", "# 🔧 Fixes\n- One"])
        self.assertEqual(notes_format.post_messages(self.POST), self.POST["messages"])

    def test_ping_gets_its_own_message_when_it_would_overflow(self) -> None:
        full = {**self.POST, "messages": ["x" * DISCORD_LIMIT]}
        self.assertEqual(notes_format.post_messages(full, "<@&42>"), ["<@&42>", "x" * DISCORD_LIMIT])

    def test_review_notice_explains_a_fallback(self) -> None:
        notice = notes_format.post_review_notice("2026-W41", {**self.POST, "source": "fallback"}, mention="<@&7>")
        self.assertTrue(notice.startswith("<@&7>\n**Update 5.3** for Week of 5 October 2026 is ready to review."))
        self.assertIn("plain list from the server changes", notice)
        self.assertLessEqual(len(notice), DISCORD_LIMIT)

    def test_test_copy_says_nothing_was_posted(self) -> None:
        notice = notes_format.post_test_notice("2026-W41", self.POST)
        self.assertTrue(notice.startswith("# 🧪 Test: Update 5.3"))
        self.assertIn("nobody was pinged", notice)
        self.assertIn("no buttons", notice)


if __name__ == "__main__":
    unittest.main()
