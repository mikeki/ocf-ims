-- +goose Up
-- Add device-kind support to PUSH_SUBSCRIPTION so a row can represent either a
-- Web Push subscription (browser) or an Expo push token (native app), not just
-- the former (plan 09p S4). Every row up to now is a web subscription, and NOT
-- NULL DEFAULT 'web' backfills that for free: MariaDB fills a column's DEFAULT
-- into existing rows when the column is added NOT NULL, so no separate UPDATE
-- is needed here.
--
-- Relaxing P256DH/AUTH to nullable is the other half of this change and is a
-- SEPARATE migration on purpose: MariaDB DDL is not transactional, so two
-- ALTERs in one migration can half-apply, and goose would then retry the whole
-- thing and fail on a duplicate column with no way forward but by hand.
alter table PUSH_SUBSCRIPTION
    add column KIND varchar(16) not null default 'web';

-- +goose Down
alter table PUSH_SUBSCRIPTION
    drop column KIND;
