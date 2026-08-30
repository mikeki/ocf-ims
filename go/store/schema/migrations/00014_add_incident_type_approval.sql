-- +goose Up
-- Incident-type approval (round-7 item 2). A writer who needs a type that doesn't
-- exist yet can now *propose* one from the incident form; an admin later approves
-- it on the Incident Types admin page. APPROVED defaults true so every seeded /
-- admin-created type is already approved and only a fresh writer proposal starts
-- unapproved. PROPOSED_BY_PERSON_ID records who proposed it (null for seeded /
-- admin-created types) as a global PERSON reference, so it survives handle changes
-- and login-less people. Mirrors AREA's approval columns (migration 00011).
alter table INCIDENT_TYPE
    add column APPROVED boolean not null default true,
    add column PROPOSED_BY_PERSON_ID integer,
    add foreign key (PROPOSED_BY_PERSON_ID) references PERSON(ID);

-- +goose Down
alter table INCIDENT_TYPE
    drop column APPROVED,
    drop column PROPOSED_BY_PERSON_ID;
