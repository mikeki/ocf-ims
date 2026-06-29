-- +goose Up
-- A Report now records two people (6m): the SUBMITTER (the account that created
-- the report — an audit fact) and the REPORTER (the person the report is about).
-- They differ when booth staff take a report on someone else's behalf; the
-- reporter defaults to the submitter otherwise. Both reference the PERSON
-- registry by ID so they survive handle changes and work for login-less people.
-- Nullable: pre-existing reports have neither (migrations don't backfill domain
-- data), and the app renders the absence gracefully.
alter table REPORT
    add column SUBMITTER_PERSON_ID integer,
    add column REPORTER_PERSON_ID  integer,
    add foreign key (SUBMITTER_PERSON_ID) references PERSON(ID),
    add foreign key (REPORTER_PERSON_ID) references PERSON(ID);

-- +goose Down
alter table REPORT
    drop column SUBMITTER_PERSON_ID,
    drop column REPORTER_PERSON_ID;
