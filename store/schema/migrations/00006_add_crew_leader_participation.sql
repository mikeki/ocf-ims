-- +goose Up
-- Plan 53a: add the 'crew_leader' rung to the per-event participation ladder. A
-- crew leader has reporter-level incident/report access (own reports only, no
-- incidents) plus the power to invite reporters to its event (see the
-- EventInviteReporters authz bit). Placed between 'writer' and 'reporter' to keep
-- the enum in ladder order (most → least privileged). Append-only, no data
-- transform: existing rows keep their value.
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('writer', 'crew_leader', 'reporter', 'participant', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd

-- +goose Down
-- Best-effort reverse (dev only): fold any 'crew_leader' rows into 'reporter'
-- before the value leaves the enum, then restore the pre-53a shape.
-- +goose StatementBegin
update PERSON__EVENT set PARTICIPATION_TYPE = 'reporter' where PARTICIPATION_TYPE = 'crew_leader';
-- +goose StatementEnd
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('writer', 'reporter', 'participant', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd
