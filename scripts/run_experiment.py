from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from opentow.agents import DoctrineAgent  # noqa: E402
from opentow.engine import resolve_turn  # noqa: E402
from opentow.scenario import load_scenario  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a seeded Open TOW experiment batch")
    parser.add_argument("--start-seed", type=int, default=1)
    parser.add_argument("--runs", type=int, default=100)
    parser.add_argument("--output", default="experiment-results.csv")
    args = parser.parse_args()
    rows = []
    for seed in range(args.start_seed, args.start_seed + args.runs):
        state = load_scenario(seed=seed)
        while state.status == "ACTIVE":
            resolve_turn(state, {
                "BLUE": DoctrineAgent("BLUE").orders(state),
                "RED": DoctrineAgent("RED").orders(state),
            })
        rows.append({
            "seed": seed,
            "winner": state.winner,
            "taiwan_control": round(state.metrics["taiwan_control"], 3),
            "red_lodgment": round(state.metrics["red_lodgment"], 3),
            "taiwan_defense": round(state.metrics["taiwan_defense"], 3),
            "turns": len(state.orders_history),
        })
    output = Path(args.output)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    winners = {name: sum(row["winner"] == name for row in rows) for name in ("BLUE", "RED", "DRAW")}
    print(f"wrote {len(rows)} runs to {output}")
    print(" ".join(f"{name}={count}" for name, count in winners.items()))


if __name__ == "__main__":
    main()

