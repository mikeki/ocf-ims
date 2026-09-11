-- +goose Up
-- P256DH and AUTH are Web Push crypto keys; an Expo device has none, so an
-- 'expo' row holds nulls rather than empty strings (plan 09p S4). ENDPOINT
-- stays NOT NULL and unique for both kinds.
alter table PUSH_SUBSCRIPTION
    modify column P256DH varchar(255) null,
    modify column AUTH varchar(255) null;

-- +goose Down
-- Fails once a native device has registered (nulls cannot satisfy NOT NULL).
-- Production rolls forward; this is for a dev reset.
alter table PUSH_SUBSCRIPTION
    modify column P256DH varchar(255) not null,
    modify column AUTH varchar(255) not null;
