# Rules summary

## Objective

- **RED:** establish and sustain an operational occupation of Taiwan.
- **BLUE:** deny that occupation through the eight-turn scenario horizon.

RED wins by reaching 80 percent control or collapsing Taiwan's defense while retaining a substantial lodgment. BLUE wins if RED remains below 50 percent control at the horizon. Intermediate results are draws.

## Turn sequence

1. Validate and commit both sides' orders.
2. Resolve long-range missile strikes.
3. Apply movement, patrol, mission, and rebase assignments.
4. Resolve air superiority and strike missions.
5. Resolve surface and submarine interactions.
6. Resolve amphibious sustainment, interdiction, and delivery.
7. Resolve Taiwan ground combat and control.
8. Repair, recover readiness, record assessment, and test victory.

## Units

Units have strength, maximum strength, readiness, region, domain, kind, and current mission. Air units are assigned to bases; base damage reduces their effective power. Amphibious units also have lift capacity.

## Orders

- `missile_strike`: expend long-range munitions against an opposing base or formation.
- `air_mission`: assign air superiority, base strike, maritime strike, ground support, or reserve.
- `rebase`: move an air formation to a friendly base at a temporary readiness cost.
- `naval_move`: move a surface formation to an adjacent operational region.
- `submarine_patrol`: assign a submarine formation to a patrol region.
- `amphibious_lift`: commit surviving RED lift capacity to sustain and reinforce Taiwan.
- `ground_attack`: select operational ground intensity.

## Replay

Each resolved turn stores both order bundles. Random adjudication uses `scenario seed + turn × 1009`, so identical starting states and orders produce identical results.

