-- +goose Up
-- REPORT_REQUESTED is the moment a writer last asked this involved person for
-- their report on the incident (plan 09t, 3b.3a); NULL = never asked. The ask
-- lives on the involvement row because it is an involvement of a specific kind.
alter table INCIDENT__PERSON
    add column REPORT_REQUESTED double;

-- +goose Down
alter table INCIDENT__PERSON
    drop column REPORT_REQUESTED;
