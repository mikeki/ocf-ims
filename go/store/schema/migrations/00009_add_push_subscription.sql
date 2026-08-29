-- +goose Up
-- Web push subscriptions (plan 84). When a person opts a device in to OS-level
-- push notifications, the browser hands us a subscription: an ENDPOINT URL at its
-- push service plus two client keys (P256DH, AUTH) used to encrypt the payload.
-- One person has MANY subscriptions (phone, laptop, …); ENDPOINT is the natural
-- identity of a device, so it is unique and a re-subscribe upserts on it. Dead
-- subscriptions are pruned when the push service returns 404/410 on send (plan
-- 84c). USER_AGENT is a best-effort label for a future "your devices" list.
create table PUSH_SUBSCRIPTION (
    ID          integer      not null auto_increment,
    PERSON_ID   integer      not null,
    ENDPOINT    varchar(512) not null,
    P256DH      varchar(255) not null,
    AUTH        varchar(255) not null,
    USER_AGENT  varchar(512),
    CREATED     double       not null,

    primary key (ID),
    foreign key (PERSON_ID) references PERSON(ID),
    -- A device's endpoint is its identity; re-subscribing the same browser
    -- updates the existing row rather than piling up duplicates.
    unique key PUSH_SUBSCRIPTION_BY_ENDPOINT (ENDPOINT),
    -- The send path fans out by recipient: "every device of this person".
    key PUSH_SUBSCRIPTION_BY_PERSON (PERSON_ID)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +goose Down
drop table PUSH_SUBSCRIPTION;
