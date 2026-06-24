-- +goose Up
-- A journal entry can @mention one or more people (plan 81). Mentions are
-- recorded structurally in this side table rather than by re-parsing entry text
-- on read: at OCF's scale a side table is simpler and reliable, and it gives the
-- notifications feature (plan 82) a queryable trigger. The mentioned person is
-- referenced by PERSON.ID (the registry key), so a mention survives handle
-- changes and works for login-less people. Journal entries are append-only, so
-- a row here is fixed at write time.
create table JOURNAL_ENTRY__MENTION (
    JOURNAL_ENTRY   integer not null,
    PERSON_ID       integer not null,

    foreign key (JOURNAL_ENTRY) references JOURNAL_ENTRY(ID),
    foreign key (PERSON_ID) references PERSON(ID),

    primary key (JOURNAL_ENTRY, PERSON_ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
drop table JOURNAL_ENTRY__MENTION;
