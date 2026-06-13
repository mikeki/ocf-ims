/* Phase 5e.1 — unify the people registry.

   Make PERSON the single registry of every person the IMS touches, not just
   login-capable accounts. See docs/plans/51-people-registry.md. The guiding
   principle is "identity is global (PERSON), participation is per-event
   (PERSON__EVENT)".

     - PERSON gains NAME (preferred/display name). Display resolves to
       COALESCE(NAME, HANDLE).
     - HANDLE becomes nullable: it exists only for login-capable people. The
       unique key is kept — MySQL/MariaDB permit multiple NULLs in a UNIQUE
       index, so handles stay unique among those who have one while many
       handle-less registry people coexist.

   PERSON__EVENT records how a person related to one fair: their wristband
   (reissued each year, unique within the event) and an explicit classification
   (crew / participant / public). It is created lazily — a person with no row for
   an event simply has no classification for it yet. Classification is an explicit
   per-event value, NOT derived from whether the person can log in (login is a
   global, permanent attribute; crew/participant/public changes every fair).

   VISIT gains GUEST_PERSON_ID so a guest can link to a PERSON row. The freeform
   GUEST_PREFERRED_NAME column is intentionally retained here and removed later in
   slice 5e.3, once the visit UI populates the link — expand now, contract later,
   so the visit page keeps working in between.

   Schema-only: no rows are added or transformed (OCF launches on a fresh DB). */

alter table PERSON
    add column NAME varchar(255);

alter table PERSON
    modify column HANDLE varchar(64) null;

create table PERSON__EVENT (
    PERSON_ID          integer not null,
    EVENT              integer not null,
    WRISTBAND          varchar(32),
    PARTICIPATION_TYPE enum('crew', 'participant', 'public') not null default 'public',

    primary key (PERSON_ID, EVENT),
    unique key (EVENT, WRISTBAND),
    foreign key PE_TO_PERSON (PERSON_ID) references PERSON(ID),
    foreign key PE_TO_EVENT  (EVENT)     references `EVENT`(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

alter table VISIT
    add column GUEST_PERSON_ID integer;

alter table VISIT
    add constraint VISIT_TO_GUEST_PERSON
        foreign key (GUEST_PERSON_ID) references PERSON(ID);

update `SCHEMA_INFO`
set `VERSION` = 42
where true;
