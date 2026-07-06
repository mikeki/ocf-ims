-- +goose Up
-- CREW is the per-event crew registry (feedback round 10, item 3), mirroring AREA:
-- keyed (EVENT, SLUG) with a NAME and SORT_ORDER. Crews are admin-managed only —
-- there is no writer propose/approve workflow (unlike AREA / INCIDENT_TYPE /
-- OUTCOME), so no APPROVED / PROPOSED_BY_PERSON_ID columns. Membership and
-- (multiple) leadership live in CREW_MEMBERSHIP, not here. This replaces the
-- retired global TEAM table (00027).
create table CREW (
    `EVENT`      integer      not null,
    `SLUG`       varchar(128) not null,
    `NAME`       varchar(255) not null,
    `SORT_ORDER` integer      not null default 0,

    primary key (`EVENT`, `SLUG`),
    foreign key `CREW_TO_EVENT` (`EVENT`) references `EVENT`(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
drop table CREW;
