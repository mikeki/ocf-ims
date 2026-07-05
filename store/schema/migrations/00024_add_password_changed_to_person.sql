-- +goose Up
-- Track whether a person's password is no longer the shared default password
-- (IMS_DEFAULT_PASSWORD), so the change-prompt in GET /ims/api/auth can skip the
-- argon2 verify for anyone already off it. Defaults false ("may still be on the
-- default"); GET /auth records true the first time it verifies a user is NOT on the
-- default, and every password write sets it accurately. This makes the detection
-- cost one argon2 verify per user at most, rather than one per page load.
-- +goose StatementBegin
alter table PERSON add column PASSWORD_CHANGED boolean not null default false;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
alter table PERSON drop column PASSWORD_CHANGED;
-- +goose StatementEnd
