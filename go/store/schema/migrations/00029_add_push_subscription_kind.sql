-- +goose Up
-- KIND tells a browser Web Push subscription ('web') from an Expo push token
-- ('expo') (plan 09p S4). NOT NULL DEFAULT 'web' backfills every existing row.
-- Relaxing P256DH/AUTH is a separate migration: MariaDB DDL is not
-- transactional, and two ALTERs in one migration can half-apply.
alter table PUSH_SUBSCRIPTION
    add column KIND varchar(16) not null default 'web';

-- +goose Down
alter table PUSH_SUBSCRIPTION
    drop column KIND;
