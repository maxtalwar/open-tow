from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Base, GameState, GroundUnit, Unit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIO = PROJECT_ROOT / "data" / "scenarios" / "csis_base_2026.json"


def load_scenario(path: str | Path | None = None, seed: int = 7) -> GameState:
    scenario_path = Path(path) if path else DEFAULT_SCENARIO
    raw: dict[str, Any] = json.loads(scenario_path.read_text(encoding="utf-8"))
    units = {item["id"]: Unit(**item) for item in raw["initial_state"]["units"]}
    bases = {item["id"]: Base(**item) for item in raw["initial_state"]["bases"]}
    ground_units = {
        item["id"]: GroundUnit(**item)
        for item in raw["initial_state"].get("ground_units", [])
    }
    return GameState(
        scenario_id=raw["id"],
        seed=seed,
        turn=1,
        max_turns=raw["max_turns"],
        status="ACTIVE",
        winner=None,
        regions=raw["regions"],
        units=units,
        bases=bases,
        munitions=raw["initial_state"]["munitions"],
        political=raw["initial_state"]["political"],
        metrics=raw["initial_state"]["metrics"],
        ground_hexes=raw.get("ground_hexes", {}),
        ground_units=ground_units,
    )


def scenario_metadata(path: str | Path | None = None) -> dict[str, Any]:
    scenario_path = Path(path) if path else DEFAULT_SCENARIO
    raw = json.loads(scenario_path.read_text(encoding="utf-8"))
    return {key: value for key, value in raw.items() if key != "initial_state"}
