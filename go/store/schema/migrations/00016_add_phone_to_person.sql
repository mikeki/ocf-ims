-- +goose Up
-- Add an optional PHONE contact number to PERSON. Phone (like EMAIL) is contact
-- information that may be collected for anyone recorded at the fair, including
-- login-less people, so it is nullable with no unique constraint. It is purely a
-- contact field — it plays no part in login (postAuth matches HANDLE/EMAIL only).
alter table PERSON
    add column PHONE varchar(32);

-- +goose Down
alter table PERSON
    drop column PHONE;
