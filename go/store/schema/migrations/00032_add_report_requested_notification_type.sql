-- +goose Up
-- 'report_requested' — someone asked you for your report on an incident
-- (plan 09t, 3b.3a). Separate from 00031: MariaDB DDL is not transactional.
alter table NOTIFICATION
    modify column TYPE enum('mentioned', 'added_to_incident', 'report_requested') not null;

-- +goose Down
alter table NOTIFICATION
    modify column TYPE enum('mentioned', 'added_to_incident') not null;
