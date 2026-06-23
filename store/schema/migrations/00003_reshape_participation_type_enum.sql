-- +goose Up
-- Plan 52b: the per-event PARTICIPATION_TYPE becomes the single access ladder.
-- Add the access-bearing rungs 'writer' and 'reporter' at the top, and fold the
-- now-meaningless 'crew' tier into 'participant' (one "at the fair, working it"
-- tier for the beta). Existing 'crew' rows must migrate BEFORE 'crew' leaves the
-- enum, or MariaDB would coerce them to ''. Final ladder, top (most access) to
-- bottom: writer, reporter, participant, public, not_present, ejected.
-- +goose StatementBegin
update PERSON__EVENT set PARTICIPATION_TYPE = 'participant' where PARTICIPATION_TYPE = 'crew';
-- +goose StatementEnd
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('writer', 'reporter', 'participant', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd

-- +goose Down
-- Best-effort reverse (dev only): collapse the access rungs back into 'participant'
-- before they leave the enum, then restore the pre-52b shape.
-- +goose StatementBegin
update PERSON__EVENT set PARTICIPATION_TYPE = 'participant' where PARTICIPATION_TYPE in ('writer', 'reporter');
-- +goose StatementEnd
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('crew', 'participant', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd
