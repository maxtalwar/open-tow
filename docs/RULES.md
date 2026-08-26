# Rules summary

## Objective and scale

- **RED / PLA:** land, sustain, and maneuver enough ground combat power to occupy Taiwan.
- **BLUE / Coalition:** destroy or isolate the invasion force and deny a sustainable occupation.
- One turn represents **3.5 days**.
- Air and naval operations use linked operational areas representing roughly **600 km hexes**.
- Taiwan ground combat uses a separate graph of roughly **30 km hexes**.

Political-entry and basing excursions are intentionally deferred. The current scenario starts with a fixed set of participants and access assumptions.

## Turn sequence

1. Validate and commit both sides' simultaneous orders.
2. Decay stale undersea contacts.
3. Resolve ground-launched missile attacks.
4. Apply rebasing, surface movement, submarine transit, and mission assignments.
5. Resolve air superiority and airbase strikes.
6. Resolve air and ship attacks against located surface forces.
7. Resolve ASW search, localization, submarine attacks, mine barriers, and rearming.
8. Deduct amphibious capacity required to sustain forces ashore, then resolve new lift.
9. Move and fight ground formations on the Taiwan map.
10. Repair bases, recover readiness, update control and supply, and assess victory.

## Undersea warfare

Enemy submarines do not appear in a side's observation until detected. ASW-capable maritime-patrol aircraft, surface groups, and submarines conducting barrier or hunt missions build side-specific contacts through these states:

1. `DETECTED` — a submarine contact exists in an operational area.
2. `LOCALIZED` — the contact is precise enough to attack with an ASW weapon.
3. `IDENTIFIED` — the contact's formation type and identity are known.

Contacts lose confidence between turns. A submarine that attacks shipping creates a contact for the defender. Generic missile strikes cannot target deployed submarines. Submarines can be damaged by ASW weapons, opposing submarines, mine barriers, or collateral damage while in port.

Submarine torpedoes and ASW weapons are finite. A submarine must return to its home-port operational area and spend a rearm mission to restore its magazine.

## Air, missile, and surface missions

Missile and air strikes consume named weapon inventories. Weapons have target roles and operational-area reach. A land-attack weapon cannot attack a ship, and an anti-ship weapon cannot attack an airbase. Aircraft mission reach depends on formation type; distance also reduces persistence and combat power.

Air missions are CAP, airbase strike, maritime strike, ground support, interdiction, ASW, or reserve. Surface groups can conduct surface strike, air and missile defense, ASW, escort, rearm, or reserve missions. Ships carry their own finite anti-ship, air-defense, and ASW magazines.

## Amphibious lift and Taiwan ground combat

Amphibious capacity is measured in thousands of tons per turn. Existing PLA formations ashore consume lift for sustainment before any new formation can land. Infantry, mechanized, armor, artillery, airborne, and engineer formations require different tonnage and supply.

An amphibious order selects a transport group, reserve formation, insertion method, and legal beach or port hex. Coastal defense and defending ground power reduce delivered strength. Unsupplied formations lose effectiveness and can suffer continuing attrition.

Deployed formations receive defend, move, attack, or reserve orders. Movement is constrained by the 30 km ground adjacency graph. Combat power depends on formation type, mission, remaining strength, supply, air support, and interdiction. Control is calculated from the weighted controllers of the Taiwan ground hexes rather than from an independent progress meter.

## Replay and information

Every turn stores both order bundles. Random adjudication uses `scenario seed + turn × 1009`, so identical starting states and orders replay identically. Public events are visible to both sides; contact-development and some submarine movement events are visible only to the owning or detecting side.

All probabilities, inventories, and loss coefficients are open synthetic reconstruction parameters. They are software inputs for sensitivity analysis, not real-world operational estimates.
