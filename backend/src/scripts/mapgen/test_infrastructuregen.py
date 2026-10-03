import unittest

from .infrastructuregen import (
    INFRASTRUCTURE_COLOR_STOPS,
    infrastructure_to_color,
)


class InfrastructureColorTests(unittest.TestCase):
    def test_color_stops_and_clamping(self) -> None:
        self.assertEqual(infrastructure_to_color(0.30), INFRASTRUCTURE_COLOR_STOPS[0])
        self.assertEqual(infrastructure_to_color(0.525), INFRASTRUCTURE_COLOR_STOPS[1])
        self.assertEqual(infrastructure_to_color(0.75), INFRASTRUCTURE_COLOR_STOPS[2])
        self.assertEqual(infrastructure_to_color(0.1), INFRASTRUCTURE_COLOR_STOPS[0])
        self.assertEqual(infrastructure_to_color(0.9), INFRASTRUCTURE_COLOR_STOPS[2])

    def test_bad_values_have_no_color(self) -> None:
        for value in (None, "0.4", float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertIsNone(infrastructure_to_color(value))


if __name__ == "__main__":
    unittest.main()
