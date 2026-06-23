# OCF Location Areas — proposal for sign-off

A proposed set of **location areas** for the IMS incident form (the structured
"Area" dropdown that sits alongside the freeform location box and the optional
booth number).

**Source:** read off / curated from the two 2024 maps —
[the public PeachPit map](https://www.oregoncountryfair.org/wp-content/uploads/2024/07/2024-PeachPit-Map.pdf)
and the
[Operations map](https://oregoncountryfair.net/wp-content/uploads/2024/03/2024-operations-map.pdf).

## Current direction — a single flat list, no nesting

The schema supports a parent → child hierarchy, but for now we are **not** using
it: every area is a flat, top-level entry. Nesting was explored (neighborhoods or
streets as parents) but proved fiddly to get right under the beta UI's
single-level limit, so it's parked.

**The working set lives in [`ocf-areas-flat.md`](ocf-areas-flat.md)** — that's the
canonical list this seed implements. It's grouped there (Zones / Stages / Streets
/ Gates) purely for reading; the groups are not parents.

> **Status: draft, still being trimmed.** The list is currently long (~80 areas)
> and is being narrowed as feedback comes in. The seed will track
> `ocf-areas-flat.md` as it settles. Nothing here changes the schema.
