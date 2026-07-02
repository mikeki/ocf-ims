-- +goose Up
-- Fair names are no longer unique: EMAIL (already unique) is the sole login
-- identifier, and the fair name is a display/callsign field — two people may
-- legitimately go by the same one. The index is still named HANDLE because
-- MariaDB's RENAME COLUMN (migration 00017) keeps the index's original name.
alter table PERSON drop index HANDLE;

-- +goose Down
alter table PERSON add unique key HANDLE (FAIR_NAME);
