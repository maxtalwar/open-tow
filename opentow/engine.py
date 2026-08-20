from __future__ import annotations

import copy
import random
from typing import Any, Iterable

from .models import Event, GameState, Side, Unit


ACTION_TYPES = {
    "missile_strike",
    "air_mission",
    "rebase",
    "naval_move",
    "submarine_patrol",
    "amphibious_lift",
    "ground_attack",
    "hold",
}

AIR_MISSIONS = {"cap", "strike_base", "maritime_strike", "ground_support", "reserve"}


class OrderError(ValueError):
    pass


def order_schema() -> dict[str, Any]:
    return {
        "description": "Submit one order bundle per side for a 3.5-day turn.",
        "bundle": {"side": "BLUE | RED", "orders": "array[action]"},
        "actions": {
            "missile_strike": {"target_id": "base or unit id", "amount": "positive number"},
            "air_mission": {"unit_id": "air unit", "mission": sorted(AIR_MISSIONS), "target": "region or base id"},
            "rebase": {"unit_id": "air unit", "base_id": "friendly base id"},
            "naval_move": {"unit_id": "surface/amphibious unit", "target": "adjacent region id"},
            "submarine_patrol": {"unit_id": "submarine unit", "target": "region id"},
            "amphibious_lift": {"unit_id": "amphibious unit", "amount": "lift points"},
            "ground_attack": {"intensity": "0.25 to 1.0"},
            "hold": {},
        },
    }


def validate_orders(state: GameState, side: Side, orders: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    if state.status != "ACTIVE":
        raise OrderError("The game is complete.")
    if side not in ("BLUE", "RED"):
        raise OrderError("Side must be BLUE or RED.")
    validated: list[dict[str, Any]] = []
    seen_units: set[str] = set()
    committed_missiles = 0.0
    committed_lift = 0.0

    for raw in orders:
        action = copy.deepcopy(raw)
        action_type = action.get("type")
        if action_type not in ACTION_TYPES:
            raise OrderError(f"Unknown action type: {action_type!r}")

        unit_id = action.get("unit_id")
        if unit_id:
            if unit_id not in state.units:
                raise OrderError(f"Unknown unit: {unit_id}")
            unit = state.units[unit_id]
            if unit.side != side:
                raise OrderError(f"{side} cannot order {unit_id}")
            if not unit.active:
                raise OrderError(f"Unit {unit_id} is not active")
            if unit_id in seen_units and action_type not in {"amphibious_lift"}:
                raise OrderError(f"Unit {unit_id} received conflicting orders")
            seen_units.add(unit_id)

        if action_type == "missile_strike":
            target_id = action.get("target_id")
            if target_id not in state.bases and target_id not in state.units:
                raise OrderError(f"Unknown missile target: {target_id}")
            target_side = state.bases[target_id].side if target_id in state.bases else state.units[target_id].side
            if target_side == side:
                raise OrderError("Missile targets must be hostile")
            amount = float(action.get("amount", 0))
            if amount <= 0:
                raise OrderError("Missile amount must be positive")
            committed_missiles += amount

        elif action_type == "air_mission":
            unit = state.units[unit_id]
            if unit.domain != "air":
                raise OrderError("Air missions require an air unit")
            if action.get("mission") not in AIR_MISSIONS:
                raise OrderError("Invalid air mission")
            target = action.get("target")
            if target and target not in state.regions and target not in state.bases and target not in state.units:
                raise OrderError(f"Unknown air mission target: {target}")

        elif action_type == "rebase":
            unit = state.units[unit_id]
            base_id = action.get("base_id")
            if unit.domain != "air" or base_id not in state.bases:
                raise OrderError("Rebase requires an air unit and known base")
            if state.bases[base_id].side != side:
                raise OrderError("Cannot rebase to a hostile base")

        elif action_type in {"naval_move", "submarine_patrol"}:
            unit = state.units[unit_id]
            expected = "submarine" if action_type == "submarine_patrol" else "naval"
            if unit.domain != expected:
                raise OrderError(f"{action_type} requires a {expected} unit")
            target = action.get("target")
            if target not in state.regions:
                raise OrderError("Unknown target region")
            if action_type == "naval_move" and target not in state.regions[unit.region]["adjacent"]:
                raise OrderError(f"{target} is not adjacent to {unit.region}")

        elif action_type == "amphibious_lift":
            unit = state.units[unit_id]
            if side != "RED" or unit.kind != "amphibious":
                raise OrderError("Only RED amphibious groups can conduct lift")
            amount = float(action.get("amount", unit.capacity))
            if amount <= 0:
                raise OrderError("Lift amount must be positive")
            committed_lift += amount

        elif action_type == "ground_attack":
            intensity = float(action.get("intensity", 0.5))
            if not 0.25 <= intensity <= 1.0:
                raise OrderError("Ground attack intensity must be between 0.25 and 1.0")

        validated.append(action)

    if committed_missiles > state.munitions[side]["long_range"]:
        raise OrderError("Orders exceed available long-range munitions")
    red_capacity = sum(u.capacity * u.readiness for u in state.units.values() if u.side == "RED" and u.kind == "amphibious" and u.active)
    if side == "RED" and committed_lift > red_capacity + 0.01:
        raise OrderError("Orders exceed surviving amphibious lift capacity")
    return validated


def resolve_turn(state: GameState, bundles: dict[Side, list[dict[str, Any]]]) -> GameState:
    if state.status != "ACTIVE":
        raise OrderError("The game is complete.")
    orders: dict[Side, list[dict[str, Any]]] = {
        "BLUE": validate_orders(state, "BLUE", bundles.get("BLUE", [])),
        "RED": validate_orders(state, "RED", bundles.get("RED", [])),
    }
    rng = random.Random(state.seed + state.turn * 1009)
    state.orders_history.append({"turn": state.turn, "orders": copy.deepcopy(orders)})
    _reset_missions(state)
    _resolve_missiles(state, orders, rng)
    _apply_movement_and_missions(state, orders)
    _resolve_air(state, rng)
    _resolve_naval(state, rng)
    _resolve_lift(state, orders, rng)
    _resolve_ground(state, orders, rng)
    _recover_and_assess(state)
    _check_victory(state)
    if state.status == "ACTIVE":
        state.turn += 1
    return state


def _event(state: GameState, phase: str, message: str, visibility: str = "PUBLIC", **data: Any) -> None:
    state.events.append(Event(state.turn, phase, message, visibility, data))


def _reset_missions(state: GameState) -> None:
    for unit in state.units.values():
        unit.mission = "reserve"
        unit.target = None


def _resolve_missiles(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    for side in ("RED", "BLUE"):
        for order in orders[side]:
            if order["type"] != "missile_strike":
                continue
            amount = float(order["amount"])
            target_id = order["target_id"]
            state.munitions[side]["long_range"] -= amount
            salvos = amount / 10.0
            if target_id in state.bases:
                base = state.bases[target_id]
                protection = 0.5 * base.hardening + 0.25 * base.sam
                damage = max(0.0, salvos * rng.uniform(0.07, 0.13) - protection * 0.02)
                base.damage = min(0.95, base.damage + damage)
                for unit in state.units.values():
                    if unit.base_id == base.id and unit.active:
                        unit.strength = max(0.0, unit.strength - damage * rng.uniform(0.15, 0.45) * unit.max_strength)
                _event(state, "MISSILES", f"{side} missile strikes damaged {base.name} to {base.damage:.0%}.", amount=amount, target=target_id)
            else:
                unit = state.units[target_id]
                loss = min(unit.strength, salvos * rng.uniform(0.04, 0.11))
                unit.strength -= loss
                _event(state, "MISSILES", f"{side} missile strikes reduced {unit.name} by {loss:.1f} strength.", amount=amount, target=target_id)


def _apply_movement_and_missions(state: GameState, orders: dict[Side, list[dict[str, Any]]]) -> None:
    for side in ("RED", "BLUE"):
        for order in orders[side]:
            action_type = order["type"]
            if action_type == "air_mission":
                unit = state.units[order["unit_id"]]
                unit.mission = order["mission"]
                unit.target = order.get("target")
            elif action_type == "rebase":
                unit = state.units[order["unit_id"]]
                base = state.bases[order["base_id"]]
                unit.base_id = base.id
                unit.region = base.region
                unit.mission = "rebase"
                unit.readiness = max(0.2, unit.readiness - 0.25)
                _event(state, "MOVEMENT", f"{unit.name} rebased to {base.name}.")
            elif action_type in {"naval_move", "submarine_patrol"}:
                unit = state.units[order["unit_id"]]
                unit.region = order["target"]
                unit.mission = "patrol" if action_type == "submarine_patrol" else "move"
                unit.target = order["target"]
                _event(state, "MOVEMENT", f"{unit.name} moved to {state.regions[unit.region]['name']}.")


def _air_power(state: GameState, side: Side, region: str, mission: str) -> float:
    power = 0.0
    for unit in state.units.values():
        if unit.side != side or unit.domain != "air" or not unit.active or unit.mission != mission:
            continue
        target_region = unit.target
        if target_region in state.bases:
            target_region = state.bases[target_region].region
        if target_region != region:
            continue
        base_effect = state.bases[unit.base_id].effectiveness if unit.base_id in state.bases else 1.0
        quality = {"fighter_4g": 0.8, "fighter_45g": 1.0, "fighter_5g": 1.35, "bomber": 1.2}.get(unit.kind, 0.7)
        power += unit.strength * unit.readiness * base_effect * quality
    return power


def _resolve_air(state: GameState, rng: random.Random) -> None:
    contested = set()
    for unit in state.units.values():
        if unit.domain == "air" and unit.target:
            contested.add(state.bases[unit.target].region if unit.target in state.bases else unit.target)
    for region in contested:
        if region not in state.regions:
            continue
        blue_cap = _air_power(state, "BLUE", region, "cap")
        red_cap = _air_power(state, "RED", region, "cap")
        if blue_cap + red_cap > 0:
            blue_loss = min(1.0, red_cap / max(1.0, blue_cap + red_cap) * rng.uniform(0.15, 0.45))
            red_loss = min(1.0, blue_cap / max(1.0, blue_cap + red_cap) * rng.uniform(0.15, 0.45))
            _spread_loss(state, "BLUE", "air", region, blue_loss, mission="cap")
            _spread_loss(state, "RED", "air", region, red_loss, mission="cap")
            _event(state, "AIR", f"Air combat over {state.regions[region]['name']}: BLUE {blue_cap:.1f} vs RED {red_cap:.1f}.")

        for side, hostile in (("BLUE", "RED"), ("RED", "BLUE")):
            strike = _air_power(state, side, region, "strike_base")
            if strike <= 0:
                continue
            hostile_cap = red_cap if side == "BLUE" else blue_cap
            effectiveness = strike / max(1.0, strike + hostile_cap)
            targets = [base for base in state.bases.values() if base.side == hostile and base.region == region]
            if targets:
                target = min(targets, key=lambda item: item.damage)
                damage = rng.uniform(0.04, 0.11) * effectiveness * strike
                target.damage = min(0.95, target.damage + damage)
                _event(state, "AIR", f"{side} air strikes increased damage at {target.name} to {target.damage:.0%}.")


def _spread_loss(state: GameState, side: Side, domain: str, region: str, amount: float, mission: str | None = None) -> None:
    candidates = [
        unit for unit in state.units.values()
        if unit.side == side and unit.domain == domain and unit.active and (not mission or unit.mission == mission)
        and (unit.target == region or unit.region == region)
    ]
    if candidates:
        per_unit = amount / len(candidates)
        for unit in candidates:
            unit.strength = max(0.0, unit.strength - per_unit)


def _resolve_naval(state: GameState, rng: random.Random) -> None:
    for region_id, region in state.regions.items():
        blue_surface = [u for u in state.units.values() if u.side == "BLUE" and u.domain == "naval" and u.region == region_id and u.active]
        red_surface = [u for u in state.units.values() if u.side == "RED" and u.domain == "naval" and u.region == region_id and u.active]
        for strike_side, targets in (("BLUE", red_surface), ("RED", blue_surface)):
            strike_power = _air_power(state, strike_side, region_id, "maritime_strike")
            if strike_power > 0 and targets:
                target = max(targets, key=lambda item: item.capacity if item.kind == "amphibious" else item.strength)
                hostile = "RED" if strike_side == "BLUE" else "BLUE"
                cap = _air_power(state, hostile, region_id, "cap")
                effectiveness = strike_power / max(1.0, strike_power + cap)
                loss = min(target.strength, strike_power * effectiveness * rng.uniform(0.05, 0.13))
                target.strength -= loss
                if target.kind == "amphibious" and target.max_strength:
                    target.capacity *= max(0.0, target.strength / max(0.01, target.strength + loss))
                _event(state, "MARITIME_STRIKE", f"{strike_side} aircraft damaged {target.name} by {loss:.1f} strength.")
        if blue_surface and red_surface:
            blue_power = sum(u.strength * u.readiness for u in blue_surface)
            red_power = sum(u.strength * u.readiness for u in red_surface)
            blue_loss = red_power / max(1.0, blue_power + red_power) * rng.uniform(0.15, 0.55)
            red_loss = blue_power / max(1.0, blue_power + red_power) * rng.uniform(0.15, 0.55)
            _loss_across(blue_surface, blue_loss)
            _loss_across(red_surface, red_loss)
            _event(state, "NAVAL", f"Surface engagement in {region['name']} caused losses on both sides.")

        for sub_side, target_side in (("BLUE", "RED"), ("RED", "BLUE")):
            subs = [u for u in state.units.values() if u.side == sub_side and u.domain == "submarine" and u.region == region_id and u.active]
            targets = [u for u in state.units.values() if u.side == target_side and u.domain == "naval" and u.region == region_id and u.active]
            if subs and targets:
                attack = sum(u.strength * u.readiness for u in subs) * rng.uniform(0.05, 0.16)
                target = max(targets, key=lambda item: item.capacity if item.kind == "amphibious" else item.strength)
                loss = min(target.strength, attack)
                target.strength -= loss
                if target.max_strength:
                    target.capacity *= max(0.0, target.strength / max(0.01, target.strength + loss))
                _event(state, "SUBMARINE", f"{sub_side} submarines damaged {target.name} by {loss:.1f} strength.")


def _loss_across(units: list[Unit], amount: float) -> None:
    per_unit = amount / max(1, len(units))
    for unit in units:
        unit.strength = max(0.0, unit.strength - per_unit)


def _resolve_lift(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    requested = sum(float(order.get("amount", 0)) for order in orders["RED"] if order["type"] == "amphibious_lift")
    if requested <= 0:
        return
    existing = state.metrics["red_lodgment"]
    sustainment = existing * 0.35
    surviving_capacity = sum(
        unit.capacity * unit.readiness for unit in state.units.values()
        if unit.side == "RED" and unit.kind == "amphibious" and unit.active
    )
    coastal_defense = max(0.0, state.metrics["taiwan_coastal_defense"])
    interdiction = sum(
        unit.strength * unit.readiness for unit in state.units.values()
        if unit.side == "BLUE" and unit.domain == "submarine" and unit.region == "taiwan_strait" and unit.active
    )
    usable = min(requested, surviving_capacity)
    delivered = max(0.0, usable - sustainment) * max(0.1, 1.0 - coastal_defense * 0.025 - interdiction * 0.018) * rng.uniform(0.75, 1.0)
    state.metrics["red_lodgment"] += delivered
    state.metrics["taiwan_coastal_defense"] = max(0.0, coastal_defense - delivered * 0.08)
    _event(state, "LIFT", f"RED delivered {delivered:.1f} ground-strength points after sustainment and interdiction.", requested=requested, delivered=delivered)


def _resolve_ground(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    red_intensity = max([float(o.get("intensity", 0.0)) for o in orders["RED"] if o["type"] == "ground_attack"] or [0.0])
    blue_intensity = max([float(o.get("intensity", 0.0)) for o in orders["BLUE"] if o["type"] == "ground_attack"] or [0.35])
    lodgment = state.metrics["red_lodgment"]
    defense = state.metrics["taiwan_defense"]
    if lodgment <= 0.05:
        return
    red_support = _air_power(state, "RED", "taiwan", "ground_support")
    blue_support = _air_power(state, "BLUE", "taiwan", "ground_support")
    red_power = lodgment * (0.6 + red_intensity) + red_support * 0.25
    blue_power = defense * (0.7 + blue_intensity) + blue_support * 0.25
    red_loss = min(lodgment, blue_power / max(1.0, red_power + blue_power) * rng.uniform(0.3, 1.0))
    blue_loss = min(defense, red_power / max(1.0, red_power + blue_power) * rng.uniform(0.3, 1.0))
    state.metrics["red_lodgment"] = max(0.0, lodgment - red_loss)
    state.metrics["taiwan_defense"] = max(0.0, defense - blue_loss)
    advance = max(0.0, red_power - blue_power * 0.72) * rng.uniform(0.15, 0.35)
    state.metrics["taiwan_control"] = min(100.0, state.metrics["taiwan_control"] + advance)
    _event(state, "GROUND", f"Ground combat: RED lost {red_loss:.1f}, Taiwan lost {blue_loss:.1f}; RED control is {state.metrics['taiwan_control']:.0f}%.")


def _recover_and_assess(state: GameState) -> None:
    for base in state.bases.values():
        base.damage = max(0.0, base.damage - 0.025)
    for unit in state.units.values():
        if unit.active:
            unit.readiness = min(1.0, unit.readiness + (0.04 if unit.mission == "reserve" else 0.01))
    _event(state, "ASSESSMENT", f"Turn {state.turn} complete. Long-range munitions: BLUE {state.munitions['BLUE']['long_range']:.0f}, RED {state.munitions['RED']['long_range']:.0f}.")


def _check_victory(state: GameState) -> None:
    control = state.metrics["taiwan_control"]
    defense = state.metrics["taiwan_defense"]
    lodgment = state.metrics["red_lodgment"]
    if control >= 80 or (defense <= 1.5 and lodgment >= 8):
        state.status = "COMPLETE"
        state.winner = "RED"
        _event(state, "VICTORY", "RED achieved a sustainable operational occupation of Taiwan.")
    elif state.turn >= state.max_turns:
        state.status = "COMPLETE"
        state.winner = "BLUE" if control < 50 else "DRAW"
        message = "BLUE denied occupation through the scenario horizon." if state.winner == "BLUE" else "The campaign ended in an unresolved contested lodgment."
        _event(state, "VICTORY", message)

