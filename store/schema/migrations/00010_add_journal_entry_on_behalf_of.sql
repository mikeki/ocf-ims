-- +goose Up
-- A journal entry can be filed "on behalf of" another person (6m). The entry's
-- author (AUTHOR_PERSON_ID) is the account that wrote it — the submitter; this
-- adds the optional person the entry is *about* when that differs (e.g. booth
-- staff taking a report for a walk-up). Per-entry, not per-report: a report grows
-- many entries over time and any of them may be on someone's behalf. References
-- the PERSON registry by ID so it survives handle changes and works for
-- login-less people. Nullable: null means the author is reporting for themselves.
-- The column lives on the shared JOURNAL_ENTRY table; only the Report UI sets it
-- for now.
alter table JOURNAL_ENTRY
    add column ON_BEHALF_OF_PERSON_ID integer,
    add foreign key (ON_BEHALF_OF_PERSON_ID) references PERSON(ID);

-- +goose Down
alter table JOURNAL_ENTRY
    drop column ON_BEHALF_OF_PERSON_ID;
