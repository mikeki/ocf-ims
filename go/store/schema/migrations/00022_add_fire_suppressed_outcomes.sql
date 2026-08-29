-- +goose Up
-- Feedback round 10 follow-up: add three "Fire Suppressed" dispositions to the
-- data-driven OUTCOME registry (seeded in 00019). Approved reference data with no
-- proposer, like the original seed. Outcomes render alphabetically at read time
-- (api/outcome.go sorts by name), so insert order here is cosmetic.
-- +goose StatementBegin
insert into OUTCOME (NAME) values
    ('Fire Suppressed - Fair Central'),
    ('Fire Suppressed - Lane Fire Authority'),
    ('Fire Suppressed - Neighbors');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
delete from OUTCOME where NAME in (
    'Fire Suppressed - Fair Central',
    'Fire Suppressed - Lane Fire Authority',
    'Fire Suppressed - Neighbors'
);
-- +goose StatementEnd
