"""Tests for writing the weekly Discord post from a week's facts."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes import compose  # noqa: E402
from patchnotes.feedback import FeedbackError  # noqa: E402

_FACTS = {
    "plugins": [
        {
            "plugin": "rpcharacters",
            "repo": "RPCharacters",
            "old": "2.11.0",
            "new": "2.12.6",
            "commits": [
                "Make armour take time to put on",
                "fix: stop knocked-out players dying",
                "Fix activity recovery and enforce 100% line coverage in the API",
            ],
        }
    ],
    "files": [
        {
            "path": "MMOCore/classes/juggernaut.yml",
            "plugin": "MMOCore",
            "kind": "changed",
            "entries": [
                {
                    "name": "Juggernaut",
                    "kind": "changed",
                    "details": ["attributes.max_health.base: 30 --> 28"],
                }
            ],
        }
    ],
    "hidden": {"Codex": 3},
}


class PromptTest(unittest.TestCase):
    def test_week_line_names_the_monday(self) -> None:
        self.assertEqual(compose.week_line("2026-W41"), "Week of 5 October 2026")

    def test_prompt_carries_the_style_and_the_facts(self) -> None:
        prompt = compose.compose_prompt(
            _FACTS, week="2026-W41", label="5.3", act=None, page_url="https://example.net/updates"
        )
        self.assertIn("Start with `# Update 5.3`.", prompt)
        self.assertIn("-# Week of 5 October 2026", prompt)
        self.assertIn("<https://example.net/updates/2026-W41>", prompt)
        self.assertIn("# Balance Changes", prompt)
        self.assertNotIn("⚔", prompt)
        self.assertIn("- Juggernaut (changed): attributes.max_health.base: 30 --> 28", prompt)
        self.assertIn("  - Make armour take time to put on", prompt)
        self.assertIn("- Codex: 3 changed entries", prompt)
        self.assertNotIn("Staff feedback", prompt)

    def test_act_weeks_are_titled_with_the_act(self) -> None:
        prompt = compose.compose_prompt(_FACTS, week="2026-W41", label="5.3", act="Act 1", page_url="x")
        self.assertIn("start with `# Act 1`, then `## Update 5.3`", prompt)

    def test_feedback_rewrites_the_current_post(self) -> None:
        prompt = compose.compose_prompt(
            _FACTS, week="2026-W41", label="5.3", act=None, page_url="x",
            previous=["# Update 5.3"], feedback="Explain the armour change better.",
        )
        self.assertIn('["# Update 5.3"]', prompt)
        self.assertIn("Explain the armour change better.", prompt)

    def test_facts_are_trimmed_to_the_budget(self) -> None:
        text = compose.render_facts(_FACTS, budget=80)
        self.assertLessEqual(len(text), 130)
        self.assertTrue(text.endswith("(more changes were left out to fit)"))


class MessagesTest(unittest.TestCase):
    def test_mentions_dashes_and_fences_are_cleaned(self) -> None:
        messages = compose.messages_from_response(
            {"messages": ["```\n# Update 5.3\nHi @everyone <@&123> — enjoy\n```", "  "]}
        )
        self.assertEqual(messages, ["# Update 5.3\nHi , enjoy"])

    def test_emojis_are_removed(self) -> None:
        messages = compose.messages_from_response(
            {"messages": ["# ⚔️ Balance Changes\n- **Health:** 20 --> 22 ✅\n-# \U0001f527 Fixes → soon"]}
        )
        self.assertEqual(messages, ["# Balance Changes\n- **Health:** 20 --> 22\n-# Fixes → soon"])

    def test_clock_and_media_emojis_are_removed_but_technical_symbols_stay(self) -> None:
        self.assertEqual(compose.clean_message("⏰ Cooldown 10 --> 8 ⌛ ⏩"), "Cooldown 10 --> 8")
        self.assertEqual(compose.clean_message("Press ⌘ then ⏎"), "Press ⌘ then ⏎")

    def test_plain_symbols_stay(self) -> None:
        text = "- C♯ balance changes ★ ✓ → done"
        self.assertEqual(compose.clean_message(text), text)
        self.assertEqual(compose.clean_message("⚔️ Duels and ⭐ stars"), "Duels and stars")
        self.assertEqual(compose.clean_message("- a\n  - nested"), "- a\n  - nested")

    def test_unsafe_lines_are_dropped(self) -> None:
        messages = compose.messages_from_response(
            {"messages": ["# Fixes\n- Found the lore item at the old mill\n- Fixed knockouts"]}
        )
        self.assertEqual(messages, ["# Fixes\n- Fixed knockouts"])

    def test_long_messages_are_split_at_headings(self) -> None:
        body = "# Balance\n" + "- line\n" * 300 + "# Fixes\n- one\n"
        messages = compose.messages_from_response({"messages": [body]})
        self.assertGreater(len(messages), 1)
        self.assertLessEqual(len(messages[0]), compose.FIRST_LIMIT)
        self.assertTrue(all(len(message) <= compose.DISCORD_LIMIT for message in messages))
        self.assertTrue(messages[-1].endswith("- one"))

    def test_busy_weeks_may_run_past_the_target_but_not_the_cap(self) -> None:
        prompt = compose.compose_prompt(_FACTS, week="2026-W41", label="5.3", act=None, page_url="x")
        self.assertIn(f"at most {compose.TARGET_MESSAGES} messages", prompt)
        twelve = [f"# Part {n}\n- line" for n in range(12)]
        self.assertEqual(len(compose.messages_from_response({"messages": twelve})), 12)
        too_many = [f"# Part {n}\n- line" for n in range(compose.MAX_MESSAGES + 1)]
        with self.assertRaises(FeedbackError):
            compose.messages_from_response({"messages": too_many})

    def test_empty_or_missing_posts_fail(self) -> None:
        with self.assertRaises(FeedbackError):
            compose.messages_from_response({"messages": ["   "]})
        with self.assertRaises(FeedbackError):
            compose.messages_from_response({"text": "hi"})


class FallbackTest(unittest.TestCase):
    def test_plain_post_from_the_facts(self) -> None:
        messages = compose.fallback_messages(
            _FACTS, week="2026-W41", label="5.3", act=None, page_url="https://example.net/updates"
        )
        text = "\n".join(messages)
        self.assertTrue(text.startswith("# Update 5.3\n-# Week of 5 October 2026"))
        self.assertIn("- Make armour take time to put on", text)
        self.assertIn("- Stop knocked-out players dying", text)
        self.assertNotIn("coverage", text)
        self.assertIn("- **Juggernaut:** max health base: 30 --> 28", text)
        self.assertIn("new things to discover", text)
        self.assertIn("<https://example.net/updates/2026-W41>", text)
        self.assertNotIn("Codex", text)


if __name__ == "__main__":
    unittest.main()
