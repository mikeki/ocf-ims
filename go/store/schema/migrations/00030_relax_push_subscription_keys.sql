-- +goose Up
-- P256DH and AUTH are Web Push crypto keys (the ECDH public key and the auth
-- secret used to encrypt a payload to a browser). They are meaningless for an
-- Expo device, which is identified solely by its ENDPOINT — an
-- ExponentPushToken[...] string — and has no client keys at all, because Expo
-- owns the APNs/FCM plumbing behind it. Relax both so an 'expo' row can say
-- "there are none" with a null rather than store two empty strings that look
-- like data (plan 09p S4).
--
-- ENDPOINT stays NOT NULL and stays the device's unique identity for both
-- kinds, which is why the unique key, the upsert-on-endpoint behaviour and the
-- PUSH_SUBSCRIPTION_BY_PERSON fan-out index all survive this unchanged.
alter table PUSH_SUBSCRIPTION
    modify column P256DH varchar(255) null,
    modify column AUTH varchar(255) null;

-- +goose Down
-- Best-effort, and it will fail if any native device has registered since the
-- Up ran: those rows hold nulls that cannot satisfy NOT NULL. Production rolls
-- forward (CLAUDE.md); this is here for a dev reset.
alter table PUSH_SUBSCRIPTION
    modify column P256DH varchar(255) not null,
    modify column AUTH varchar(255) not null;
