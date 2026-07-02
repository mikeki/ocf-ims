-- +goose Up
-- Rename PERSON's two identity columns to the domain vocabulary used everywhere at
-- the fair: HANDLE is the "fair name" (the callsign/nickname everyone goes by,
-- radio or not), and NAME is the person's full "legal name". This is a metadata-only
-- rename — no data moves. HANDLE's UNIQUE key follows the column automatically, and
-- nothing foreign-keys to it (people are referenced by ID), so no index rebuild is
-- needed. PERSON-table only; other tables keep their own NAME columns.
--
-- MariaDB DDL is not transactional, so the two statements can't roll back together
-- if the second fails; they're independent renames, and Down reverses both.
alter table PERSON rename column HANDLE to FAIR_NAME;
alter table PERSON rename column NAME to LEGAL_NAME;

-- +goose Down
alter table PERSON rename column FAIR_NAME to HANDLE;
alter table PERSON rename column LEGAL_NAME to NAME;
