-- +goose Up
-- OCF taxonomy additions (round-7 item 2): four incident types OCF asked for that
-- the baseline lacked. Reference data shipped to every environment, so it lives in
-- a migration alongside the baseline taxonomy (see the INCIDENT_TYPE seed in
-- 00001_baseline). IDs are auto-assigned (continuing after the baseline's 27).
-- Approved, with no proposer (these are canonical, not writer proposals).
insert into INCIDENT_TYPE (NAME, HIDDEN, `GROUP`) values
    ('Theft',            0, 'conduct'),
    ('Policy Violation', 0, 'compliance'),
    ('Code Black',       0, 'safety'),
    ('Violence',         0, 'safety');

-- +goose Down
delete from INCIDENT_TYPE
where NAME in ('Theft', 'Policy Violation', 'Code Black', 'Violence');
