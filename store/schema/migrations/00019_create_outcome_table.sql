-- +goose Up
-- Feedback item 1 / slice 10a: promote the hardcoded INCIDENT.OUTCOME enum to a
-- data-driven OUTCOME table, so outcomes work like Incident Types and Areas —
-- admin-managed with a propose/approve workflow. This migration adds the table and
-- seeds the fourteen current dispositions as approved rows; wiring INCIDENT to it
-- (an OUTCOME_ID FK replacing the enum) is a follow-on slice. Mirrors INCIDENT_TYPE
-- + its approval columns (migrations 00001/00014).
-- +goose StatementBegin
create table OUTCOME (
    ID                    integer      not null auto_increment,
    NAME                  varchar(128) not null,
    HIDDEN                boolean      not null default false,
    APPROVED              boolean      not null default true,
    PROPOSED_BY_PERSON_ID integer,

    primary key (ID),
    unique key (NAME),
    foreign key (PROPOSED_BY_PERSON_ID) references PERSON(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- +goose StatementEnd
-- +goose StatementBegin
-- Seed the fourteen current dispositions (the enum values' display names, from the
-- incident form). Approved, with no proposer — these are canonical, not proposals.
insert into OUTCOME (NAME) values
    ('Information Only'),
    ('Resolved On Scene'),
    ('Referred to Coordinator'),
    ('Referred to Management'),
    ('Referred to Community Support'),
    ('Referred to Mediation'),
    ('Follow-Up Required'),
    ('No Action Needed'),
    ('Taken to Big Bird'),
    ('Taken to Little Wing'),
    ('Asked to Leave'),
    ('Booted'),
    ('Arrested'),
    ('Transported in Ambulance');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
drop table OUTCOME;
-- +goose StatementEnd
