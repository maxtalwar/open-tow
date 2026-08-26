# Agent API

Open TOW exposes the same authoritative engine to humans, scripted policies, language models, and future reinforcement-learning adapters.

## Observation

```http
GET /api/observation?side=BLUE
```

The response includes the side's objective and a side-filtered state. It exposes the operational-area graph, the separate 30 km Taiwan ground graph, visible formations, weapon inventories, ground supply, and observer-specific submarine contacts. An undetected hostile submarine is omitted entirely; a contact appears as an uncertain track without exact strength, readiness, weapons, or mission.

## Legal-action schema

```http
GET /api/order-schema
```

The schema describes supported action shapes. The engine remains authoritative: agents cannot issue orders to hostile or destroyed units, overspend named weapon inventories or lift, move formations beyond their graph allowance, use a weapon from an incompatible platform, or assign domain-incompatible missions. Generic missile strikes cannot target submerged submarines; agents must generate a sufficient ASW contact and use an ASW-capable formation.

The principal action families are long-range strike, air mission, air rebase, surface movement/mission, submarine mission, amphibious lift, and formation-level ground order. A side may submit any number of orders, but each formation has mutually exclusive movement, mission, or lift slots and every allocation is validated against finite capacity.

## Submit a turn

```http
POST /api/turn
Content-Type: application/json

{
  "side": "BLUE",
  "orders": [
    {
      "type": "air_mission",
      "unit_id": "blue_air_5g_1",
      "mission": "cap",
      "target": "taiwan"
    }
  ]
}
```

The server supplies a doctrine-agent opponent and resolves the complete turn.

## LLM adapter pattern

Give the model only:

1. its side-specific observation;
2. the action schema;
3. its strategic objective; and
4. a requirement to return a JSON object with `side` and `orders`.

Validate the result locally before submission. Never ask the model to calculate combat losses or mutate game state.

## Baseline agents

`DoctrineAgent` is deliberately simple and inspectable. It provides a repeatable behavioral baseline, not a claim about real doctrine. It can be replaced by an external process while retaining the same observation and action envelopes.

## Reinforcement-learning adapter

A future PettingZoo parallel environment can map:

- observation: normalized visible state plus action mask;
- action: hierarchical selection of action type, unit, mission, target, and allocation;
- transition: one call to `resolve_turn` after both sides commit;
- reward: a configurable vector containing objective progress, force preservation, munitions, escalation, and civilian-harm penalties.

Training should randomize uncertain scenario parameters and use held-out excursion cases. A single-policy win rate on the base scenario is not a meaningful evaluation.
