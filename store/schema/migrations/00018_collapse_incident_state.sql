-- +goose Up
-- Feedback item 2 / slice 10b: collapse the five-state incident model to two
-- states, 'open' and 'closed'. 'closed' already exists and keeps its meaning (and
-- its CLOSED-timestamp coupling); the four active-ish states fold into 'open'.
-- Widen the enum to include 'open' first so existing rows stay valid, remap them,
-- then narrow to the final two-value enum (default 'open').
-- +goose StatementBegin
alter table INCIDENT
    modify STATE
    enum('new', 'on_hold', 'dispatched', 'on_scene', 'closed', 'open')
    not null;
-- +goose StatementEnd
-- +goose StatementBegin
update INCIDENT set STATE = 'open' where STATE in ('new', 'on_hold', 'dispatched', 'on_scene');
-- +goose StatementEnd
-- +goose StatementBegin
alter table INCIDENT
    modify STATE
    enum('open', 'closed')
    not null default 'open';
-- +goose StatementEnd

-- +goose Down
-- Best-effort reverse (dev only): re-add the old rungs, map 'open' back to 'new'
-- (the historical default), then restore the five-value enum. The prior
-- distinctions among new/on_hold/dispatched/on_scene are not recoverable.
-- +goose StatementBegin
alter table INCIDENT
    modify STATE
    enum('new', 'on_hold', 'dispatched', 'on_scene', 'closed', 'open')
    not null;
-- +goose StatementEnd
-- +goose StatementBegin
update INCIDENT set STATE = 'new' where STATE = 'open';
-- +goose StatementEnd
-- +goose StatementBegin
alter table INCIDENT
    modify STATE
    enum('new', 'on_hold', 'dispatched', 'on_scene', 'closed')
    not null;
-- +goose StatementEnd
