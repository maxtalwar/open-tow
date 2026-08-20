# Open TOW

**Open TOW** is an independent, open-source digital reconstruction inspired by the public design of the CSIS Taiwan Operational Wargame described in *[The First Battle of the Next War](https://www.csis.org/analysis/first-battle-next-war-wargaming-chinese-invasion-taiwan)*.

It is a browser-playable operational campaign simulation with a deterministic Python engine, side-specific observations, doctrine-agent baselines, a machine-readable order API, replayable event logs, and seeded batch simulations.

> [!IMPORTANT]
> Open TOW is not official CSIS, U.S. Government, or Department of Defense software and is not endorsed by those organizations. Published mechanics are cited; missing quantities and adjudication functions are transparent synthetic reconstructions. This is an educational research platform, not a forecast or an operational planning tool.

## Why this project exists

Professional wargames are often difficult to reproduce: assumptions are scattered, adjudication is partly manual, and the resulting data cannot easily be consumed by software agents. Open TOW tests a different approach:

- keep the authoritative game engine separate from human and AI players;
- make every order and adjudication outcome auditable;
- expose exactly the same legal action surface to people, LLMs, and scripted agents;
- preserve uncertainty with seeds and configurable scenario parameters; and
- document which mechanics are sourced, inferred, or original.

## Current MVP

- 3.5-day operational turns across an abstract Western Pacific map
- BLUE and RED air, surface, submarine, amphibious, and base formations
- missile-first phase sequencing
- air superiority, base strike, maritime strike, ground support, and rebasing
- surface movement, surface engagements, submarine interdiction, and ASW abstraction
- amphibious lift constrained by shipping losses and sustainment demand
- aggregate ground combat and territorial-control objectives
- partial observations for hidden opposing submarine strength
- seeded deterministic adjudication and complete order/event history
- doctrine agents for both sides
- HTTP/JSON agent interface and browser command interface
- zero runtime dependencies beyond Python 3.11+

## Run locally

```bash
python -m opentow.api
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

Run a reproducible agent-versus-agent campaign:

```bash
python -m opentow.cli --seed 7 --turns 8
python -m opentow.cli --seed 7 --turns 8 --json
```

Run the test suite:

```bash
python -m unittest discover -s tests -v
```

No package installation is required from a source checkout. An editable install is optional:

```bash
python -m pip install -e .
open-tow --port 8080
```

## Agent interface

An agent obtains a side-specific observation:

```http
GET /api/observation?side=BLUE
```

It submits a turn bundle using the same actions as a human player:

```json
{
  "side": "BLUE",
  "orders": [
    {
      "type": "submarine_patrol",
      "unit_id": "blue_sub_1",
      "target": "taiwan_strait"
    },
    {
      "type": "air_mission",
      "unit_id": "blue_air_5g_1",
      "mission": "cap",
      "target": "taiwan"
    }
  ]
}
```

```http
POST /api/turn
Content-Type: application/json
```

The server validates ownership, target legality, domain constraints, adjacency, readiness, and munition/lift availability before resolving the turn. See [Agent API](docs/AGENT_API.md).

## Design provenance

The implementation distinguishes three categories:

| Category | Examples |
|---|---|
| Published CSIS design | 3.5-day turns; aggregate aircraft and submarine formations; operational/ground-map separation; missile-first resolution; mission categories; amphibious lift and sustainment; scenario excursions |
| Reconstructed | force quantities, map adjacency, loss functions, airbase-capacity effects, victory thresholds |
| Original digital layer | JSON order protocol, state visibility filtering, doctrine agents, browser UI, event schema, deterministic replay interface |

The scenario file carries this metadata alongside the game parameters. See [Methodology](docs/METHODOLOGY.md) and [Sources](docs/SOURCES.md).

## Architecture

```text
data/scenarios/*.json
          │
          ▼
  authoritative engine ─── seeded adjudication ─── event/order history
          │
     ┌────┼────────────┐
     ▼    ▼            ▼
 browser  HTTP API   doctrine agents
                     LLM/RL adapters
```

The engine never uses an LLM to determine combat outcomes. Language models can reason, negotiate, and issue orders, but the transparent rules engine remains authoritative.

## Repository map

```text
opentow/               Python engine, agents, HTTP API, and CLI
data/scenarios/        Versioned scenario and provenance data
static/                Dependency-free browser interface
tests/                 Determinism, validation, mechanics, and API tests
docs/                  Methodology, rules, sources, agent API, and roadmap
```

## Research roadmap

The next research milestones are scenario-parameter sweeps, a formal PettingZoo adapter, a full after-action-report export, additional political-access excursions, and validation sessions with experienced wargamers. See [Roadmap](docs/ROADMAP.md).

## Citation and license

The software is available under the MIT License. The CSIS report and any referenced third-party material remain under their respective terms; no CSIS artwork or unpublished game components are included.

If using this project academically, cite both this repository and the original CSIS study. Citation metadata is provided in [`CITATION.cff`](CITATION.cff).


