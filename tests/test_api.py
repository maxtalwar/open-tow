from __future__ import annotations

import unittest

from opentow.api import GameService


class ApiServiceTests(unittest.TestCase):
    def test_reset_changes_seed(self) -> None:
        service = GameService()
        result = service.reset(99)
        self.assertEqual(result["seed"], 99)
        self.assertEqual(result["turn"], 1)

    def test_agent_turn_advances_game(self) -> None:
        service = GameService()
        service.reset(5)
        result = service.agent_turn()
        self.assertEqual(result["turn"], 2)
        self.assertGreater(len(result["events"]), 0)

    def test_human_turn_uses_observer_filter(self) -> None:
        service = GameService()
        result = service.human_turn("BLUE", [])
        self.assertIsNone(result["units"]["red_sub_1"]["strength"])


if __name__ == "__main__":
    unittest.main()

