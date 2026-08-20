from __future__ import annotations

import copy
import json
import unittest

from opentow.agents import DoctrineAgent, agent_observation
from opentow.engine import OrderError, resolve_turn, validate_orders
from opentow.scenario import load_scenario


class EngineTests(unittest.TestCase):
    def test_same_seed_and_orders_are_deterministic(self) -> None:
        first = load_scenario(seed=41)
        second = load_scenario(seed=41)
        first_orders = {
            "BLUE": DoctrineAgent("BLUE").orders(first),
            "RED": DoctrineAgent("RED").orders(first),
        }
        second_orders = copy.deepcopy(first_orders)
        resolve_turn(first, first_orders)
        resolve_turn(second, second_orders)
        self.assertEqual(
            json.dumps(first.to_dict(), sort_keys=True),
            json.dumps(second.to_dict(), sort_keys=True),
        )

    def test_hostile_unit_cannot_be_ordered(self) -> None:
        state = load_scenario()
        with self.assertRaises(OrderError):
            validate_orders(state, "BLUE", [{
                "type": "air_mission",
                "unit_id": "red_air_5g_1",
                "mission": "cap",
                "target": "taiwan",
            }])

    def test_missile_overspend_is_rejected(self) -> None:
        state = load_scenario()
        with self.assertRaises(OrderError):
            validate_orders(state, "BLUE", [{
                "type": "missile_strike",
                "target_id": "red_fujian",
                "amount": state.munitions["BLUE"]["long_range"] + 1,
            }])

    def test_nonadjacent_surface_move_is_rejected(self) -> None:
        state = load_scenario()
        with self.assertRaises(OrderError):
            validate_orders(state, "BLUE", [{
                "type": "naval_move",
                "unit_id": "blue_sag_1",
                "target": "taiwan_strait",
            }])

    def test_hidden_enemy_strength_is_filtered(self) -> None:
        state = load_scenario()
        observation = agent_observation(state, "BLUE")
        self.assertIsNone(observation["state"]["units"]["red_sub_1"]["strength"])
        self.assertEqual(observation["state"]["units"]["blue_sub_1"]["strength"], 4.0)

    def test_amphibious_lift_creates_lodgment(self) -> None:
        state = load_scenario(seed=3)
        resolve_turn(state, {
            "BLUE": [],
            "RED": [
                {"type": "amphibious_lift", "unit_id": "red_amphib_1", "amount": 8},
                {"type": "ground_attack", "intensity": 0.5},
            ],
        })
        self.assertGreater(state.metrics["red_lodgment"], 0)

    def test_doctrine_agents_complete_campaign(self) -> None:
        state = load_scenario(seed=7)
        while state.status == "ACTIVE":
            resolve_turn(state, {
                "BLUE": DoctrineAgent("BLUE").orders(state),
                "RED": DoctrineAgent("RED").orders(state),
            })
        self.assertIn(state.winner, {"BLUE", "RED", "DRAW"})
        self.assertEqual(len(state.orders_history), state.max_turns)


if __name__ == "__main__":
    unittest.main()

