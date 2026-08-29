-- +goose Up
-- Add an optional PROFILE_PICTURE to PERSON. It stores the generated file name of
-- the person's profile picture (exactly like a journal entry's ATTACHED_FILE): the
-- bytes live in the attachments backend (local disk or S3), the DB only holds the
-- name. Nullable — most people have no picture. It is not login- or contact-related.
alter table PERSON
    add column PROFILE_PICTURE varchar(255);

-- +goose Down
alter table PERSON
    drop column PROFILE_PICTURE;
