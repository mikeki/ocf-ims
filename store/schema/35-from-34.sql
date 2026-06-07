/* Phase 3 PR #3 — rename the attached-person "role" column to "involvement" on both
   attached-people tables, completing the Ranger -> People vocabulary rename through
   the schema. See docs/plans/33-people-rename.md. */

alter table INCIDENT__PERSON
    change column ROLE INVOLVEMENT varchar(128);

alter table VISIT__PERSON
    change column ROLE INVOLVEMENT varchar(128);

update `SCHEMA_INFO`
set `VERSION` = 35
where true;
