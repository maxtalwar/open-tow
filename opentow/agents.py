from __future__ import annotations

from typing import Any

from .engine import validate_orders
from .models import GameState, Side


class DoctrineAgent:
    """Transparent baseline policy used for demos, tests, and agent benchmarking."""

    def __init__(self, side: Side):
        self.side = side

    def orders(self, state: GameState) -> list[dict[str, Any]]:
        proposals = self._blue_orders(state) if self.side == "BLUE" else self._red_orders(state)
        return validate_orders(state, self.side, proposals)

    def _red_orders(self, state: GameState) -> list[dict[str, Any]]:
        orders: list[dict[str, Any]] = []
        target = min(
            (base for base in state.bases.values() if base.side == "BLUE" and base.kind == "airbase"),
            key=lambda base: (base.damage, -base.capacity),
        )
        if state.munitions["RED"].get("tbm", 0) >= 10:
            orders.append({"type": "missile_strike", "target_id": target.id, "weapon": "tbm", "amount": 10})

        air_units = [u for u in state.units.values() if u.side == "RED" and u.domain == "air" and u.active]
        for unit in air_units:
            if unit.kind == "maritime_patrol":
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "asw", "target": "taiwan_strait"})
            elif unit.kind == "bomber" and state.munitions["RED"].get("ascm", 0) >= 6:
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "maritime_strike", "target": "philippine_sea", "weapon": "ascm", "amount": 6})
            else:
                target_region = "taiwan_strait" if unit.kind == "fighter_4g" else "taiwan"
                mission = "ground_support" if state.metrics["red_lodgment"] > 1 and unit.kind != "fighter_4g" else "cap"
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": mission, "target": target_region})

        naval_units = [u for u in state.units.values() if u.side == "RED" and u.domain == "naval" and u.active]
        for unit in naval_units:
            if unit.kind not in {"amphibious"}:
                orders.append({"type": "naval_mission", "unit_id": unit.id, "mission": "air_defense", "target": unit.region})

        subs = [u for u in state.units.values() if u.side == "RED" and u.domain == "submarine" and u.active]
        for unit in subs:
            mission = "barrier" if unit.kind == "diesel_submarine" else "hunt_shipping"
            target_region = "taiwan_strait" if mission == "barrier" else "philippine_sea"
            orders.append({"type": "submarine_mission", "unit_id": unit.id, "mission": mission, "target": target_region})

        amphibious = [u for u in naval_units if u.kind == "amphibious" and u.region == "taiwan_strait"]
        reserves = [g for g in state.ground_units.values() if g.side == "RED" and g.available]
        for transport, ground in zip(amphibious, reserves):
            capacity = transport.capacity * transport.readiness
            if capacity > 0.5:
                orders.append({"type": "amphibious_lift", "unit_id": transport.id, "ground_unit_id": ground.id,
                               "target": "west_beach" if transport.id.endswith("1") else "south_beach",
                               "insertion": "amphibious", "amount": round(capacity, 2)})
        if state.metrics["red_lodgment"] > 0.2:
            orders.append({"type": "ground_attack", "intensity": 0.75})
        return orders

    def _blue_orders(self, state: GameState) -> list[dict[str, Any]]:
        orders: list[dict[str, Any]] = []
        amphibious = [u for u in state.units.values() if u.side == "RED" and u.kind == "amphibious" and u.active]
        if state.munitions["BLUE"].get("mst", 0) >= 6 and amphibious:
            target = max(amphibious, key=lambda unit: unit.capacity)
            orders.append({"type": "missile_strike", "target_id": target.id, "weapon": "mst", "amount": 6})

        air_units = [u for u in state.units.values() if u.side == "BLUE" and u.domain == "air" and u.active]
        for unit in air_units:
            if unit.kind == "maritime_patrol":
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "asw", "target": "taiwan_strait"})
                continue
            if unit.kind == "bomber" and state.munitions["BLUE"].get("lrasm", 0) >= 6:
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "maritime_strike",
                               "target": "taiwan_strait", "weapon": "lrasm", "amount": 6})
            elif state.metrics["red_lodgment"] > 1:
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "ground_support", "target": "taiwan"})
            else:
                orders.append({"type": "air_mission", "unit_id": unit.id, "mission": "cap", "target": "taiwan"})

        for unit in [u for u in state.units.values() if u.side == "BLUE" and u.domain == "submarine" and u.active]:
            orders.append({"type": "submarine_mission", "unit_id": unit.id, "mission": "hunt_shipping", "target": "taiwan_strait"})

        for unit in [u for u in state.units.values() if u.side == "BLUE" and u.domain == "naval" and u.active]:
            if unit.region == "guam":
                orders.append({"type": "naval_move", "unit_id": unit.id, "target": "philippine_sea"})
                orders.append({"type": "naval_mission", "unit_id": unit.id, "mission": "asw", "target": "philippine_sea"})
            elif unit.search >= 0.9:
                orders.append({"type": "naval_mission", "unit_id": unit.id, "mission": "asw", "target": unit.region})
            else:
                orders.append({"type": "naval_mission", "unit_id": unit.id, "mission": "air_defense", "target": unit.region})
        orders.append({"type": "ground_attack", "intensity": 0.5})
        return orders


def agent_observation(state: GameState, side: Side) -> dict[str, Any]:
    """Stable observation envelope for LLM, scripted, and RL adapters."""
    visible = state.to_dict(observer=side)
    return {
        "game": {"scenario_id": state.scenario_id, "turn": state.turn, "max_turns": state.max_turns},
        "side": side,
        "state": visible,
        "objective": (
            "Deny a sustainable occupation of Taiwan through the scenario horizon."
            if side == "BLUE"
            else "Establish and sustain sufficient control to achieve an operational occupation."
        ),
    }
