from __future__ import annotations

import argparse
import json

from .agents import DoctrineAgent
from .engine import resolve_turn
from .scenario import load_scenario


def main() -> None:
    parser = argparse.ArgumentParser(description="Run reproducible Open TOW simulations")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--turns", type=int, default=8)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()
    state = load_scenario(seed=args.seed)
    while state.status == "ACTIVE" and state.turn <= args.turns:
        resolve_turn(state, {
            "BLUE": DoctrineAgent("BLUE").orders(state),
            "RED": DoctrineAgent("RED").orders(state),
        })
    if args.as_json:
        print(json.dumps(state.to_dict(), indent=2))
    else:
        print(f"seed={state.seed} status={state.status} winner={state.winner}")
        print(f"control={state.metrics['taiwan_control']:.1f}% lodgment={state.metrics['red_lodgment']:.1f} defense={state.metrics['taiwan_defense']:.1f}")
        print(f"events={len(state.events)} turns_resolved={len(state.orders_history)}")


if __name__ == "__main__":
    main()

