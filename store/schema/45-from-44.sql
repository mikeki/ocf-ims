/* Phase 6 (feedback round 4) — explicit "kept but inactive" participation states.

   The per-event People roster (slice 6j) distinguishes two kinds of removal:
   a person added by mistake is deleted outright, but a person who was ejected or
   is simply not present this year is KEPT for the record. To capture the latter
   without a new column, PARTICIPATION_TYPE gains two values:

     - not_present : known person, not participating in this event this year
     - ejected     : removed from the event (kicked out), kept for the record

   crew/participant/public remain the active roster; the two new values are the
   kept-but-inactive states. Who and when is captured by the action log on the
   mutating request, so no extra columns are needed.

   Schema-only: no data is migrated (OCF launches on a fresh DB). */

alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
        enum('crew', 'participant', 'public', 'not_present', 'ejected')
        not null default 'public';

update `SCHEMA_INFO`
set `VERSION` = 45
where true;
