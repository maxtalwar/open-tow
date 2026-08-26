from __future__ import annotations

import unittest

from opentow.engine import resolve_turn
from opentow.engine import OrderError, validate_orders
from opentow.scenario import load_scenario


class MaritimeStrikeTests(unittest.TestCase):
    def test_nonadjacent_submarine_move_is_rejected(self) -> None:
        state = load_scenario()
        state.units["red_sub_2"].mobility = 1
        with self.assertRaises(OrderError):
            validate_orders(state, "RED", [{
                "type": "submarine_mission", "unit_id": "red_sub_2",
                "mission": "hunt_shipping", "target": "guam",
            }])

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
