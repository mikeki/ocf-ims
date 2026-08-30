-- +goose Up
-- Plan 52f: per-incident access grants for involved reporters. A reporter sees only
-- their own field reports and no incidents (52b), but a reporter involved in an
-- incident may need to keep contributing to it. GRANTED_ACCESS on the involvement row
-- opens that single incident to the linked person (read + add journal entries),
-- without giving them any event-wide incident access. Default false; meaningful only
-- for involved people who are users (harmless for non-user witnesses/victims).
-- +goose StatementBegin
alter table INCIDENT__PERSON
    add column GRANTED_ACCESS boolean not null default false;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
alter table INCIDENT__PERSON
    drop column GRANTED_ACCESS;
-- +goose StatementEnd
