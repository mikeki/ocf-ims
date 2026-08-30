-- 00001_baseline.sql
--
-- Flattened baseline: the full IMS schema, squashed from the former
-- store/schema/current.sql, minus the old SCHEMA_INFO version-cursor table
-- (goose_db_version replaces it). This is the single schema artifact read by
-- sqlc and applied by goose on boot. See docs/plans/08-db-migration-tooling.md.

-- +goose Up

create table `EVENT` (
    ID      integer      not null auto_increment,
    NAME    varchar(128) not null,

    IS_GROUP        boolean not null default false,
    PARENT_GROUP    integer,

    primary key (ID),
    unique key (NAME),
    foreign key `PARENT_GROUP_TO_PARENT`(PARENT_GROUP) references `EVENT`(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table INCIDENT_TYPE (
    ID          integer      not null auto_increment,
    NAME        varchar(128) not null,
    HIDDEN      boolean      not null,
    DESCRIPTION varchar(1024),
    `GROUP`     enum('safety', 'conduct', 'operations', 'compliance'),

    primary key (ID),
    unique key (NAME)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* OCF incident taxonomy (Phase 4a). Draft list pending OCF stakeholder
   confirmation; grouped into Safety / Conduct / Operations / Compliance. */
insert into INCIDENT_TYPE (ID, NAME, HIDDEN, `GROUP`) values
    ( 1, 'Medical',                   0, 'safety'),
    ( 2, 'Fire',                      0, 'safety'),
    ( 3, 'Traffic/Vehicle',           0, 'safety'),
    ( 4, 'Child Welfare',             0, 'safety'),
    ( 5, 'Missing Person',            0, 'safety'),
    ( 6, 'Lost Child',                0, 'safety'),
    ( 7, 'Environmental Hazard',      0, 'safety'),
    ( 8, 'Personal Violation',        0, 'conduct'),
    ( 9, 'Harassment',                0, 'conduct'),
    (10, 'Threatening Behavior',      0, 'conduct'),
    (11, 'Intoxication',              0, 'conduct'),
    (12, 'Participant Conflict',      0, 'conduct'),
    (13, 'Volunteer Conflict',        0, 'conduct'),
    (14, 'Construction Issue',        0, 'operations'),
    (15, 'Water Issue',               0, 'operations'),
    (16, 'Electrical Issue',          0, 'operations'),
    (17, 'Sound Complaint',           0, 'operations'),
    (18, 'Booth Issue',               0, 'operations'),
    (19, 'Camping Issue',             0, 'operations'),
    (20, 'Site Damage',               0, 'operations'),
    (21, 'Guideline Violation',       0, 'compliance'),
    (22, 'Permit Violation',          0, 'compliance'),
    (23, 'Amplified Sound Violation', 0, 'compliance'),
    (24, 'Unauthorized Vehicle',      0, 'compliance'),
    (25, 'Wristband/Credential Issue',0, 'compliance'),
    (26, 'Weapon',                    0, 'safety'),
    (27, 'Other',                     0, null);


-- Local people model (OCF-owned, replacing the external Clubhouse directory).
-- Defined before JOURNAL_ENTRY so the author foreign key below resolves on a
-- fresh create. See docs/plans/31-local-people-directory.md.
create table PERSON (
    ID          integer      not null auto_increment,
    -- HANDLE is the login callsign. It is nullable because PERSON is the unified
    -- people registry (5e): handle-less people (e.g. visit guests, folks met on an
    -- incident) live here too. The unique key is retained — MySQL/MariaDB allow
    -- multiple NULLs in a UNIQUE index, so handles stay unique among login users.
    HANDLE      varchar(64),
    EMAIL       varchar(128),
    STATUS      varchar(32)  not null default 'active',
    ON_SITE     boolean      not null default false,
    PASSWORD    varchar(255),
    CREATED     double       not null,
    IS_ADMIN    boolean      not null default false,
    -- NAME is the preferred/display name; display resolves to COALESCE(NAME,
    -- HANDLE). Added last so the column order matches the ALTER ... ADD COLUMN in
    -- migration 42-from-41.
    NAME        varchar(255),

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

-- PERSON__EVENT records a person's per-event participation in a fair (5e):
-- identity is global (PERSON), participation is per-event (here + EVENT_ACCESS).
-- The row is created lazily — when a person is first associated with the event
-- (loaded from a crew roster, or met on an incident/visit). WRISTBAND reissues
-- each fair and is unique within the event (nullable: public folks have none).
-- PARTICIPATION_TYPE is an explicit classification, NOT derived from the login.
-- crew/participant/public are the active roster; not_present/ejected are the
-- kept-but-inactive states (a known person not here this year, or one removed
-- from the event but kept for the record — see the People roster, slice 6j).
create table PERSON__EVENT (
    PERSON_ID          integer not null,
    EVENT              integer not null,
    WRISTBAND          varchar(32),
    PARTICIPATION_TYPE enum('crew', 'participant', 'public', 'not_present', 'ejected') not null default 'public',

    primary key (PERSON_ID, EVENT),
    unique key (EVENT, WRISTBAND),
    foreign key PE_TO_PERSON (PERSON_ID) references PERSON(ID),
    foreign key PE_TO_EVENT  (EVENT)     references `EVENT`(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table JOURNAL_ENTRY (
    ID              integer         not null auto_increment,
    AUTHOR_PERSON_ID integer        not null,
    TEXT            mediumtext      not null,
    CREATED         double          not null,
    `GENERATED`     boolean         not null,
    STRICKEN        boolean         not null,

    ATTACHED_FILE                   varchar(128),
    ATTACHED_FILE_ORIGINAL_NAME     varchar(128),
    ATTACHED_FILE_MEDIA_TYPE        varchar(128),

    primary key (ID),
    foreign key `JE_TO_AUTHOR` (AUTHOR_PERSON_ID) references PERSON(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table INCIDENT (
    `EVENT`  integer  not null,
    NUMBER   integer  not null,
    -- CREATED is the time the INCIDENT was created, and this should be immutable.
    CREATED  double   not null,
    PRIORITY tinyint  not null,
    STATE enum(
        'new', 'on_hold', 'dispatched', 'on_scene', 'closed'
    ) not null,
    -- STARTED is the time the INCIDENT began. This field is mutable, and its initial
    -- value will usually be the same as CREATED.
    STARTED  double not null,
    CLOSED   double,
    SUMMARY  varchar(1024),

    LOCATION_DESCRIPTION    varchar(1024),
    -- LOCATION_AREA_SLUG is a nullable FK into AREA(EVENT, SLUG); the constraint
    -- is added by an ALTER below, after AREA is defined. LOCATION_DESCRIPTION is
    -- the retained freeform "place / details" box alongside the structured area.
    LOCATION_AREA_SLUG      varchar(128),

    -- OUTCOME is the incident disposition, orthogonal to STATE (no coupling).
    -- Nullable: an incident may have no recorded disposition yet. Added last so
    -- the column order matches the ALTER ... ADD COLUMN in migration 39-from-38.
    OUTCOME enum(
        'information_only', 'resolved_on_scene', 'referred_to_coordinator',
        'referred_to_management', 'referred_to_community_support',
        'referred_to_mediation', 'follow_up_required', 'no_action_needed'
    ),

    -- LOCATION_BOOTH is an optional booth number/identifier, captured alongside
    -- the structured AREA and the freeform LOCATION_DESCRIPTION. Added last so
    -- the column order matches the ALTER ... ADD COLUMN in migration 44-from-43.
    LOCATION_BOOTH          varchar(32),

    foreign key (`EVENT`) references `EVENT`(ID),

    primary key (`EVENT`, NUMBER)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table INCIDENT__PERSON (
    ID              integer     not null auto_increment,
    `EVENT`         integer     not null,
    INCIDENT_NUMBER integer     not null,
    PERSON_ID       integer     not null,
    INVOLVEMENT     varchar(128),

    primary key (ID),
    -- Declared inline (and before the PERSON_ID FK) so the index order matches
    -- the migration chain, where this index predates the IPE_TO_PERSON FK.
    key `INCIDENT__PERSON_EVENT_INCIDENT_NUMBER_index` (`EVENT`, INCIDENT_NUMBER),
    foreign key (`EVENT`) references `EVENT`(ID),
    foreign key (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),
    foreign key `IPE_TO_PERSON` (PERSON_ID) references PERSON(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table INCIDENT__LINKED_INCIDENT (
    EVENT_1             integer not null,
    INCIDENT_NUMBER_1   integer not null,
    EVENT_2             integer not null,
    INCIDENT_NUMBER_2   integer not null,

    foreign key (EVENT_1, INCIDENT_NUMBER_1) references INCIDENT(`EVENT`, NUMBER),
    foreign key (EVENT_2, INCIDENT_NUMBER_2) references INCIDENT(`EVENT`, NUMBER),

    primary key (EVENT_1, INCIDENT_NUMBER_1, EVENT_2, INCIDENT_NUMBER_2)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table INCIDENT__INCIDENT_TYPE (
    `EVENT`         integer not null,
    INCIDENT_NUMBER integer not null,
    INCIDENT_TYPE   integer not null,

    foreign key (`EVENT`) references `EVENT`(ID),
    foreign key (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),
    foreign key (INCIDENT_TYPE) references INCIDENT_TYPE(ID),

    primary key (`EVENT`, INCIDENT_NUMBER, INCIDENT_TYPE)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table INCIDENT__JOURNAL_ENTRY (
    `EVENT`         integer not null,
    INCIDENT_NUMBER integer not null,
    JOURNAL_ENTRY    integer not null,

    foreign key (`EVENT`) references `EVENT`(ID),
    foreign key (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),
    foreign key (JOURNAL_ENTRY) references JOURNAL_ENTRY(ID),

    primary key (`EVENT`, INCIDENT_NUMBER, JOURNAL_ENTRY)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table EVENT_ACCESS (
    ID         integer      not null auto_increment,
    `EVENT`    integer      not null,
    EXPRESSION varchar(128) not null,

    MODE     enum ('read', 'write', 'report', 'write_visits') not null,
    VALIDITY enum ('always', 'onsite') not null default 'always',
    -- An optional timestamp at which the access rule expires
    EXPIRES  double,

    foreign key `EVENT_ACCESS_TO_EVENT` (`EVENT`) references `EVENT`(ID),

    primary key (ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table REPORT (
    `EVENT` integer  not null,
    NUMBER  integer  not null,
    CREATED double   not null,

    SUMMARY         varchar(1024),
    INCIDENT_NUMBER integer,

    foreign key (`EVENT`) references `EVENT`(ID),
    foreign key (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),

    primary key (`EVENT`, NUMBER)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table REPORT__JOURNAL_ENTRY (
    `EVENT`                integer not null,
    REPORT_NUMBER          integer not null,
    JOURNAL_ENTRY           integer not null,

    foreign key `RJE_TO_EVENT` (`EVENT`) references `EVENT`(ID),
    foreign key `RJE_TO_REPORT` (`EVENT`, REPORT_NUMBER)
        references REPORT(`EVENT`, NUMBER),
    foreign key `RJE_TO_JOURNAL_ENTRY` (JOURNAL_ENTRY)
        references JOURNAL_ENTRY(ID),

    primary key (`EVENT`, REPORT_NUMBER, JOURNAL_ENTRY)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table `ACTION_LOG` (
    `ID`                bigint not null auto_increment,
    `CREATED_AT`        double not null,

    -- request metadata
    `ACTION_TYPE`       varchar(128) not null,
    `METHOD`            varchar(128),
    `PATH`              varchar(128),
    `REFERRER`          varchar(128),

    -- requestor metadata
    `USER_ID`           bigint,
    `USER_NAME`         varchar(128),
    `POSITION_ID`       bigint,
    `POSITION_NAME`     varchar(128),
    `CLIENT_ADDRESS`    varchar(128),

    -- response metadata
    `HTTP_STATUS`       smallint,
    `DURATION_MICROS`   bigint,

    primary key (`ID`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


create table AREA (
    `EVENT`         integer      not null,
    -- SLUG is derived from NAME at create time and is immutable thereafter, so
    -- incident references and child->parent links never break on a rename.
    `SLUG`          varchar(128) not null,
    `NAME`          varchar(255) not null,
    -- PARENT_SLUG is null for a top-level area; otherwise it references another
    -- area in the same EVENT. The schema permits arbitrary nesting; the beta UI
    -- enforces a single level.
    `PARENT_SLUG`   varchar(128),
    `SORT_ORDER`    integer      not null default 0,

    primary key (`EVENT`, `SLUG`),
    foreign key `AREA_EVENT` (`EVENT`) references `EVENT`(ID),
    foreign key `AREA_PARENT` (`EVENT`, `PARENT_SLUG`) references AREA(`EVENT`, `SLUG`)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- INCIDENT's location FK is added here, after AREA exists. Mirrors migration
-- 38-from-37 so the store/integration replay matches this schema.
alter table INCIDENT
    add constraint INCIDENT_TO_AREA
        foreign key (`EVENT`, LOCATION_AREA_SLUG) references AREA(`EVENT`, `SLUG`);


create table VISIT (
    `EVENT`         integer  not null,
    NUMBER          integer  not null,
    CREATED         double   not null,
    INCIDENT_NUMBER integer,

    GUEST_LEGAL_NAME            varchar(128),
    GUEST_DESCRIPTION           varchar(256),
    GUEST_ACTION_PLAN           varchar(512),
    GUEST_CAMP_NAME             varchar(256),
    GUEST_CAMP_ADDRESS          varchar(256),
    GUEST_CAMP_DESCRIPTION      varchar(256),
    GUEST_CAMP_CONTACTS         varchar(512),

    ARRIVAL_TIME        double,
    ARRIVAL_METHOD      varchar(256),
    ARRIVAL_STATE       varchar(256),
    ARRIVAL_REASON      varchar(256),
    ARRIVAL_BELONGINGS  varchar(256),

    DEPARTURE_TIME      double,
    DEPARTURE_METHOD    varchar(256),
    DEPARTURE_STATE     varchar(256),

    RESOURCE_SITTER     varchar(256),
    RESOURCE_BED_ID     varchar(64),
    RESOURCE_REST       varchar(256),
    RESOURCE_CLOTHES    varchar(256),
    RESOURCE_POGS       varchar(256),
    RESOURCE_FOOD_BEV   varchar(256),
    RESOURCE_OTHER      varchar(256),

    -- GUEST_PERSON_ID links a visit guest to a PERSON in the unified registry (5e).
    -- The guest's preferred name lives on PERSON.NAME (resolved via this link); the
    -- old freeform GUEST_PREFERRED_NAME column was dropped in migration 43-from-42.
    -- Episode data (legal name, description, camp…) stays on VISIT, gated by visit
    -- access. Added last so the column order matches the ALTER ... ADD COLUMN history.
    GUEST_PERSON_ID     integer,

    foreign key `VISIT_TO_EVENT` (`EVENT`) references `EVENT`(ID),
    foreign key `VISIT_TO_INCIDENT` (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),
    foreign key `VISIT_TO_GUEST_PERSON` (GUEST_PERSON_ID) references PERSON(ID),

    primary key (`EVENT`, NUMBER)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table VISIT__JOURNAL_ENTRY (
    `EVENT`             integer not null,
    VISIT_NUMBER        integer not null,
    JOURNAL_ENTRY        integer not null,

    foreign key `VJE_TO_EVENT` (`EVENT`) references `EVENT`(ID),
    foreign key `VJE_TO_GUEST_VISIT` (`EVENT`, VISIT_NUMBER)
        references VISIT(`EVENT`, NUMBER),
    foreign key `VJE_TO_JOURNAL_ENTRY` (JOURNAL_ENTRY)
        references JOURNAL_ENTRY(ID),

    primary key (`EVENT`, VISIT_NUMBER, JOURNAL_ENTRY)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table VISIT__PERSON (
    ID                  integer     not null auto_increment,
    `EVENT`             integer     not null,
    VISIT_NUMBER        integer     not null,
    PERSON_ID           integer     not null,
    INVOLVEMENT         varchar(128),

    foreign key (`EVENT`) references `EVENT` (ID),
    foreign key (`EVENT`, VISIT_NUMBER) references VISIT (`EVENT`, NUMBER),
    foreign key `VPE_TO_PERSON` (PERSON_ID) references PERSON(ID),

    primary key (ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `VISIT__PERSON`;
DROP TABLE IF EXISTS `VISIT__JOURNAL_ENTRY`;
DROP TABLE IF EXISTS `VISIT`;
DROP TABLE IF EXISTS `AREA`;
DROP TABLE IF EXISTS `ACTION_LOG`;
DROP TABLE IF EXISTS `REPORT__JOURNAL_ENTRY`;
DROP TABLE IF EXISTS `REPORT`;
DROP TABLE IF EXISTS `EVENT_ACCESS`;
DROP TABLE IF EXISTS `INCIDENT__JOURNAL_ENTRY`;
DROP TABLE IF EXISTS `INCIDENT__INCIDENT_TYPE`;
DROP TABLE IF EXISTS `INCIDENT__LINKED_INCIDENT`;
DROP TABLE IF EXISTS `INCIDENT__PERSON`;
DROP TABLE IF EXISTS `INCIDENT`;
DROP TABLE IF EXISTS `JOURNAL_ENTRY`;
DROP TABLE IF EXISTS `PERSON__EVENT`;
DROP TABLE IF EXISTS `PERSON__TEAM`;
DROP TABLE IF EXISTS `PERSON__POSITION`;
DROP TABLE IF EXISTS `TEAM`;
DROP TABLE IF EXISTS `POSITION`;
DROP TABLE IF EXISTS `PERSON`;
DROP TABLE IF EXISTS `INCIDENT_TYPE`;
DROP TABLE IF EXISTS `EVENT`;
SET FOREIGN_KEY_CHECKS = 1;
