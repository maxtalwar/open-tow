# Agent API

Open TOW exposes the same authoritative engine to humans, scripted policies, language models, and future reinforcement-learning adapters.

## Observation

```http
GET /api/observation?side=BLUE
```

The response includes the side's objective and a side-filtered state. Hidden opposing formations may have concealed strength, readiness, mission, and target fields.

## Legal-action schema

```http
GET /api/order-schema
```

The schema describes supported action shapes. The engine remains authoritative: agents cannot issue orders to hostile or destroyed units, overspend munitions or lift, move surface units across nonadjacent regions, or assign domain-incompatible missions.

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

