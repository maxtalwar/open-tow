# Methodology

## Purpose

Open TOW is a research and educational platform for studying operational decision-making under uncertainty. Its first scenario is an independent digital reconstruction inspired by the publicly described CSIS Taiwan Operational Wargame (TOW).

The game is designed to answer conditional questions—"what tends to happen under these assumptions and strategies?"—rather than predict whether a conflict will occur or exactly how it would unfold.

## Design inheritance

The CSIS report describes a manual, umpired operational wargame supported by die rolls, combat-result tables, and computer calculations. Open TOW preserves the following high-level structure:

1. Each turn represents 3.5 days.
2. Air and maritime operations occur on an aggregate Western Pacific map.
3. Ground operations on Taiwan resolve at a different scale.
4. Aircraft operate in aggregate squadrons and submarines in aggregate groups.
5. Ground-launched missiles resolve early in the turn.
6. Aircraft conduct air superiority, strike, ground-support, and rebase missions.
7. Naval forces maneuver as groups while submarines conduct patrol and interdiction.
8. Amphibious capacity must both deliver new formations and sustain those already ashore.
9. High-end munitions are finite.
10. Multiple seeded iterations reveal sensitivity to assumptions and strategies.

## Reconstruction policy

The public report does not contain every umpire rule, lookup table, order of battle, or supporting calculation. Open TOW therefore uses a strict classification policy:

- **Published:** directly described in the public study.
- **Reconstructed:** an implementation selected to complete a published mechanic.
- **Original:** a software, interface, or agent feature not claimed to be part of the CSIS design.

The scenario JSON records this classification. No unpublished CSIS materials or artwork are included.

## Adjudication

Combat functions combine transparent strength, readiness, mission, base-damage, sustainment, and bounded-random factors. A random generator is initialized from the scenario seed and turn number, making identical turns replayable.

Randomness represents unresolved uncertainty within the model—not metaphysical chance and not an estimate of real weapon reliability. Results should be evaluated over many seeds and parameter excursions.

## Information model

The server owns authoritative state. An observing side receives a filtered copy; opposing hidden submarine formations retain their location marker in the MVP but conceal strength, readiness, mission, and target. Future versions should implement probabilistic contact tracks rather than formation-level visibility.

## Validation strategy

Validation has four layers:

1. **Software verification:** order validation, invariant checks, deterministic replay, API tests.
2. **Face validity:** structured review of mechanics by experienced players or subject-matter experts.
3. **Behavioral validity:** checking whether broad relationships behave plausibly—for example, damaged lift reduces delivery and existing lodgments consume capacity.
4. **Sensitivity analysis:** confirming that conclusions are not artifacts of a single seed or parameter choice.

The engine must not be considered validated for operational analysis without substantial additional work.

## Responsible-use boundary

The repository uses aggregate, open, and synthetic data. It intentionally excludes tactical targeting, real-time operational feeds, classified inputs, and claims of real-world predictive accuracy. Language models may issue orders, but they do not adjudicate outcomes.

