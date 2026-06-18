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
labels) — most are never used as an incident location.

**The nesting constraint matters here.** The form supports a parent → child
hierarchy, but the beta UI enforces **exactly one level** — a parent holds
children, and a child cannot itself be a parent. So any landmark we file under a
neighborhood *and* a neighborhood we'd file under a larger zone can't both
happen; we pick one level of grouping.

> **Please review and pick a structure.** Two options are laid out below. Add /
> remove / rename / re-parent freely. Once signed off, the chosen option replaces
> the draft in `store/fakeimsdb/seed.sql` and becomes the canonical seed. Rows
> flagged **(confirm)** are where the map label was ambiguous or the area's
> usefulness as an incident location is uncertain.

---

## Option A — flat, grouped by kind *(currently in the seed)*

Top-level areas grouped by *what they are* (neighborhood, stage, ops zone). Only
two parents nest children — **White Bird** and **Camping**. Booth-corridor street
names are dropped entirely (freeform box + booth number cover that precision).
This is what `store/fakeimsdb/seed.sql` currently implements.

**Pros:** short, flat dropdown; every entry is a place a Ranger names directly.
**Cons:** a landmark "on Spring Street" with no neighborhood of its own has
nowhere natural to live, so it's either promoted to top-level or left out.

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

### Xavanadu — *parent*

| Name | Slug | Parent |
|---|---|---|
| Xavanadu | `xavanadu` | — |
| Little Wing | `little-wing` | Xavanadu |

(Little Wing is the stage in Xavanadu — not a White Bird station.)

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

---

## Option B — geographic, by where you are on the ground

Here the **parents are the places you'd stand in** — the named neighborhoods and
the booth streets/lanes — and the specific spots (stages, landmarks, services)
hang off whichever one they physically sit in or on. This mirrors how the fair is
actually laid out and how booth crews refer to locations (each lane even has a
booth "Lead").

The booth area is organized along **streets/lanes** (Oops Avenue, Spring Street,
Park Street, Nellie's Alley, Wally's Way, Strawberry Lane, Star Lane, Shady Lane),
while the open zones are **neighborhoods** (The Left Bank, Moon Park, Dragon
Plaza, Energy Park, Community Village, Peace Park, Xavanadu, Chela Mela, Far Side,
Main Stage). Both kinds act as parents — a spot lives under a *street* when it's
on a corridor with no neighborhood of its own, and under a *neighborhood* when it
sits in an open area.

**Pros:** every landmark has a home; you can pick a broad area fast (just the
parent) or drill in. Matches the map and radio usage.
**Cons:** longer list; the single-level limit forces some calls (see the ⚠️
notes), and the parent/child assignments below are read off the map and **need a
local's confirmation**.

> ⚠️ **Single-level consequences to decide:**
> - **White Bird** wants to be both a child of *Main Stage* (it sits in the
>   meadow) *and* a parent of its station *Big Bird*. Can't do both — below it
>   stays its own top-level parent. (Little Wing is a stage in *Xavanadu*, not a
>   White Bird station.)
> - A **street can't nest under a neighborhood** (that's two levels). Streets and
>   neighborhoods are siblings at the top.
> - **Camping** stays a flat parent of the camps, same as Option A.

### Neighborhoods (parents) and what's in them

| Parent (neighborhood) | Children |
|---|---|
| **Main Stage** | Food Carts · Sesame Street Child Care · The General Store **(confirm)** |
| **Dragon Plaza** | Youth Stage · Service Dog Rest Area · Vaudeville Palace · Stage Left |
| **The Left Bank** | W.C. Fields Memorial Stage · Spirit Tower · Jill's Landing · People's Park **(confirm assignments)** |
| **Moon Park** | Blue Moon Stage |
| **Energy Park** | Kesey Stage · Solar Architecture · Garden Showers · Recycling **(confirm)** |
| **Community Village** | *(self-contained; no sub-areas needed)* |
| **Peace Park** | Organic Fruit Coop **(confirm)** |
| **Xavanadu** | Little Wing · Caravan Stage · Morning Glory Stage **(confirm)** |
| **Chela Mela** | *(meadow; no sub-areas)* |
| **Far Side** | *(meadow/ops; no sub-areas)* |

### Streets / lanes (parents) and what's on them

| Parent (street) | On it |
|---|---|
| **Wally's Way** | Galleria Philanthropia · The Rabbit Hole · Story Telling · History Booth / Poster Gallery · The Front Porch · Portrait Studio · Kids Play **(confirm assignments)** |
| **Oops Avenue** | The Ritz · The Void · Black Oak Park **(confirm)** |
| **Spring Street** | Polites Park **(confirm)** |
| **Park Street** | Graceland **(confirm)** |
| **Strawberry Lane** | Chase Gardens **(confirm)** |
| **Star Lane** | *(runs through The Left Bank — keep as a lane or fold into it?)* |
| **Nellie's Alley** | *(booths only)* |
| **Shady Lane** | *(booths only — east edge by the slough)* |

### Standalone parents (same as Option A)

| Parent | Children |
|---|---|
| **White Bird** | Big Bird |
| **Camping** | Main Camp · Big Oak Camp · Sol Creek Camp · Miss Piggy · SCOF · South Woods |
| **The Hub** | *(ops zone; no sub-areas)* |
| **Trotter's Field** | *(ops zone; no sub-areas)* **(confirm)** |

> Streets that end up with only booths and no named landmark (Nellie's Alley,
> Shady Lane) could be dropped from the dropdown and left to the booth-number
> field — flag if you'd rather keep them for completeness.

---

## Candidates intentionally left out

Surfaced on the maps but **not** proposed as areas in *either* option — call out
any you'd want added:

- **More stages:** Daredevil/other small stages weren't legible enough to be sure.
- **Public landmarks (minor):** Polites Park, The Void, Graceland, Jill's
  Landing, Wally's Way, The Front Porch, The Rabbit Hole, The Junction. Many are
  small spots; promote any that Rangers actually name on the radio.
- **Booth "streets"/lanes** (left out of Option A; used as parents in Option B):
  Oops Avenue, Spring Street, Park Street, Strawberry Lane, Star Lane, Shady Lane,
  Nellie's Alley, Snivel Lane.
- **More camps:** Zumwalt, EZ Camp / McVay, Carefree Farms, GnomeWood, plus the
  many private reunion camps.
- **Gates (Operations map):** Aero, Cabal, Chickadee, Maple, Strickland, Bus,
  Watergate, Island, Farside, Outta Site, EZ, McVey, WoodWorld, Reefer, Emerge
  Wind — useful for Security ops but probably not incident locations.
- **Parking / back-of-house:** Dead Lot, Tower Lot, SCOF Lot, Motor Pool,
  Recycling, the Effluent Spray Area.
