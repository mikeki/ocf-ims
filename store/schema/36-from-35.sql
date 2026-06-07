/* Phase 4a — group incident types into OCF categories.

   Add a nullable GROUP enum to INCIDENT_TYPE (Safety / Conduct / Operations /
   Compliance). The column is added last so its `show create table` output matches
   current.sql (verified by store/integration). Existing rows keep GROUP = NULL;
   the OCF taxonomy + groupings are seeded fresh in current.sql, and demo/Fair
   databases start clean (see docs/plans/40-domain-model.md). GROUP is a reserved
   word, hence the backticks. */

alter table INCIDENT_TYPE
    add column `GROUP` enum('safety', 'conduct', 'operations', 'compliance');

update `SCHEMA_INFO`
set `VERSION` = 36
where true;
