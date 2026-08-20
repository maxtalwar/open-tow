from __future__ import annotations

import unittest

from opentow.engine import resolve_turn
from opentow.scenario import load_scenario


class MaritimeStrikeTests(unittest.TestCase):
    def test_maritime_strike_damages_hostile_surface_force(self) -> None:
        state = load_scenario(seed=17)
        state.units["blue_bomber_1"].region = "taiwan_strait"
        state.units["blue_bomber_1"].base_id = None
        before = state.units["red_amphib_1"].strength
        resolve_turn(state, {
            "BLUE": [{
                "type": "air_mission",
                "unit_id": "blue_bomber_1",
                "mission": "maritime_strike",
                "target": "taiwan_strait",
            }],
            "RED": [],
        })
        self.assertLess(state.units["red_amphib_1"].strength, before)
        self.assertTrue(any(event.phase == "MARITIME_STRIKE" for event in state.events))


if __name__ == "__main__":
    unittest.main()

