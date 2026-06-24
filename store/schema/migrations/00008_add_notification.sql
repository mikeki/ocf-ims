-- +goose Up
-- In-app notifications (plan 82). A notification tells a person something needs
-- their attention on an incident they may not be watching. The design is
-- type-first (an explicit TYPE enum), not mention-only, so it grows to cover more
-- triggers. The two initial types:
--   'mentioned'         — you were @mentioned in a journal entry (plan 81), on
--                         an incident OR a field report.
--   'added_to_incident' — you were added to an incident's involvement.
-- Notifications are generated server-side at those trigger points. EVENT scopes
-- the notification (for linking and access); INCIDENT_NUMBER / REPORT_NUMBER /
-- JOURNAL_ENTRY are type-dependent sources (a 'mentioned' notification carries
-- exactly one of incident or report); ACTOR is who caused it (null for system
-- actions). READ_AT null means unread.
create table NOTIFICATION (
    ID                  integer not null auto_increment,
    RECIPIENT_PERSON_ID integer not null,
    TYPE                enum('mentioned', 'added_to_incident') not null,
    `EVENT`             integer not null,
    INCIDENT_NUMBER     integer,
    REPORT_NUMBER       integer,
    JOURNAL_ENTRY       integer,
    ACTOR_PERSON_ID     integer,
    CREATED             double  not null,
    READ_AT             double,

    primary key (ID),
    foreign key (RECIPIENT_PERSON_ID) references PERSON(ID),
    foreign key (ACTOR_PERSON_ID) references PERSON(ID),
    foreign key (`EVENT`) references `EVENT`(ID),
    foreign key (`EVENT`, INCIDENT_NUMBER) references INCIDENT(`EVENT`, NUMBER),
    foreign key (`EVENT`, REPORT_NUMBER) references REPORT(`EVENT`, NUMBER),
    foreign key (JOURNAL_ENTRY) references JOURNAL_ENTRY(ID),

    -- The hot path is "this person's recent / unread notifications".
    key NOTIFICATION_BY_RECIPIENT (RECIPIENT_PERSON_ID, READ_AT)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
drop table NOTIFICATION;
