-- +goose Up
-- Retire the dormant TEAM / PERSON__TEAM tables. Teams stopped driving authorization
-- in plan 52c and carried no live behavior since: the directory read them into a
-- cache nothing consumed, and the JWT "tea" claim was written but never read. Crews
-- (00025/00026) replace the concept. Drop the join first — its FK references TEAM.
drop table if exists PERSON__TEAM;
drop table if exists TEAM;

-- +goose Down
-- Best-effort recreate of the baseline (00001) shapes, for dev convenience only
-- (production rolls forward, never `goose down`). The tables come back empty.
create table TEAM (
    ID   integer      not null auto_increment,
    NAME varchar(128) not null,

    primary key (ID),
    unique key (NAME)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

create table PERSON__TEAM (
    PERSON_ID integer not null,
    TEAM_ID   integer not null,

    foreign key `PT_TO_PERSON` (PERSON_ID) references PERSON(ID),
    foreign key `PT_TO_TEAM`   (TEAM_ID)   references TEAM(ID),

    primary key (PERSON_ID, TEAM_ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
