/* Add a local IS_ADMIN flag to PERSON so administrators can be managed in-app
   instead of only through the IMS_ADMINS environment list. A person with
   IS_ADMIN set is granted the Administrator role's global permissions; the env
   list is kept as a bootstrap so a fresh database (with no admins yet) is still
   recoverable. This is a structural addition only; no rows are added or moved. */

alter table PERSON
    add column IS_ADMIN boolean not null default false;

update `SCHEMA_INFO`
set `VERSION` = 41
where true;
