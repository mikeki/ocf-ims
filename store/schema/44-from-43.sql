/* Phase 6 (feedback round 1) — booth number on incidents.

   Stakeholder feedback asked to capture a booth number alongside the structured
   AREA and the freeform LOCATION_DESCRIPTION. Rather than overload the freeform
   box or model booths as areas, we add a dedicated short field. It is nullable
   (most incidents have no booth) and lives next to the other LOCATION_* columns
   conceptually, but is appended last to match the ALTER ... ADD COLUMN below.

   Schema-only: no data is migrated (OCF launches on a fresh DB). */

alter table INCIDENT
    add column LOCATION_BOOTH varchar(32);

update `SCHEMA_INFO`
set `VERSION` = 44
where true;
