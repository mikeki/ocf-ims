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

update `SCHEMA_INFO` set `VERSION` = 37 where true;
