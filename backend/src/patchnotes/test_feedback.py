"""Staff feedback edits a week's note without pasting the feedback in."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_BACKEND_SRC = Path(__file__).resolve().parents[1]
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from patchnotes.feedback import FeedbackError, interpret_feedback  # noqa: E402

_SOUP = {
    "id": "soup",
    "section": "adjusted",
    "body": "Every scoop of soup keeps its food value.",
}
_MASKS = {"id": "masks", "section": "new", "body": "Masks can be worn by pets."}
_BOWLS = {"id": "bowls", "section": "fixed", "body": "Bowls are returned after eating."}


def _reply(payload: dict) -> str:
    return json.dumps(payload)


class FeedbackInterpretationTest(unittest.TestCase):
    def test_feedback_is_not_pasted_in_as_the_line(self) -> None:
        feedback = "Make the soup line shorter and less specific."
        edits = interpret_feedback(
            [_SOUP],
            feedback,
            complete=lambda _system, _user: _reply(
                {
                    "lines": [
                        {
                            "id": "soup",
                            "action": "rewrite",
                            "section": "adjusted",
                            "body": feedback,
                        }
                    ]
                }
            ),
        )
        self.assertEqual(edits, [])

    def test_several_lines_can_change_and_the_rest_stay(self) -> None:
        edits = interpret_feedback(
            [_SOUP, _MASKS, _BOWLS],
            "The soup line is too specific, and don't post the masks line.",
            complete=lambda _system, _user: _reply(
                {
                    "lines": [
                        {
                            "id": "soup",
                            "action": "rewrite",
                            "section": "adjusted",
                            "body": "Soup keeps its food value.",
                        },
                        {"id": "masks", "action": "drop"},
                        {"id": "bowls", "action": "keep"},
                    ]
                }
            ),
        )
        self.assertEqual(
            edits,
            [
                {
                    "id": "soup",
                    "action": "rewrite",
                    "section": "adjusted",
                    "body": "Soup keeps its food value.",
                },
                {"id": "masks", "action": "drop"},
            ],
        )

    def test_a_secret_rewrite_is_left_out(self) -> None:
        edits = interpret_feedback(
            [_SOUP],
            "Say what the key is.",
            complete=lambda _system, _user: _reply(
                {
                    "lines": [
                        {
                            "id": "soup",
                            "action": "rewrite",
                            "section": "adjusted",
                            "body": "The api_key=supersecretvalue is on the server.",
                        }
                    ]
                }
            ),
        )
        self.assertEqual(edits, [])

    def test_unreadable_reply_is_an_error(self) -> None:
        with self.assertRaises(FeedbackError):
            interpret_feedback(
                [_SOUP],
                "Make it shorter.",
                complete=lambda _system, _user: "I would shorten the soup line.",
            )

    def test_a_requested_line_can_be_added(self) -> None:
        edits = interpret_feedback(
            [_BOWLS],
            "Also say that baby animals grow up.",
            complete=lambda _system, _user: _reply(
                {
                    "lines": [{"id": "bowls", "action": "keep"}],
                    "add": [{"section": "new", "body": "Baby animals grow up."}],
                }
            ),
        )
        self.assertEqual(
            edits,
            [{"action": "add", "section": "new", "body": "Baby animals grow up."}],
        )


if __name__ == "__main__":
    unittest.main()
