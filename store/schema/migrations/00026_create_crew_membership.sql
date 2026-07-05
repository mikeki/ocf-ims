-- +goose Up
-- CREW_MEMBERSHIP is the per-event person<->crew join (feedback round 10, items 3 &
-- 5). A row is membership; IS_LEADER = true marks a crew leader. The table supports
-- a person on multiple crews and a crew with multiple leaders (the first UI assigns
-- a single crew). The composite FK (EVENT, CREW_SLUG) -> CREW(EVENT, SLUG) mirrors
-- how INCIDENT.LOCATION_AREA_SLUG references AREA. Replaces the retired global
-- PERSON__TEAM join (00027).
create table CREW_MEMBERSHIP (
    `EVENT`     integer      not null,
    `CREW_SLUG` varchar(128) not null,
    `PERSON_ID` integer      not null,
    `IS_LEADER` boolean      not null default false,

    primary key (`EVENT`, `CREW_SLUG`, `PERSON_ID`),
    foreign key `CM_TO_CREW`   (`EVENT`, `CREW_SLUG`) references CREW(`EVENT`, `SLUG`),
    foreign key `CM_TO_PERSON` (`PERSON_ID`)          references PERSON(ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
drop table CREW_MEMBERSHIP;
