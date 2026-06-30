-- +goose Up
-- Area approval (6o-2). A writer adding a missing location on the fly from the
-- incident form now *proposes* an area rather than minting a canonical one; an
-- admin later reviews it on the Areas tab and either approves it or marks it a
-- duplicate of an existing area. APPROVED defaults true so every pre-existing
-- area (canonical seed, admin-created, inherited) is already approved and only a
-- fresh writer proposal starts unapproved. PROPOSED_BY_PERSON_ID records who
-- proposed it (null for canonical/admin/inherited areas), as a global PERSON
-- reference so it survives handle changes and login-less people.
alter table AREA
    add column APPROVED boolean not null default true,
    add column PROPOSED_BY_PERSON_ID integer,
    add foreign key (PROPOSED_BY_PERSON_ID) references PERSON(ID);

-- +goose Down
alter table AREA
    drop column APPROVED,
    drop column PROPOSED_BY_PERSON_ID;
