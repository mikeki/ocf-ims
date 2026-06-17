# OCF Location Areas — proposal for sign-off

This is a proposed set of **location areas** for the IMS incident form (the
structured "Area" dropdown that sits alongside the freeform location box and the
optional booth number).

**Source:** read off the two 2024 maps —
[the public PeachPit map](https://www.oregoncountryfair.org/wp-content/uploads/2024/07/2024-PeachPit-Map.pdf)
and the
[Operations map](https://oregoncountryfair.net/wp-content/uploads/2024/03/2024-operations-map.pdf).

**Scope chosen:** *public areas + key operational zones.* We deliberately did
**not** seed every camp, gate, and parking lot from the Operations map (60+
labels) — most are never used as an incident location. Booth-corridor "street"
names (Oops Avenue, Spring Street, Park Street, Strawberry Lane, Star Lane, Shady
Lane, Nellie's Alley, Snivel Lane) are also left out: they're finer-grained than
a Ranger needs to pick from a dropdown, and the freeform box + booth number
already cover that precision.

**How it nests:** the form supports one level of nesting. Two parents group
their children — **White Bird** (Rock Medicine) and **Camping**. Everything else
is top-level.

> **Please review and edit:** add/remove/rename freely. Once signed off, this
> replaces the draft in `store/fakeimsdb/seed.sql` and becomes the canonical
> seed. A few rows below are flagged **(confirm)** where the map label was
> ambiguous or the area's usefulness as an incident location is uncertain.

## Proposed areas

### Public neighborhoods, plazas & landmarks

| Name | Slug | Notes |
|---|---|---|
| Main Stage | `main-stage` | Includes the Main Stage Meadow. |
| Dragon Plaza | `dragon-plaza` | |
| Xavanadu | `xavanadu` | |
| Chela Mela | `chela-mela` | "Chela Mela Meadow" on some maps. |
| Community Village | `community-village` | |
| Energy Park | `energy-park` | |
| Peace Park | `peace-park` | |
| People's Park | `peoples-park` | |
| Chase Gardens | `chase-gardens` | |
| Galleria Philanthropia | `galleria-philanthropia` | |
| The Left Bank | `the-left-bank` | |
| Moon Park | `moon-park` | |
| Spirit Tower | `spirit-tower` | |
| The Ritz | `the-ritz` | The sauna. |
| Black Oak Park | `black-oak-park` | **(confirm)** small, near the upper loops. |

### Stages

| Name | Slug | Notes |
|---|---|---|
| Kesey Stage | `kesey-stage` | |
| Caravan Stage | `caravan-stage` | |
| Morning Glory Stage | `morning-glory-stage` | **(confirm)** label was near the SW edge. |
| W.C. Fields Memorial Stage | `wc-fields-stage` | |
| Blue Moon Stage | `blue-moon-stage` | |
| Youth Stage | `youth-stage` | |
| Vaudeville Palace | `vaudeville-palace` | The "Stage Left" area sits beside it. |

### White Bird (Rock Medicine) — *parent*

| Name | Slug | Parent |
|---|---|---|
| White Bird | `white-bird` | — |
| Big Bird | `big-bird` | White Bird |
| Little Wing | `little-wing` | White Bird |

### Operational zones

| Name | Slug | Notes |
|---|---|---|
| Far Side | `far-side` | The big meadow east of the main loops. |
| The Hub | `the-hub` | |
| Trotter's Field | `trotters-field` | **(confirm)** west-side field/parking. |

### Camping — *parent*

| Name | Slug | Parent |
|---|---|---|
| Camping | `camping` | — |
| Main Camp | `main-camp` | Camping |
| Big Oak Camp | `big-oak-camp` | Camping |
| Sol Creek Camp | `sol-creek-camp` | Camping |
| Miss Piggy | `miss-piggy` | Camping |
| SCOF | `scof` | Camping |
| South Woods | `south-woods` | Camping |

## Candidates intentionally left out

Surfaced on the maps but **not** proposed as areas — call out any you'd want
added:

- **More stages:** Daredevil/other small stages weren't legible enough to be sure.
- **Public landmarks (minor):** Polites Park, The Void, Graceland, Jill's
  Landing, Wally's Way, The Front Porch, The Rabbit Hole, The Junction. Many are
  small spots; promote any that Rangers actually name on the radio.
- **Booth "streets"/lanes:** Oops Avenue, Spring Street, Park Street, Strawberry
  Lane, Star Lane, Shady Lane, Nellie's Alley, Snivel Lane.
- **More camps:** Zumwalt, EZ Camp / McVay, Carefree Farms, GnomeWood, plus the
  many private reunion camps.
- **Gates (Operations map):** Aero, Cabal, Chickadee, Maple, Strickland, Bus,
  Watergate, Island, Farside, Outta Site, EZ, McVey, WoodWorld, Reefer, Emerge
  Wind — useful for Security ops but probably not incident locations.
- **Parking / back-of-house:** Dead Lot, Tower Lot, SCOF Lot, Motor Pool,
  Recycling, the Effluent Spray Area.
