from __future__ import annotations

import copy
import math
import random
from collections import deque
from typing import Any, Iterable

from .models import Contact, Event, GameState, GroundUnit, Side, Unit


ACTION_TYPES = {
    "missile_strike", "air_mission", "rebase", "naval_move", "naval_mission",
    "submarine_patrol", "submarine_mission", "amphibious_lift", "ground_attack",
    "ground_order", "hold",
}
AIR_MISSIONS = {"cap", "strike_base", "maritime_strike", "ground_support", "interdiction", "asw", "reserve"}
NAVAL_MISSIONS = {"surface_strike", "air_defense", "asw", "escort", "rearm", "reserve"}
SUBMARINE_MISSIONS = {"hunt_shipping", "hunt_submarines", "barrier", "rearm", "reserve"}
GROUND_MISSIONS = {"attack", "move", "defend", "reserve"}

# Synthetic, inspectable reconstruction parameters. Ranges are operational hexes
# (approximately 600 km each), not tactical weapon ranges.
WEAPON_PROFILES: dict[str, dict[str, Any]] = {
    "jassm_er": {"role": "land", "range": 4, "effect": 0.012, "label": "JASSM-ER"},
    "tomahawk": {"role": "land", "range": 4, "effect": 0.011, "label": "Tomahawk"},
    "lrasm": {"role": "naval", "range": 4, "effect": 0.055, "label": "LRASM"},
    "mst": {"role": "naval", "range": 3, "effect": 0.045, "label": "Maritime Strike Tomahawk"},
    "harpoon": {"role": "naval", "range": 2, "effect": 0.035, "label": "Harpoon"},
    "tbm": {"role": "land", "range": 3, "effect": 0.014, "label": "Theater ballistic missile"},
    "irbm": {"role": "dual", "range": 6, "effect": 0.016, "label": "Intermediate-range ballistic missile"},
    "lacm": {"role": "land", "range": 4, "effect": 0.011, "label": "Land-attack cruise missile"},
    "ascm": {"role": "naval", "range": 3, "effect": 0.048, "label": "Anti-ship cruise missile"},
}
DEFAULT_WEAPONS = {
    "BLUE": {"land": ("jassm_er", "tomahawk"), "naval": ("lrasm", "mst", "harpoon")},
    "RED": {"land": ("tbm", "lacm", "irbm"), "naval": ("ascm", "irbm")},
}
AIR_WEAPONS: dict[Side, tuple[str, ...]] = {
    "BLUE": ("jassm_er", "lrasm", "harpoon"),
    "RED": ("lacm", "ascm"),
}
AIR_RANGE = {
    "fighter_4g": 1, "fighter_45g": 2, "fighter_5g": 2, "bomber": 5,
    "tanker": 4, "maritime_patrol": 3,
}


class OrderError(ValueError):
    pass


def order_schema() -> dict[str, Any]:
    return {
        "description": "Submit one simultaneous mission bundle per side for a 3.5-day turn.",
        "bundle": {"side": "BLUE | RED", "orders": "array[action]"},
        "actions": {
            "missile_strike": {"target_id": "hostile base or located surface formation", "weapon": sorted(WEAPON_PROFILES), "amount": "positive number", "origin": "optional friendly operational hex"},
            "air_mission": {"unit_id": "air squadron", "mission": sorted(AIR_MISSIONS), "target": "operational hex or base", "target_id": "optional located target", "weapon": "inferred for strikes", "amount": "weapon allocation", "tanker_support": "boolean"},
            "rebase": {"unit_id": "air squadron", "base_id": "friendly airbase"},
            "naval_move": {"unit_id": "surface/amphibious group", "target": "reachable hex"},
            "naval_mission": {"unit_id": "surface group", "mission": sorted(NAVAL_MISSIONS), "target": "operational hex", "target_id": "optional hostile surface formation"},
            "submarine_mission": {"unit_id": "submarine squadron", "mission": sorted(SUBMARINE_MISSIONS), "target": "reachable patrol or home-port hex"},
            "submarine_patrol": "legacy alias for hunt_shipping",
            "amphibious_lift": {"unit_id": "RED amphibious group", "ground_unit_id": "available RED ground formation", "target": "Taiwan beach hex", "amount": "thousands of tons", "insertion": "amphibious | air_assault | airborne | captured_port"},
            "ground_order": {"unit_id": "deployed ground formation", "mission": sorted(GROUND_MISSIONS), "target": "same or adjacent 30 km hex"},
            "ground_attack": {"intensity": "legacy force-wide posture, 0.25 to 1.0"},
            "hold": {},
        },
    }


def region_distance(state: GameState, origin: str, target: str) -> int:
    return _graph_distance(state.regions, origin, target)


def ground_distance(state: GameState, origin: str, target: str) -> int:
    return _graph_distance(state.ground_hexes, origin, target)


def _graph_distance(graph: dict[str, dict[str, Any]], origin: str, target: str) -> int:
    if origin == target:
        return 0
    if origin not in graph or target not in graph:
        return 999
    queue: deque[tuple[str, int]] = deque([(origin, 0)])
    seen = {origin}
    while queue:
        node, distance = queue.popleft()
        for adjacent in graph[node].get("adjacent", []):
            if adjacent == target:
                return distance + 1
            if adjacent not in seen and adjacent in graph:
                seen.add(adjacent)
                queue.append((adjacent, distance + 1))
    return 999


def _target_role(state: GameState, target_id: str) -> str:
    if target_id in state.bases:
        return "land"
    unit = state.units[target_id]
    if unit.domain == "naval":
        return "naval"
    if unit.domain == "submarine":
        raise OrderError("A submerged submarine is not a legal generic missile-strike target; use ASW missions.")
    raise OrderError("Aircraft and ground formations must be struck through their base or ground hex.")


def _target_region(state: GameState, target_id: str) -> str:
    return state.bases[target_id].region if target_id in state.bases else state.units[target_id].region


def _default_weapon(state: GameState, side: Side, role: str) -> str:
    for weapon in DEFAULT_WEAPONS[side][role]:
        if state.munitions[side].get(weapon, 0.0) > 0:
            return weapon
    raise OrderError(f"{side} has no {role}-strike weapons remaining")


def _default_air_weapon(state: GameState, side: Side, role: str) -> str:
    for weapon in AIR_WEAPONS[side]:
        if _weapon_matches(weapon, role) and state.munitions[side].get(weapon, 0.0) > 0:
            return weapon
    raise OrderError(f"{side} has no air-deliverable {role}-strike weapons remaining")


def _weapon_matches(weapon: str, role: str) -> bool:
    profile_role = WEAPON_PROFILES[weapon]["role"]
    return profile_role == role or profile_role == "dual"


def _launch_region(state: GameState, side: Side, action: dict[str, Any]) -> str:
    launcher_id = action.get("launcher_id")
    if launcher_id:
        return state.units[launcher_id].region
    if action.get("origin") in state.regions:
        return action["origin"]
    return "fujian_coast" if side == "RED" else "guam"


def validate_orders(state: GameState, side: Side, orders: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    if state.status != "ACTIVE":
        raise OrderError("The game is complete.")
    if side not in ("BLUE", "RED"):
        raise OrderError("Side must be BLUE or RED.")
    validated: list[dict[str, Any]] = []
    unit_slots: dict[str, set[str]] = {}
    committed: dict[str, float] = {}
    lift_by_group: dict[str, float] = {}

    for raw in orders:
        action = copy.deepcopy(raw)
        action_type = action.get("type")
        if action_type not in ACTION_TYPES:
            raise OrderError(f"Unknown action type: {action_type!r}")

        unit_id = action.get("unit_id")
        unit: Unit | None = None
        if unit_id and action_type != "ground_order":
            if unit_id not in state.units:
                raise OrderError(f"Unknown unit: {unit_id}")
            unit = state.units[unit_id]
            if unit.side != side:
                raise OrderError(f"{side} cannot order {unit_id}")
            if not unit.active:
                raise OrderError(f"Unit {unit_id} is not active")
            slot = "movement" if action_type in {"naval_move", "rebase"} else "mission"
            if action_type == "amphibious_lift":
                slot = "lift"
            slots = unit_slots.setdefault(unit_id, set())
            if slot in slots:
                raise OrderError(f"Unit {unit_id} received conflicting {slot} orders")
            slots.add(slot)

        if action_type == "missile_strike":
            target_id = action.get("target_id")
            if target_id not in state.bases and target_id not in state.units:
                raise OrderError(f"Unknown missile target: {target_id}")
            target_side = state.bases[target_id].side if target_id in state.bases else state.units[target_id].side
            if target_side == side:
                raise OrderError("Missile targets must be hostile")
            role = _target_role(state, target_id)
            weapon = action.get("weapon") or _default_weapon(state, side, role)
            if weapon not in WEAPON_PROFILES or not _weapon_matches(weapon, role):
                raise OrderError(f"{weapon!r} is not a legal {role}-strike weapon")
            amount = float(action.get("amount", 0))
            if amount <= 0:
                raise OrderError("Missile amount must be positive")
            origin = _launch_region(state, side, action)
            distance = region_distance(state, origin, _target_region(state, target_id))
            if distance > WEAPON_PROFILES[weapon]["range"]:
                raise OrderError(f"{weapon} cannot reach that target from {origin} ({distance} hexes)")
            action.update({"weapon": weapon, "amount": amount, "origin": origin})
            committed[weapon] = committed.get(weapon, 0.0) + amount

        elif action_type == "air_mission":
            if unit is None or unit.domain != "air":
                raise OrderError("Air missions require an air unit")
            mission = action.get("mission")
            if mission not in AIR_MISSIONS:
                raise OrderError("Invalid air mission")
            target = action.get("target")
            target_region = state.bases[target].region if target in state.bases else target
            if target_region and target_region not in state.regions:
                raise OrderError(f"Unknown air mission target: {target}")
            origin = state.bases[unit.base_id].region if unit.base_id in state.bases else unit.region
            distance = region_distance(state, origin, target_region or origin)
            reach = AIR_RANGE.get(unit.kind, 1) + (1 if action.get("tanker_support") else 0)
            if distance > reach:
                raise OrderError(f"{unit.name} cannot sustain {mission} at {target_region}; range is {reach} hexes")
            if mission == "asw" and unit.search <= 0:
                raise OrderError("ASW requires a maritime-patrol or ASW-capable air formation")
            if mission in {"strike_base", "maritime_strike"}:
                role = "land" if mission == "strike_base" else "naval"
                weapon = action.get("weapon") or _default_air_weapon(state, side, role)
                if weapon not in AIR_WEAPONS[side] or not _weapon_matches(weapon, role):
                    raise OrderError(f"{weapon!r} is not valid for {mission}")
                amount = float(action.get("amount", min(6.0, state.munitions[side].get(weapon, 0.0))))
                if amount <= 0:
                    raise OrderError("Strike weapon allocation must be positive")
                action.update({"weapon": weapon, "amount": amount})
                committed[weapon] = committed.get(weapon, 0.0) + amount

        elif action_type == "rebase":
            base_id = action.get("base_id")
            if unit is None or unit.domain != "air" or base_id not in state.bases:
                raise OrderError("Rebase requires an air unit and known base")
            base = state.bases[base_id]
            if base.side != side or base.kind != "airbase":
                raise OrderError("Cannot rebase to that base")

        elif action_type == "naval_move":
            if unit is None or unit.domain != "naval":
                raise OrderError("naval_move requires a naval unit")
            target = action.get("target")
            if target not in state.regions:
                raise OrderError("Unknown target region")
            if region_distance(state, unit.region, target) > unit.mobility:
                raise OrderError(f"{target} is beyond {unit.name}'s one-turn movement allowance")

        elif action_type == "naval_mission":
            if unit is None or unit.domain != "naval":
                raise OrderError("naval_mission requires a naval unit")
            if action.get("mission") not in NAVAL_MISSIONS:
                raise OrderError("Invalid naval mission")
            if action.get("target", unit.region) not in state.regions:
                raise OrderError("Unknown naval mission region")

        elif action_type in {"submarine_patrol", "submarine_mission"}:
            if unit is None or unit.domain != "submarine":
                raise OrderError(f"{action_type} requires a submarine unit")
            mission = "hunt_shipping" if action_type == "submarine_patrol" else action.get("mission")
            if mission not in SUBMARINE_MISSIONS:
                raise OrderError("Invalid submarine mission")
            target = action.get("target", unit.region)
            if target not in state.regions:
                raise OrderError("Unknown submarine patrol region")
            if mission != "rearm" and region_distance(state, unit.region, target) > unit.mobility:
                raise OrderError(f"{target} is beyond {unit.name}'s one-turn movement allowance")
            if mission == "rearm":
                home = state.bases.get(unit.home_base_id or "")
                if home is None or target != home.region or unit.region != home.region:
                    raise OrderError("A submarine can rearm only after returning to its home port")
            action["mission"] = mission

        elif action_type == "amphibious_lift":
            if unit is None or side != "RED" or unit.kind != "amphibious":
                raise OrderError("Only RED amphibious groups can conduct lift")
            ground_id = action.get("ground_unit_id")
            if not ground_id:
                ground_id = next((g.id for g in state.ground_units.values() if g.side == "RED" and g.available), None)
                action["ground_unit_id"] = ground_id
            if ground_id not in state.ground_units or not state.ground_units[ground_id].available:
                raise OrderError("Amphibious lift requires an available RED ground formation")
            target = action.get("target", "west_beach")
            insertion = action.get("insertion", "amphibious")
            if target not in state.ground_hexes:
                raise OrderError("Unknown Taiwan ground-map landing hex")
            if insertion == "amphibious" and not state.ground_hexes[target].get("beach"):
                raise OrderError("Amphibious formations must land in a beach hex")
            if insertion not in {"amphibious", "air_assault", "airborne", "captured_port"}:
                raise OrderError("Unknown insertion method")
            amount = float(action.get("amount", unit.capacity))
            if amount <= 0:
                raise OrderError("Lift amount must be positive")
            lift_by_group[unit.id] = lift_by_group.get(unit.id, 0.0) + amount
            action.update({"target": target, "insertion": insertion, "amount": amount})

        elif action_type == "ground_order":
            ground_id = action.get("unit_id")
            if ground_id not in state.ground_units:
                raise OrderError(f"Unknown ground unit: {ground_id}")
            ground = state.ground_units[ground_id]
            if ground.side != side or not ground.active:
                raise OrderError(f"{side} cannot order {ground_id}")
            if ground_id in unit_slots:
                raise OrderError(f"Ground unit {ground_id} received conflicting orders")
            unit_slots[ground_id] = {"ground"}
            mission = action.get("mission", "defend")
            target = action.get("target", ground.hex_id)
            if mission not in GROUND_MISSIONS or target not in state.ground_hexes:
                raise OrderError("Invalid ground order")
            if mission in {"attack", "move"} and ground_distance(state, ground.hex_id, target) > ground.movement:
                raise OrderError("Ground target is beyond the formation's movement allowance")

        elif action_type == "ground_attack":
            intensity = float(action.get("intensity", 0.5))
            if not 0.25 <= intensity <= 1.0:
                raise OrderError("Ground attack intensity must be between 0.25 and 1.0")

        validated.append(action)

    for weapon, amount in committed.items():
        if amount > state.munitions[side].get(weapon, 0.0) + 1e-9:
            raise OrderError(f"Orders exceed available {weapon} inventory")
    for unit_id, amount in lift_by_group.items():
        unit = state.units[unit_id]
        if amount > unit.capacity * unit.readiness + 0.01:
            raise OrderError(f"Orders exceed {unit.name}'s surviving lift capacity")
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
    _decay_contacts(state)
    _reset_missions(state)
    _resolve_missiles(state, orders, rng)
    _apply_movement_and_missions(state, orders)
    _resolve_air(state, orders, rng)
    _resolve_surface(state, orders, rng)
    _resolve_undersea(state, rng)
    _resolve_lift(state, orders, rng)
    _resolve_ground(state, orders, rng)
    _recover_and_assess(state)
    _update_metrics(state)
    _check_victory(state)
    _sync_legacy_munitions(state)
    if state.status == "ACTIVE":
        state.turn += 1
    return state


def _event(state: GameState, phase: str, message: str, visibility: str = "PUBLIC", **data: Any) -> None:
    state.events.append(Event(state.turn, phase, message, visibility, data))


def _reset_missions(state: GameState) -> None:
    for unit in state.units.values():
        unit.mission = "reserve"
        unit.target = None
    for unit in state.ground_units.values():
        if unit.active:
            unit.mission = "defend"
            unit.target = unit.hex_id


def _sync_legacy_munitions(state: GameState) -> None:
    for side in ("BLUE", "RED"):
        inventory = state.munitions[side]
        inventory["long_range"] = round(sum(
            value for weapon, value in inventory.items()
            if weapon in WEAPON_PROFILES and WEAPON_PROFILES[weapon]["range"] >= 3
        ), 3)
        inventory["anti_ship"] = round(sum(
            value for weapon, value in inventory.items()
            if weapon in WEAPON_PROFILES and WEAPON_PROFILES[weapon]["role"] in {"naval", "dual"}
        ), 3)


def _resolve_missiles(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    for side in ("RED", "BLUE"):
        for order in orders[side]:
            if order["type"] != "missile_strike":
                continue
            amount = float(order["amount"])
            weapon = order["weapon"]
            target_id = order["target_id"]
            state.munitions[side][weapon] -= amount
            effect = WEAPON_PROFILES[weapon]["effect"]
            if target_id in state.bases:
                base = state.bases[target_id]
                defense = 0.01 * base.hardening + 0.008 * base.sam
                damage = max(0.0, amount * effect * rng.uniform(0.75, 1.2) - defense)
                base.damage = min(0.95, base.damage + damage)
                for unit in state.units.values():
                    if unit.base_id == base.id and unit.active:
                        unit.strength = max(0.0, unit.strength - damage * rng.uniform(0.1, 0.35) * unit.max_strength)
                _event(state, "MISSILES", f"{side} expended {amount:.0f} {WEAPON_PROFILES[weapon]['label']} rounds against {base.name}; damage is {base.damage:.0%} and the base is {base.effectiveness:.0%} operational.",
                       kind="strike", side=side, weapon=weapon, amount=amount, target=target_id,
                       region=base.region, damage=base.damage, operational=base.effectiveness)
            else:
                target = state.units[target_id]
                defense = _surface_defense(state, target.side, target.region)
                loss = min(target.strength, amount * effect * rng.uniform(0.7, 1.25) * max(0.25, 1.0 - defense))
                _damage_unit(target, loss)
                _event(state, "MISSILES", f"{side} {WEAPON_PROFILES[weapon]['label']} strike reduced {target.name} by {loss:.1f} strength.",
                       kind="strike", side=side, weapon=weapon, amount=amount, target=target_id,
                       region=target.region, loss=loss)


def _apply_movement_and_missions(state: GameState, orders: dict[Side, list[dict[str, Any]]]) -> None:
    for side in ("RED", "BLUE"):
        for order in orders[side]:
            if order["type"] == "rebase":
                unit = state.units[order["unit_id"]]
                base = state.bases[order["base_id"]]
                origin = unit.region
                unit.base_id = base.id
                unit.region = base.region
                unit.mission = "rebase"
                unit.readiness = max(0.2, unit.readiness - 0.25)
                _event(state, "MOVEMENT", f"{unit.name} rebased to {base.name}.", kind="movement", side=side,
                       unit=unit.id, from_region=origin, to_region=base.region)
            elif order["type"] == "naval_move":
                unit = state.units[order["unit_id"]]
                origin = unit.region
                unit.region = order["target"]
                unit.target = unit.region
                _event(state, "MOVEMENT", f"{unit.name} moved to {state.regions[unit.region]['name']}.",
                       kind="movement", side=side, unit=unit.id, from_region=origin, to_region=unit.region)
        for order in orders[side]:
            action_type = order["type"]
            if action_type == "air_mission":
                unit = state.units[order["unit_id"]]
                unit.mission = order["mission"]
                unit.target = order.get("target")
            elif action_type == "naval_mission":
                unit = state.units[order["unit_id"]]
                unit.mission = order["mission"]
                unit.target = order.get("target", unit.region)
            elif action_type in {"submarine_patrol", "submarine_mission"}:
                unit = state.units[order["unit_id"]]
                target = order.get("target", unit.region)
                origin = unit.region
                unit.region = target
                unit.base_id = unit.home_base_id if order["mission"] == "rearm" else None
                unit.mission = order["mission"]
                unit.target = target
                if origin != target:
                    _event(state, "MOVEMENT", f"{unit.name} transited to a patrol area.", visibility=side,
                           kind="movement", side=side, unit=unit.id, from_region=origin, to_region=target)


def _air_persistence(state: GameState, unit: Unit, target_region: str) -> float:
    origin = state.bases[unit.base_id].region if unit.base_id in state.bases else unit.region
    distance = region_distance(state, origin, target_region)
    reach = max(1, AIR_RANGE.get(unit.kind, 1))
    return max(0.25, 1.0 - 0.16 * distance / reach)


def _air_power(state: GameState, side: Side, region: str, mission: str) -> float:
    power = 0.0
    for unit in state.units.values():
        if unit.side != side or unit.domain != "air" or not unit.active or unit.mission != mission:
            continue
        target_region = state.bases[unit.target].region if unit.target in state.bases else unit.target
        if target_region != region:
            continue
        base_effect = state.bases[unit.base_id].effectiveness if unit.base_id in state.bases else 1.0
        quality = {"fighter_4g": 0.8, "fighter_45g": 1.0, "fighter_5g": 1.35,
                   "bomber": 1.15, "maritime_patrol": 0.45}.get(unit.kind, 0.6)
        power += unit.strength * unit.readiness * base_effect * quality * _air_persistence(state, unit, region)
    return power


def _resolve_air(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    contested = {(state.bases[u.target].region if u.target in state.bases else u.target)
                 for u in state.units.values() if u.domain == "air" and u.target}
    for region in sorted(r for r in contested if r in state.regions):
        blue_cap = _air_power(state, "BLUE", region, "cap")
        red_cap = _air_power(state, "RED", region, "cap")
        if blue_cap + red_cap > 0:
            blue_loss = red_cap / max(1.0, blue_cap + red_cap) * rng.uniform(0.12, 0.38)
            red_loss = blue_cap / max(1.0, blue_cap + red_cap) * rng.uniform(0.12, 0.38)
            _spread_air_loss(state, "BLUE", region, blue_loss, "cap")
            _spread_air_loss(state, "RED", region, red_loss, "cap")
            _event(state, "AIR", f"Air combat over {state.regions[region]['name']}: BLUE {blue_cap:.1f} vs RED {red_cap:.1f}.",
                   kind="engagement", region=region, blue_power=blue_cap, red_power=red_cap)
    for side in ("BLUE", "RED"):
        hostile: Side = "RED" if side == "BLUE" else "BLUE"
        for order in orders[side]:
            if order["type"] != "air_mission" or order["mission"] != "strike_base":
                continue
            unit = state.units[order["unit_id"]]
            weapon, amount = order["weapon"], float(order["amount"])
            target_ref = order.get("target_id") or order.get("target")
            region = state.bases[target_ref].region if target_ref in state.bases else target_ref
            targets = [b for b in state.bases.values() if b.side == hostile and b.region == region and b.kind == "airbase"]
            if not targets:
                continue
            target = state.bases[target_ref] if target_ref in state.bases else min(targets, key=lambda b: b.damage)
            state.munitions[side][weapon] -= amount
            cap = _air_power(state, hostile, region, "cap")
            damage = amount * WEAPON_PROFILES[weapon]["effect"] * _air_persistence(state, unit, region) * rng.uniform(0.65, 1.1)
            damage *= max(0.3, 1.0 - cap / max(1.0, cap + unit.strength))
            damage *= max(0.35, 1.0 - 0.04 * target.sam - 0.04 * target.hardening)
            target.damage = min(0.95, target.damage + damage)
            unit.readiness = max(0.2, unit.readiness - 0.05)
            _event(state, "AIR", f"{side} strike package attacked {target.name} with {amount:.0f} {weapon}; the base is {target.effectiveness:.0%} operational.",
                   kind="strike", side=side, target=target.id, region=region, weapon=weapon, amount=amount, damage=target.damage)


def _spread_air_loss(state: GameState, side: Side, region: str, amount: float, mission: str) -> None:
    units = [u for u in state.units.values() if u.side == side and u.domain == "air" and u.active
             and u.mission == mission and (state.bases[u.target].region if u.target in state.bases else u.target) == region]
    for unit in units:
        unit.strength = max(0.0, unit.strength - amount / max(1, len(units)))


def _surface_defense(state: GameState, side: Side, region: str) -> float:
    defense = 0.0
    for unit in state.units.values():
        if unit.side == side and unit.domain == "naval" and unit.region == region and unit.active:
            if unit.mission in {"air_defense", "escort"}:
                defense += min(0.35, unit.weapons.get("air_defense", 0.0) * 0.015 * unit.readiness)
    return min(0.7, defense)


def _surface_targets(state: GameState, side: Side, region: str) -> list[Unit]:
    return [u for u in state.units.values() if u.side == side and u.domain == "naval" and u.region == region and u.active]


def _resolve_surface(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    for side in ("BLUE", "RED"):
        hostile: Side = "RED" if side == "BLUE" else "BLUE"
        for order in orders[side]:
            if order["type"] == "air_mission" and order["mission"] == "maritime_strike":
                region = order["target"]
                targets = _surface_targets(state, hostile, region)
                if not targets:
                    _event(state, "MARITIME_STRIKE", f"{side} maritime strike found no located surface target in {state.regions[region]['name']}.",
                           kind="search", side=side, region=region)
                    continue
                target_id = order.get("target_id")
                target = state.units[target_id] if target_id in {u.id for u in targets} else max(
                    targets, key=lambda u: (u.kind == "amphibious", u.capacity, u.strength))
                weapon, amount = order["weapon"], float(order["amount"])
                state.munitions[side][weapon] -= amount
                attacker = state.units[order["unit_id"]]
                cap = _air_power(state, hostile, region, "cap")
                defense = _surface_defense(state, hostile, region)
                loss = amount * WEAPON_PROFILES[weapon]["effect"] * _air_persistence(state, attacker, region) * rng.uniform(0.65, 1.15)
                loss *= max(0.25, 1.0 - defense) * max(0.35, attacker.strength / max(1.0, attacker.strength + cap))
                loss = min(target.strength, loss)
                _damage_unit(target, loss)
                _event(state, "MARITIME_STRIKE", f"{side} aircraft damaged {target.name} by {loss:.1f} strength using {weapon}.",
                       kind="strike", side=side, target=target.id, region=region, weapon=weapon, amount=amount, loss=loss)
            elif order["type"] == "naval_mission" and order["mission"] == "surface_strike":
                attacker = state.units[order["unit_id"]]
                region = order.get("target", attacker.region)
                targets = _surface_targets(state, hostile, region)
                if not targets or attacker.region != region:
                    continue
                shots = min(float(order.get("amount", 4.0)), attacker.weapons.get("anti_ship", 0.0))
                if shots <= 0:
                    _event(state, "NAVAL", f"{attacker.name} could not strike: its anti-ship magazine is empty.", side=side, region=region)
                    continue
                attacker.weapons["anti_ship"] -= shots
                target_id = order.get("target_id")
                target = state.units[target_id] if target_id in {u.id for u in targets} else max(targets, key=lambda u: u.strength)
                defense = _surface_defense(state, hostile, region)
                loss = min(target.strength, shots * 0.05 * rng.uniform(0.55, 1.1) * max(0.25, 1.0 - defense))
                _damage_unit(target, loss)
                _event(state, "NAVAL", f"{attacker.name} damaged {target.name} by {loss:.1f} strength.",
                       kind="strike", side=side, target=target.id, region=region, loss=loss)


def _damage_unit(unit: Unit, loss: float) -> None:
    previous = unit.strength
    unit.strength = max(0.0, unit.strength - loss)
    if unit.kind == "amphibious" and previous > 0:
        unit.capacity *= unit.strength / previous


def _decay_contacts(state: GameState) -> None:
    for side in ("BLUE", "RED"):
        for target_id in list(state.contacts[side]):
            contact = state.contacts[side][target_id]
            contact.confidence *= 0.55
            if contact.confidence < 0.16 or target_id not in state.units or not state.units[target_id].active:
                del state.contacts[side][target_id]
            else:
                contact.classification = _contact_classification(contact.confidence)


def _contact_classification(confidence: float) -> str:
    if confidence >= 0.85:
        return "IDENTIFIED"
    if confidence >= 0.55:
        return "LOCALIZED"
    return "DETECTED"


def _update_contact(state: GameState, observer: Side, target: Unit, confidence: float) -> Contact:
    old = state.contacts[observer].get(target.id)
    combined = min(1.0, confidence + (old.confidence * 0.55 if old else 0.0))
    contact = Contact(target.id, target.region, _contact_classification(combined), combined, state.turn)
    state.contacts[observer][target.id] = contact
    return contact


def _search_assets(state: GameState, side: Side, region: str) -> list[Unit]:
    assets: list[Unit] = []
    for unit in state.units.values():
        if unit.side != side or not unit.active or unit.search <= 0:
            continue
        if unit.domain == "air" and unit.mission == "asw" and unit.target == region:
            assets.append(unit)
        elif unit.domain == "naval" and unit.mission == "asw" and unit.region == region:
            assets.append(unit)
        elif unit.domain == "submarine" and unit.mission in {"barrier", "hunt_submarines"} and unit.region == region:
            assets.append(unit)
    return assets


def _resolve_undersea(state: GameState, rng: random.Random) -> None:
    for side in ("BLUE", "RED"):
        hostile: Side = "RED" if side == "BLUE" else "BLUE"
        for region, region_data in state.regions.items():
            assets = _search_assets(state, side, region)
            targets = [u for u in state.units.values() if u.side == hostile and u.domain == "submarine"
                       and u.region == region and u.active and u.mission != "rearm"]
            if not assets or not targets:
                continue
            search_power = sum(a.search * a.strength * a.readiness for a in assets)
            environment = float(region_data.get("asw_detection", 1.0))
            for target in targets:
                stealth = 0.72 if target.kind == "nuclear_submarine" else 0.58
                probability = min(0.92, 1.0 - math.exp(-search_power * environment * (1.0 - stealth) / 5.0))
                if rng.random() > probability:
                    continue
                contact = _update_contact(state, side, target, 0.28 + probability * 0.55)
                _event(state, "ASW", f"{side} ASW forces developed a {contact.classification.lower()} submarine contact in {state.regions[region]['name']}.",
                       visibility=side, kind="contact", side=side, target=target.id, region=region,
                       classification=contact.classification, confidence=contact.confidence)
                if contact.classification not in {"LOCALIZED", "IDENTIFIED"}:
                    continue
                shooters = [a for a in assets if a.weapons.get("asw", 0.0) >= 1]
                if not shooters:
                    continue
                shooter = max(shooters, key=lambda a: a.search * a.readiness)
                shooter.weapons["asw"] -= 1
                hit_probability = min(0.65, 0.12 + 0.42 * contact.confidence + 0.06 * environment)
                if rng.random() <= hit_probability:
                    loss = min(target.strength, rng.uniform(0.45, 1.0))
                    target.strength -= loss
                    _event(state, "ASW", f"{shooter.name} attacked the localized contact and reduced it by {loss:.1f} submarine strength.",
                           kind="strike", side=side, target=target.id, region=region, loss=loss)
                else:
                    _event(state, "ASW", f"{shooter.name} attacked the localized contact without a confirmed effect.",
                           visibility=side, kind="strike", side=side, target=target.id, region=region, loss=0.0)
    for side in ("BLUE", "RED"):
        hostile: Side = "RED" if side == "BLUE" else "BLUE"
        for sub in [u for u in state.units.values() if u.side == side and u.domain == "submarine" and u.active]:
            if sub.mission == "rearm":
                sub.weapons = copy.deepcopy(sub.max_weapons)
                sub.readiness = min(1.0, sub.readiness + 0.2)
                _event(state, "REARM", f"{sub.name} rearmed at its home port.", visibility=side,
                       kind="rearm", side=side, unit=sub.id, region=sub.region)
                continue
            mine_threat = float(state.regions[sub.region].get("asw_mines", {}).get(hostile, 0.0))
            if mine_threat and rng.random() < mine_threat:
                loss = min(sub.strength, rng.uniform(0.3, 0.8))
                sub.strength -= loss
                _event(state, "ASW", f"{sub.name} suffered {loss:.1f} attrition transiting an ASW mine barrier.",
                       visibility=side, kind="strike", side=hostile, target=sub.id, region=sub.region, loss=loss)
            if sub.mission != "hunt_shipping" or not sub.active:
                continue
            targets = _surface_targets(state, hostile, sub.region)
            shots = min(2.0, sub.weapons.get("torpedo", 0.0))
            if not targets or shots <= 0:
                continue
            target = max(targets, key=lambda u: (u.kind == "amphibious", u.capacity, u.strength))
            sub.weapons["torpedo"] -= shots
            loss = min(target.strength, shots * rng.uniform(0.18, 0.48) * sub.readiness)
            _damage_unit(target, loss)
            contact = _update_contact(state, hostile, sub, rng.uniform(0.28, 0.48))
            _event(state, "SUBMARINE", f"{side} submarines torpedoed {target.name}, reducing it by {loss:.1f} strength.",
                   kind="strike", side=side, target=target.id, unit=sub.id, region=sub.region, loss=loss)
            _event(state, "ASW", f"{hostile} sensors detected a submarine after its attack.", visibility=hostile,
                   kind="contact", side=hostile, target=sub.id, region=sub.region,
                   classification=contact.classification, confidence=contact.confidence)


def _resolve_lift(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    amphibious = [u for u in state.units.values() if u.side == "RED" and u.kind == "amphibious"
                  and u.region == "taiwan_strait" and u.active]
    total_capacity = sum(u.capacity * u.readiness for u in amphibious)
    deployed = [g for g in state.ground_units.values() if g.side == "RED" and g.active]
    sustainment_need = sum(g.strength * g.supply_need for g in deployed)
    sustained = min(total_capacity, sustainment_need)
    remaining_sustainment = sustained
    for ground in sorted(deployed, key=lambda g: g.supply):
        need = ground.strength * ground.supply_need
        supplied = min(need, remaining_sustainment)
        remaining_sustainment -= supplied
        ratio = supplied / need if need else 1.0
        ground.supply = min(1.0, ground.supply + 0.15) if ratio >= 0.95 else max(0.15, ground.supply - (1.0 - ratio) * 0.4)
    available = max(0.0, total_capacity - sustainment_need)

    for order in [o for o in orders["RED"] if o["type"] == "amphibious_lift"]:
        if available <= 0:
            break
        transport = state.units[order["unit_id"]]
        ground = state.ground_units[order["ground_unit_id"]]
        committed = min(float(order["amount"]), transport.capacity * transport.readiness, available)
        if committed <= 0 or not ground.available:
            continue
        insertion, target = order["insertion"], order["target"]
        loaded_strength = min(ground.reserve_strength, committed / max(0.1, ground.lift_cost))
        beach_defense = sum(g.defense * g.strength for g in state.ground_units.values()
                            if g.side == "BLUE" and g.hex_id == target and g.active)
        coastal = float(state.ground_hexes[target].get("coastal_defense", 0.0))
        insertion_factor = {"amphibious": 1.0, "air_assault": 0.55, "airborne": 0.45, "captured_port": 1.2}[insertion]
        survival = max(0.2, 1.0 - coastal * 0.035 - beach_defense * 0.004) * rng.uniform(0.78, 0.98)
        delivered = loaded_strength * survival * insertion_factor
        ground.reserve_strength = max(0.0, ground.reserve_strength - loaded_strength)
        ground.strength += delivered
        ground.hex_id = target
        ground.supply = min(1.0, committed / max(0.1, loaded_strength * ground.lift_cost))
        ground.mission = "defend"
        available -= committed
        _event(state, "LIFT", f"{transport.name} committed {committed:.1f}k tons and delivered {delivered:.1f} strength of {ground.name} to {state.ground_hexes[target]['name']}.",
               kind="movement", side="RED", unit=ground.id, from_region="taiwan_strait", to_region="taiwan",
               ground_hex=target, requested=order["amount"], committed=committed, delivered=delivered,
               insertion=insertion, sustainment=sustainment_need)
    if deployed and sustained < sustainment_need:
        _event(state, "LOGISTICS", f"RED lift supplied only {sustained:.1f}k of {sustainment_need:.1f}k tons required ashore; formation supply declined.",
               kind="assessment", side="RED", region="taiwan", supplied=sustained, required=sustainment_need)


def _resolve_ground(state: GameState, orders: dict[Side, list[dict[str, Any]]], rng: random.Random) -> None:
    ordered: set[str] = set()
    for side in ("BLUE", "RED"):
        for order in orders[side]:
            if order["type"] != "ground_order":
                continue
            unit = state.ground_units[order["unit_id"]]
            ordered.add(unit.id)
            unit.mission = order.get("mission", "defend")
            unit.target = order.get("target", unit.hex_id)
            if unit.mission in {"attack", "move"} and unit.target != unit.hex_id:
                origin = unit.hex_id
                unit.hex_id = unit.target
                _event(state, "GROUND_MOVEMENT", f"{unit.name} moved from {state.ground_hexes[origin]['name']} to {state.ground_hexes[unit.hex_id]['name']}.",
                       kind="movement", side=side, unit=unit.id, region="taiwan", ground_hex=unit.hex_id)
    for side in ("BLUE", "RED"):
        posture = max([float(o.get("intensity", 0.0)) for o in orders[side] if o["type"] == "ground_attack"] or [0.0])
        if posture <= 0:
            continue
        for unit in [g for g in state.ground_units.values() if g.side == side and g.active and g.id not in ordered]:
            enemy_hexes = [h for h in state.ground_hexes[unit.hex_id].get("adjacent", [])
                           if any(e.side != side and e.active and e.hex_id == h for e in state.ground_units.values())]
            if enemy_hexes:
                origin = unit.hex_id
                unit.hex_id = enemy_hexes[0]
                unit.target = unit.hex_id
                unit.mission = "attack"
                _event(state, "GROUND_MOVEMENT", f"{unit.name} advanced into {state.ground_hexes[unit.hex_id]['name']}.",
                       kind="movement", side=side, unit=unit.id, region="taiwan", ground_hex=unit.hex_id,
                       from_ground_hex=origin)

    red_air = _air_power(state, "RED", "taiwan", "ground_support")
    blue_air = _air_power(state, "BLUE", "taiwan", "ground_support")
    red_interdiction = _air_power(state, "BLUE", "taiwan", "interdiction")
    for unit in state.ground_units.values():
        if unit.side == "RED" and unit.active and red_interdiction > 0:
            unit.supply = max(0.15, unit.supply - min(0.25, red_interdiction * 0.012))

    for hex_id, ground_hex in state.ground_hexes.items():
        blue = [g for g in state.ground_units.values() if g.side == "BLUE" and g.hex_id == hex_id and g.active]
        red = [g for g in state.ground_units.values() if g.side == "RED" and g.hex_id == hex_id and g.active]
        if not blue or not red:
            if blue:
                ground_hex["controller"] = "BLUE"
            elif red:
                ground_hex["controller"] = "RED"
            continue
        ground_hex["controller"] = "CONTESTED"
        blue_power = sum(g.strength * (g.attack if g.mission == "attack" else g.defense) * (0.45 + 0.55 * g.supply) for g in blue)
        red_power = sum(g.strength * (g.attack if g.mission == "attack" else g.defense) * (0.45 + 0.55 * g.supply) for g in red)
        blue_power += blue_air * 0.18
        red_power += red_air * 0.18
        blue_loss = min(sum(g.strength for g in blue), red_power / max(1.0, blue_power + red_power) * rng.uniform(0.45, 1.15))
        red_loss = min(sum(g.strength for g in red), blue_power / max(1.0, blue_power + red_power) * rng.uniform(0.45, 1.15))
        _loss_ground(blue, blue_loss)
        _loss_ground(red, red_loss)
        survivors_blue, survivors_red = any(g.active for g in blue), any(g.active for g in red)
        ground_hex["controller"] = "CONTESTED" if survivors_blue and survivors_red else "BLUE" if survivors_blue else "RED" if survivors_red else "NONE"
        _event(state, "GROUND", f"Combat at {ground_hex['name']}: PLA lost {red_loss:.1f}, Taiwan lost {blue_loss:.1f}.",
               kind="engagement", region="taiwan", ground_hex=hex_id, red_loss=red_loss, blue_loss=blue_loss,
               controller=ground_hex["controller"])


def _loss_ground(units: list[GroundUnit], amount: float) -> None:
    total = sum(u.strength for u in units)
    for unit in units:
        share = amount * unit.strength / max(0.01, total)
        unit.strength = max(0.0, unit.strength - share)
        if unit.supply < 0.35:
            unit.strength = max(0.0, unit.strength - 0.03)


def _recover_and_assess(state: GameState) -> None:
    for base in state.bases.values():
        previous = base.damage
        base.damage = max(0.0, base.damage - (0.025 if base.kind == "airbase" else 0.015))
        if base.damage < previous:
            _event(state, "REPAIR", f"{base.name} repaired from {previous:.0%} to {base.damage:.0%} damage.",
                   kind="repair", target=base.id, region=base.region, previous_damage=previous,
                   damage=base.damage, operational=base.effectiveness)
    for unit in state.units.values():
        if unit.active:
            unit.readiness = min(1.0, unit.readiness + (0.04 if unit.mission == "reserve" else 0.01))


def _update_metrics(state: GameState) -> None:
    state.metrics["red_lodgment"] = round(sum(g.strength for g in state.ground_units.values() if g.side == "RED" and g.active), 3)
    state.metrics["taiwan_defense"] = round(sum(g.strength for g in state.ground_units.values() if g.side == "BLUE" and g.active), 3)
    total_weight = sum(float(h.get("control_value", 1.0)) for h in state.ground_hexes.values()) or 1.0
    red_weight = sum(float(h.get("control_value", 1.0)) * (1.0 if h.get("controller") == "RED" else 0.5 if h.get("controller") == "CONTESTED" else 0.0)
                     for h in state.ground_hexes.values())
    state.metrics["taiwan_control"] = round(100.0 * red_weight / total_weight, 2)
    supplies = [g.supply for g in state.ground_units.values() if g.side == "RED" and g.active]
    state.metrics["red_ground_supply"] = round(sum(supplies) / len(supplies), 3) if supplies else 0.0
    _event(state, "ASSESSMENT", f"Turn {state.turn} complete: PLA controls {state.metrics['taiwan_control']:.0f}% of ground-map value; {state.metrics['red_lodgment']:.1f} PLA strength remains ashore.",
           kind="assessment", region="taiwan", control=state.metrics["taiwan_control"], lodgment=state.metrics["red_lodgment"])


def _check_victory(state: GameState) -> None:
    control, defense, lodgment = state.metrics["taiwan_control"], state.metrics["taiwan_defense"], state.metrics["red_lodgment"]
    if control >= 80 or (defense <= 1.5 and lodgment >= 8):
        state.status, state.winner = "COMPLETE", "RED"
        _event(state, "VICTORY", "RED achieved a sustainable operational occupation of Taiwan.")
    elif state.turn >= state.max_turns:
        state.status = "COMPLETE"
        state.winner = "BLUE" if control < 50 else "DRAW"
        message = "BLUE denied occupation through the scenario horizon." if state.winner == "BLUE" else "The campaign ended in an unresolved contested lodgment."
        _event(state, "VICTORY", message)
