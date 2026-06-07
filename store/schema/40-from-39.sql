/* Rename the REPORT_ENTRY entity to JOURNAL_ENTRY (OCF terminology: the
   per-incident/report/visit timeline entries are "journal entries", which also
   disambiguates them from a field REPORT). This renames the entry table, its
   three join tables, the link column on each join table, and every
   explicitly-named foreign key, so the result matches current.sql.

   RENAME TABLE auto-renames a table's implicit (`*_ibfk_*`) foreign keys to
   follow the table and updates child tables' references to the renamed parent;
   only the explicitly-named FKs need dropping and re-adding (same precedent as
   the FIELD_REPORT -> REPORT rename in migration 33). The link column is part of
   a foreign key, but MariaDB (10.5.2+) propagates RENAME COLUMN through the
   constraint (same precedent as the RANGER_HANDLE -> PERSON_ID rename in
   migration 34). This is a structural rename only; no rows are added or moved. */

/* --- The entry table itself. Its only explicit FK is the author FK. --- */
rename table REPORT_ENTRY to JOURNAL_ENTRY;

alter table JOURNAL_ENTRY
    drop foreign key `RE_TO_AUTHOR`,
    add constraint `JE_TO_AUTHOR` foreign key (AUTHOR_PERSON_ID) references PERSON(ID);

/* --- INCIDENT join table: all FKs are implicit, so RENAME TABLE handles them.
       The link column is renamed, and the secondary index backing its implicit
       FK is renamed by hand (RENAME COLUMN does not rename the index, but a fresh
       current.sql names that index after the JOURNAL_ENTRY column). --- */
rename table INCIDENT__REPORT_ENTRY to INCIDENT__JOURNAL_ENTRY;

alter table INCIDENT__JOURNAL_ENTRY
    rename column REPORT_ENTRY to JOURNAL_ENTRY,
    rename index REPORT_ENTRY to JOURNAL_ENTRY;

/* --- REPORT join table: explicitly-named FKs (RRE_*) -> RJE_*. --- */
rename table REPORT__REPORT_ENTRY to REPORT__JOURNAL_ENTRY;

alter table REPORT__JOURNAL_ENTRY
    rename column REPORT_ENTRY to JOURNAL_ENTRY,
    drop foreign key `RRE_TO_EVENT`,
    drop foreign key `RRE_TO_REPORT`,
    drop foreign key `RRE_TO_REPORT_ENTRY`,
    add constraint `RJE_TO_EVENT` foreign key (`EVENT`) references `EVENT`(ID),
    add constraint `RJE_TO_REPORT` foreign key (`EVENT`, REPORT_NUMBER)
        references REPORT(`EVENT`, NUMBER),
    add constraint `RJE_TO_JOURNAL_ENTRY` foreign key (JOURNAL_ENTRY)
        references JOURNAL_ENTRY(ID);

/* --- VISIT join table: explicitly-named FKs (VRE_*) -> VJE_*. --- */
rename table VISIT__REPORT_ENTRY to VISIT__JOURNAL_ENTRY;

alter table VISIT__JOURNAL_ENTRY
    rename column REPORT_ENTRY to JOURNAL_ENTRY,
    drop foreign key `VRE_TO_EVENT`,
    drop foreign key `VRE_TO_GUEST_VISIT`,
    drop foreign key `VRE_TO_REPORT_ENTRY`,
    add constraint `VJE_TO_EVENT` foreign key (`EVENT`) references `EVENT`(ID),
    add constraint `VJE_TO_GUEST_VISIT` foreign key (`EVENT`, VISIT_NUMBER)
        references VISIT(`EVENT`, NUMBER),
    add constraint `VJE_TO_JOURNAL_ENTRY` foreign key (JOURNAL_ENTRY)
        references JOURNAL_ENTRY(ID);

update `SCHEMA_INFO`
set `VERSION` = 40
where true;
