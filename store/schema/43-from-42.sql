/* Phase 5e.3 — link visit guests to the people registry.

   Slice 5e.1 added VISIT.GUEST_PERSON_ID (the link from a visit to a PERSON) but
   deliberately kept the freeform GUEST_PREFERRED_NAME column so the visit page
   kept capturing a guest name until the UI was wired to populate the link. 5e.3
   wires that up: a guest's preferred name now lives on PERSON.NAME (resolved via
   GUEST_PERSON_ID), so the freeform column is redundant and is dropped here
   (expand-now / contract-later). Episode data — legal name, description, camp
   fields, arrival/departure — stays on VISIT, gated by visit access. The registry
   holds identity; the visit holds the episode. See docs/plans/51-people-registry.md.

   Schema-only: no data is migrated (OCF launches on a fresh DB). */

alter table VISIT
    drop column GUEST_PREFERRED_NAME;

update `SCHEMA_INFO`
set `VERSION` = 43
where true;
