-- +goose Up
-- Rename the per-event participation rung 'participant' to 'volunteer' (the OCF
-- term for someone working the fair). This is a pure in-place ENUM rename: the
-- value keeps its ordinal position (4th, between 'reporter' and 'public'), so
-- MariaDB preserves existing rows — every row stored as the 4th member simply
-- reads back as 'volunteer'. No data UPDATE is needed, keeping this schema-only.
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('writer', 'crew_leader', 'reporter', 'volunteer', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd

-- +goose Down
-- Reverse the rename in place, again preserving rows by ordinal position.
-- +goose StatementBegin
alter table PERSON__EVENT
    modify column PARTICIPATION_TYPE
    enum('writer', 'crew_leader', 'reporter', 'participant', 'public', 'not_present', 'ejected')
    not null default 'public';
-- +goose StatementEnd
