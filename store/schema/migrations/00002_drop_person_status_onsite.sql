-- +goose Up
-- Plan 52a: retire the dead person flags. PERSON.STATUS only gated login/picker
-- visibility (everyone was 'active') and PERSON.ON_SITE only fed the now-moot
-- "On-Site" access-rule validity. Neither carries weight for the OCF beta.
-- +goose StatementBegin
alter table PERSON drop column STATUS;
-- +goose StatementEnd
-- +goose StatementBegin
alter table PERSON drop column ON_SITE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
alter table PERSON add column STATUS varchar(32) not null default 'active';
-- +goose StatementEnd
-- +goose StatementBegin
alter table PERSON add column ON_SITE boolean not null default false;
-- +goose StatementEnd
