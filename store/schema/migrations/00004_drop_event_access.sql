-- +goose Up
-- Plan 52c: retire EVENT_ACCESS entirely. Since 52b authorization derives from the
-- per-event PERSON__EVENT role ladder, so these rows (and the positions/teams/onduty/
-- validity/expiry machinery built for the Burning Man org) no longer grant anything.
-- The descriptive POSITION/TEAM tables stay; only the access engine goes.
-- +goose StatementBegin
drop table if exists EVENT_ACCESS;
-- +goose StatementEnd

-- +goose Down
-- Best-effort reverse (dev only): recreate the table empty. The pre-52c access rows
-- are not restored — production rolls forward, and access now lives in PERSON__EVENT.
-- +goose StatementBegin
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
);
-- +goose StatementEnd
