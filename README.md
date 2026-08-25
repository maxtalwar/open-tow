# Open TOW

**Open TOW** is an independent, open-source digital reconstruction inspired by the public design of the CSIS Taiwan Operational Wargame described in *[The First Battle of the Next War](https://www.csis.org/analysis/first-battle-next-war-wargaming-chinese-invasion-taiwan)*.

It is a browser-playable operational campaign simulation with a deterministic Python engine.

> [!IMPORTANT]
> This project is not official CSIS, U.S. Government, etc software and isn't endorsed by those organizations. This is an educational project I built to improve a flaw I see in existing wargames. 

## Why this project exists

Professional wargames are often difficult to reproduce because the assumptions they use are scattered, adjudication is partly manual, and the resulting data can't easily be used to make simulations or do data analytics at scale. I think this is a major flaw that can be fixed by codifying the rules in software will fix this. It will also enable really cool experiments like using LLMs as actors in the wargame and  even training deep learning models to command troops. 

Over time I will scale this to be highly realistic and a potential model for wargames, but for now it is in beta. 

## Current MVP

You play as either Blue, representing coalition forces, or Red, representing PLA forces. The opponent is limited at present to an agent with preset rules, but soon there will be many adversary modes, including agent-vs-agent conflicts. 

Here are the important features about the simulation's behavior:
- Each operational turn represents 3.5-days across an abstract Western Pacific map
- It contains air, surface, submarine, amphibious, and base formations
- missile-first phase sequencing
- air superiority, base strike, maritime strike, ground support, and rebasing
- surface movement, surface engagements, submarine interdiction, and ASW abstraction
- Red (PLA) amphibious lift is constrained by shipping losses and sustainment demand
- ground combat and territorial-control objectives determine victory
- seeded deterministic adjudication and complete order/event history
- doctrine agents for both sides

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

No package installation is required from a source checkout, there are zero runtime dependencies beyond Python 3.11+. An editable install is optional:

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

My implementation comes in three categories, because while parts of it are based off of the original CSIS wargame, there is not enough publicly available information to make an exact replica. 

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

The engine never uses an LLM to determine combat outcomes. Language models can reason, negotiate, and issue orders, but the transparent rules engine remains authoritative. That said, in the future I will implement LLMs (as well as custom-trained models) to act as agents playing the game. 

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


