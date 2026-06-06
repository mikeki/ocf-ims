/* Rename the FIELD_REPORT entity to REPORT (OCF terminology, Phase 2 slice 2a). */

/* The FIELD_REPORT table has only implicit (`FIELD_REPORT_ibfk_*`) foreign keys.
   InnoDB renames those to follow the table on RENAME TABLE (same as the
   INCIDENT_REPORT -> FIELD_REPORT rename in migration 08), so they need no
   explicit handling here. */
rename table FIELD_REPORT to REPORT;

rename table FIELD_REPORT__REPORT_ENTRY to REPORT__REPORT_ENTRY;

/* The join table mixes one implicit FK (auto-renamed to
   REPORT__REPORT_ENTRY_ibfk_1 by the rename above) with two explicitly-named FKs
   that are NOT auto-renamed. Drop all of them (if exists, to tolerate either
   pre/post auto-rename name) and re-add with clean, explicit names that match
   current.sql, mirroring the STAY__REPORT_ENTRY -> VISIT__REPORT_ENTRY rename in
   migration 29. */
alter table REPORT__REPORT_ENTRY
    rename column FIELD_REPORT_NUMBER to REPORT_NUMBER,
    drop foreign key if exists `FIELD_REPORT__REPORT_ENTRY_ibfk_1`,
    drop foreign key if exists `REPORT__REPORT_ENTRY_ibfk_1`,
    drop foreign key if exists `FIELD_REPORT__REPORT_ENTRY___FIELD_REPORT_FK`,
    drop foreign key if exists `FR_REPORT_ENTRY_TO_REPORT_ENTRY`,
    add constraint `RRE_TO_EVENT` foreign key (`EVENT`) references `EVENT`(ID),
    add constraint `RRE_TO_REPORT` foreign key (`EVENT`, REPORT_NUMBER)
        references REPORT(`EVENT`, NUMBER),
    add constraint `RRE_TO_REPORT_ENTRY` foreign key (REPORT_ENTRY)
        references REPORT_ENTRY(ID);

update `SCHEMA_INFO`
set `VERSION` = 33
where true;
