from __future__ import annotations

import unittest

from opentow.engine import OrderError, resolve_turn, validate_orders
from opentow.scenario import load_scenario


class FidelityV2Tests(unittest.TestCase):
    def test_scenario_has_separate_operational_and_ground_scales(self) -> None:
        state = load_scenario()
        self.assertGreaterEqual(len(state.regions), 12)
        self.assertGreaterEqual(len(state.ground_hexes), 9)
        self.assertTrue(all("q" in region and "r" in region for region in state.regions.values()))
        self.assertTrue(any(ground_hex.get("beach") for ground_hex in state.ground_hexes.values()))

    def test_specific_weapon_inventory_is_consumed(self) -> None:
        state = load_scenario(seed=9)
        before = state.munitions["BLUE"]["mst"]
        resolve_turn(state, {
            "BLUE": [{"type": "missile_strike", "target_id": "red_amphib_1", "weapon": "mst", "amount": 4}],
            "RED": [],
        })
        self.assertEqual(state.munitions["BLUE"]["mst"], before - 4)
        self.assertGreater(state.munitions["BLUE"]["long_range"], 0)

    def test_air_mission_range_is_enforced(self) -> None:
        state = load_scenario()
        with self.assertRaisesRegex(OrderError, "cannot sustain"):
            validate_orders(state, "RED", [{
                "type": "air_mission", "unit_id": "red_air_4g_1", "mission": "cap", "target": "guam",
            }])

    def test_air_mission_rejects_non_air_deliverable_weapon(self) -> None:
        state = load_scenario()
        with self.assertRaisesRegex(OrderError, "not valid for strike_base"):
            validate_orders(state, "RED", [{
                "type": "air_mission", "unit_id": "red_bomber_1", "mission": "strike_base",
                "target": "ryukyus", "weapon": "tbm", "amount": 2,
            }])

    def test_ground_movement_uses_taiwan_adjacency(self) -> None:
        state = load_scenario()
        with self.assertRaisesRegex(OrderError, "movement allowance"):
            validate_orders(state, "BLUE", [{
                "type": "ground_order", "unit_id": "blue_north_bde", "mission": "move", "target": "kaohsiung",
            }])

    def test_unsustained_lodgment_loses_supply(self) -> None:
        state = load_scenario(seed=13)
        ground = state.ground_units["red_marine_bde"]
        ground.strength = 4.0
        ground.reserve_strength = 0.0
        ground.supply = 1.0
        for unit in state.units.values():
            if unit.kind == "amphibious":
                unit.capacity = 0.0
        resolve_turn(state, {"BLUE": [], "RED": []})
        self.assertLess(ground.supply, 1.0)
        self.assertTrue(any(event.phase == "LOGISTICS" for event in state.events))

    def test_submarine_rearms_only_at_home_port(self) -> None:
        state = load_scenario(seed=2)
        submarine = state.units["blue_sub_1"]
        submarine.region = "guam"
        submarine.weapons["torpedo"] = 0.0
        resolve_turn(state, {
            "BLUE": [{
                "type": "submarine_mission", "unit_id": submarine.id, "mission": "rearm", "target": "guam",
            }],
            "RED": [],
        })
        self.assertEqual(submarine.weapons["torpedo"], submarine.max_weapons["torpedo"])
        self.assertTrue(any(event.phase == "REARM" for event in state.events))


if __name__ == "__main__":
    unittest.main()
