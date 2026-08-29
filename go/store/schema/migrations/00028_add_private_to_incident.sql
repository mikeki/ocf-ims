-- +goose Up
-- Add a PRIVATE flag to INCIDENT. When true, the incident is visible only to
-- admins, its creator (CREATED_BY), and people granted per-incident access
-- (INCIDENT__PERSON.GRANTED_ACCESS) — event writers and crew-leaders are excluded.
-- Default false preserves the existing (fully visible) behavior for every incident.
alter table INCIDENT
    add column PRIVATE boolean not null default false;

-- +goose Down
alter table INCIDENT
    drop column PRIVATE;
