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
        missiles = state.munitions["RED"]["long_range"]
        target = min(
            (base for base in state.bases.values() if base.side == "BLUE"),
            key=lambda base: (base.damage, -base.capacity),
        )
        if missiles >= 10:
            orders.append({"type": "missile_strike", "target_id": target.id, "amount": min(20, missiles)})

        air_units = [u for u in state.units.values() if u.side == "RED" and u.domain == "air" and u.active]
        for index, unit in enumerate(air_units):
            mission = "cap" if index % 3 != 2 else ("ground_support" if state.metrics["red_lodgment"] > 1 else "maritime_strike")
            orders.append({"type": "air_mission", "unit_id": unit.id, "mission": mission, "target": "taiwan" if mission != "maritime_strike" else "philippine_sea"})

        naval_units = [u for u in state.units.values() if u.side == "RED" and u.domain == "naval" and u.active]
        for unit in naval_units:
            if unit.region != "taiwan_strait" and "taiwan_strait" in state.regions[unit.region]["adjacent"]:
                orders.append({"type": "naval_move", "unit_id": unit.id, "target": "taiwan_strait"})

        subs = [u for u in state.units.values() if u.side == "RED" and u.domain == "submarine" and u.active]
        for unit in subs:
            orders.append({"type": "submarine_patrol", "unit_id": unit.id, "target": "philippine_sea"})

        amphibious = [u for u in naval_units if u.kind == "amphibious" and u.region == "taiwan_strait"]
        capacity = sum(u.capacity * u.readiness for u in amphibious)
        if amphibious and capacity > 0.5:
            orders.append({"type": "amphibious_lift", "unit_id": amphibious[0].id, "amount": round(capacity, 2)})
        if state.metrics["red_lodgment"] > 0.2:
            orders.append({"type": "ground_attack", "intensity": 0.75})
        return orders

    def _blue_orders(self, state: GameState) -> list[dict[str, Any]]:
        orders: list[dict[str, Any]] = []
        missiles = state.munitions["BLUE"]["long_range"]
        amphibious = [u for u in state.units.values() if u.side == "RED" and u.kind == "amphibious" and u.active]
        if missiles >= 10 and amphibious:
            target = max(amphibious, key=lambda unit: unit.capacity)
            orders.append({"type": "missile_strike", "target_id": target.id, "amount": min(15, missiles)})

        air_units = [u for u in state.units.values() if u.side == "BLUE" and u.domain == "air" and u.active]
        for index, unit in enumerate(air_units):
            if unit.kind == "bomber":
                mission, target = "maritime_strike", "taiwan_strait"
            elif index % 3 == 0 and state.metrics["red_lodgment"] > 1:
                mission, target = "ground_support", "taiwan"
            else:
                mission, target = "cap", "taiwan"
            orders.append({"type": "air_mission", "unit_id": unit.id, "mission": mission, "target": target})

        for unit in [u for u in state.units.values() if u.side == "BLUE" and u.domain == "submarine" and u.active]:
            orders.append({"type": "submarine_patrol", "unit_id": unit.id, "target": "taiwan_strait"})

        for unit in [u for u in state.units.values() if u.side == "BLUE" and u.domain == "naval" and u.active]:
            if unit.region == "guam" and "philippine_sea" in state.regions[unit.region]["adjacent"]:
                orders.append({"type": "naval_move", "unit_id": unit.id, "target": "philippine_sea"})
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

