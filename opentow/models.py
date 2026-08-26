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
    home_base_id: str | None = None
    weapons: dict[str, float] = field(default_factory=dict)
    max_weapons: dict[str, float] = field(default_factory=dict)
    mobility: int = 1
    search: float = 0.0
    counter_scale: str = "formation"
    rearm_turns: int = 0

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
    kind: str = "airbase"
    port_capacity: int = 0

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
class Contact:
    """A side-specific undersea track, never an omniscient unit marker."""

    target_id: str
    region: str
    classification: str = "DETECTED"
    confidence: float = 0.25
    last_seen_turn: int = 0


@dataclass
class GroundUnit:
    id: str
    side: Side
    name: str
    kind: str
    hex_id: str
    strength: float
    max_strength: float
    attack: float
    defense: float
    movement: int
    lift_cost: float
    supply_need: float
    supply: float = 1.0
    reserve_strength: float = 0.0
    mission: str = "defend"
    target: str | None = None

    @property
    def active(self) -> bool:
        return self.strength > 0.05

    @property
    def available(self) -> bool:
        return self.reserve_strength > 0.05


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
    ground_hexes: dict[str, dict[str, Any]] = field(default_factory=dict)
    ground_units: dict[str, GroundUnit] = field(default_factory=dict)
    contacts: dict[str, dict[str, Contact]] = field(
        default_factory=lambda: {"BLUE": {}, "RED": {}}
    )
    events: list[Event] = field(default_factory=list)
    orders_history: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self, observer: Side | None = None) -> dict[str, Any]:
        payload = asdict(self)
        if observer:
            visible_units: dict[str, Any] = {}
            for unit_id, unit in self.units.items():
                item = asdict(unit)
                if unit.side != observer and unit.hidden:
                    contact = self.contacts.get(observer, {}).get(unit_id)
                    if contact is None:
                        continue
                    item["name"] = (
                        unit.name
                        if contact.classification == "IDENTIFIED"
                        else f"{contact.classification.title()} submarine contact"
                    )
                    item["kind"] = unit.kind if contact.classification == "IDENTIFIED" else "submarine_contact"
                    item["region"] = contact.region
                    item["strength"] = None
                    item["readiness"] = None
                    item["mission"] = "unknown"
                    item["target"] = None
                    item["weapons"] = {}
                    item["max_weapons"] = {}
                    item["contact_state"] = contact.classification
                    item["contact_confidence"] = contact.confidence
                visible_units[unit_id] = item
            payload["units"] = visible_units
            payload["contacts"] = {
                unit_id: asdict(contact)
                for unit_id, contact in self.contacts.get(observer, {}).items()
            }
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
