from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


Side = Literal["BLUE", "RED"]


@dataclass
class Unit:
    id: str
    side: Side
    name: str
    domain: str
    kind: str
    region: str
    strength: float
    max_strength: float
    readiness: float = 1.0
    capacity: float = 0.0
    base_id: str | None = None
    mission: str = "reserve"
    target: str | None = None
    hidden: bool = False

    @property
    def active(self) -> bool:
        return self.strength > 0.05 and self.readiness > 0.05


@dataclass
class Base:
    id: str
    side: Side
    name: str
    region: str
    capacity: int
    hardening: float
    sam: float
    damage: float = 0.0

    @property
    def effectiveness(self) -> float:
        return max(0.1, 1.0 - self.damage)


@dataclass
class Event:
    turn: int
    phase: str
    message: str
    visibility: str = "PUBLIC"
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class GameState:
    scenario_id: str
    seed: int
    turn: int
    max_turns: int
    status: str
    winner: str | None
    regions: dict[str, dict[str, Any]]
    units: dict[str, Unit]
    bases: dict[str, Base]
    munitions: dict[str, dict[str, float]]
    political: dict[str, Any]
    metrics: dict[str, float]
    events: list[Event] = field(default_factory=list)
    orders_history: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self, observer: Side | None = None) -> dict[str, Any]:
        payload = asdict(self)
        if observer:
            visible_units: dict[str, Any] = {}
            for unit_id, unit in self.units.items():
                item = asdict(unit)
                if unit.side != observer and unit.hidden:
                    item["strength"] = None
                    item["readiness"] = None
                    item["mission"] = "unknown"
                    item["target"] = None
                visible_units[unit_id] = item
            payload["units"] = visible_units
            payload["events"] = [
                asdict(event)
                for event in self.events
                if event.visibility in ("PUBLIC", observer)
            ]
        payload["score"] = score_state(self)
        return payload


def score_state(state: GameState) -> dict[str, float]:
    red_lodgment = state.metrics.get("red_lodgment", 0.0)
    control = state.metrics.get("taiwan_control", 0.0)
    taiwan_defense = state.metrics.get("taiwan_defense", 0.0)
    red_losses = sum(
        max(0.0, unit.max_strength - unit.strength)
        for unit in state.units.values()
        if unit.side == "RED"
    )
    blue_losses = sum(
        max(0.0, unit.max_strength - unit.strength)
        for unit in state.units.values()
        if unit.side == "BLUE"
    )
    return {
        "red": round(control + red_lodgment * 1.5 - red_losses * 0.5, 2),
        "blue": round((100 - control) + taiwan_defense * 1.5 - blue_losses * 0.5, 2),
    }

