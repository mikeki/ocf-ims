/* Phase 3 PR #1 — stand up a local people model in the IMS DB and re-key
   attached-people + report-entry author from handle strings to PERSON_ID FKs.
   See docs/plans/31-local-people-directory.md. */

/* --- New local people tables (additive) --- */

create table PERSON (
    ID          integer      not null auto_increment,
    HANDLE    varchar(64)  not null,
    EMAIL       varchar(128),
    STATUS      varchar(32)  not null default 'active',
    ON_SITE     boolean      not null default false,
    PASSWORD    varchar(255),
    CREATED     double       not null,

    primary key (ID),
    unique key (HANDLE),
    unique key (EMAIL)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table `POSITION` (
    ID      integer      not null auto_increment,
    NAME    varchar(128) not null,

    primary key (ID),
    unique key (NAME)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table TEAM (
    ID      integer      not null auto_increment,
    NAME    varchar(128) not null,

    primary key (ID),
    unique key (NAME)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table PERSON__POSITION (
    PERSON_ID   integer not null,
    POSITION_ID integer not null,

    foreign key `PP_TO_PERSON`   (PERSON_ID)   references PERSON(ID),
    foreign key `PP_TO_POSITION` (POSITION_ID) references `POSITION`(ID),

    primary key (PERSON_ID, POSITION_ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table PERSON__TEAM (
    PERSON_ID integer not null,
    TEAM_ID   integer not null,

    foreign key `PT_TO_PERSON` (PERSON_ID) references PERSON(ID),
    foreign key `PT_TO_TEAM`   (TEAM_ID)   references TEAM(ID),

    primary key (PERSON_ID, TEAM_ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* --- Re-key attached-people to PERSON_ID FKs (clean slate: tables are empty) --- */

/* INCIDENT__RANGER has only implicit (`INCIDENT__RANGER_ibfk_*`) foreign keys,
   which InnoDB auto-renames to follow the table on RENAME TABLE (same precedent as
   the INCIDENT_REPORT -> FIELD_REPORT and FIELD_REPORT -> REPORT renames). The
   explicit secondary index is NOT auto-renamed, so we rename it by hand. */
rename table INCIDENT__RANGER to INCIDENT__PERSON;

alter table INCIDENT__PERSON
    change column RANGER_HANDLE PERSON_ID integer not null,
    add constraint `IPE_TO_PERSON` foreign key (PERSON_ID) references PERSON(ID),
    rename index INCIDENT__RANGER_EVENT_INCIDENT_NUMBER_index
        to INCIDENT__PERSON_EVENT_INCIDENT_NUMBER_index;

rename table VISIT__RANGER to VISIT__PERSON;

alter table VISIT__PERSON
    change column RANGER_HANDLE PERSON_ID integer not null,
    add constraint `VPE_TO_PERSON` foreign key (PERSON_ID) references PERSON(ID);

/* --- Re-key report-entry author to a PERSON_ID FK --- */

alter table REPORT_ENTRY
    change column AUTHOR AUTHOR_PERSON_ID integer not null,
    add constraint `RE_TO_AUTHOR` foreign key (AUTHOR_PERSON_ID) references PERSON(ID);

update `SCHEMA_INFO`
set `VERSION` = 34
where true;
