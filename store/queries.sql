-- name: QueryEventID :one
select sqlc.embed(e) from EVENT e where e.NAME = ?;

-- name: Event :one
select sqlc.embed(e) from EVENT e where ID = ?;

-- name: Events :many
select sqlc.embed(e) from EVENT e;

-- name: CreateEvent :execlastid
insert into EVENT (NAME, IS_GROUP, PARENT_GROUP) values (?, ?, ?);

-- name: UpdateEvent :exec
update `EVENT`
set
    NAME = ?,
    IS_GROUP = ?,
    PARENT_GROUP = ?
where ID = ?
;

-- name: CreateIncident :execlastid
insert into INCIDENT (
    EVENT,
    NUMBER,
    CREATED,
    PRIORITY,
    STATE,
    STARTED
)
values (
   ?,?,?,?,?,?
);

-- name: UpdateIncident :exec
update INCIDENT set
    -- CREATED should be immutable, so it's not present in this UPDATE query
    PRIORITY = ?,
    STATE = ?,
    OUTCOME = ?,
    STARTED = ?,
    CLOSED = ?,
    SUMMARY = ?,
    LOCATION_DESCRIPTION = ?,
    LOCATION_AREA_SLUG = ?,
    LOCATION_BOOTH = ?
where
    EVENT = ?
    and NUMBER = ?
;

-- name: Incident :one
select
    sqlc.embed(i),
    (
        select coalesce(json_arrayagg(iit.INCIDENT_TYPE), "[]")
        from INCIDENT__INCIDENT_TYPE iit
        where i.EVENT = iit.EVENT
          and i.NUMBER = iit.INCIDENT_NUMBER
    ) as INCIDENT_TYPE_IDS,
    (
        select coalesce(json_arrayagg(irep.NUMBER), "[]")
        from REPORT irep
        where i.EVENT = irep.EVENT
          and i.NUMBER = irep.INCIDENT_NUMBER
    ) as REPORT_NUMBERS,
    (
        select coalesce(json_arrayagg(visit.NUMBER), "[]")
        from VISIT visit
        where i.EVENT = visit.EVENT
          and i.NUMBER = visit.INCIDENT_NUMBER
    ) as VISIT_NUMBERS
from INCIDENT i
where i.EVENT = ?
    and i.NUMBER = ?;

-- name: Incidents :many
select
    sqlc.embed(i),
    (
        select coalesce(json_arrayagg(iit.INCIDENT_TYPE), "[]")
        from INCIDENT__INCIDENT_TYPE iit
        where i.EVENT = iit.EVENT
            and i.NUMBER = iit.INCIDENT_NUMBER
    ) as INCIDENT_TYPE_IDS,
    (
        select coalesce(json_arrayagg(irep.NUMBER), "[]")
        from REPORT irep
        where i.EVENT = irep.EVENT
            and i.NUMBER = irep.INCIDENT_NUMBER
    ) as REPORT_NUMBERS,
    (
        select coalesce(json_arrayagg(visit.NUMBER), "[]")
        from VISIT visit
        where i.EVENT = visit.EVENT
          and i.NUMBER = visit.INCIDENT_NUMBER
    ) as VISIT_NUMBERS
from
    INCIDENT i
where
    i.EVENT = ?
group by
    i.NUMBER;

-- name: Incidents_People :many
select
    sqlc.embed(ip),
    p.HANDLE,
    p.NAME,
    -- HAS_EVENT_ACCESS: the involved person already has event-wide incident access
    -- (admin, or a 'writer' PERSON__EVENT role), so a per-incident grant (52f) is
    -- moot for them. The People editor uses this to show "has access" vs offer a grant.
    (p.IS_ADMIN or coalesce(pe.PARTICIPATION_TYPE = 'writer', false)) as HAS_EVENT_ACCESS
from
    INCIDENT__PERSON ip
    join PERSON p on p.ID = ip.PERSON_ID
    left join PERSON__EVENT pe on pe.PERSON_ID = ip.PERSON_ID and pe.EVENT = ip.EVENT
where
    ip.EVENT = ?;

-- name: Incident_People :many
select
    sqlc.embed(ip),
    p.HANDLE,
    p.NAME,
    (p.IS_ADMIN or coalesce(pe.PARTICIPATION_TYPE = 'writer', false)) as HAS_EVENT_ACCESS
from
    INCIDENT__PERSON ip
    join PERSON p on p.ID = ip.PERSON_ID
    left join PERSON__EVENT pe on pe.PERSON_ID = ip.PERSON_ID and pe.EVENT = ip.EVENT
where
    ip.EVENT = ?
    and ip.INCIDENT_NUMBER = ?;

-- name: IncidentPersonHasGrant :one
-- Whether this person has at least one granted involvement on a specific incident
-- (52f) — the per-incident read/journal-write exception for involved reporters.
select exists (
    select 1 from INCIDENT__PERSON
    where EVENT = ? and INCIDENT_NUMBER = ? and PERSON_ID = ? and GRANTED_ACCESS = true
) as HAS_GRANT;

-- name: GrantedIncidentNumbersForPerson :many
-- The incident numbers in an event that this person has been granted access to (52f).
select distinct INCIDENT_NUMBER
from INCIDENT__PERSON
where EVENT = ? and PERSON_ID = ? and GRANTED_ACCESS = true;

-- name: PersonHasAnyGrantInEvent :one
-- Whether this person has any granted incident involvement in the event (52f) —
-- drives the Incidents nav/list reveal for a reporter who has grants.
select exists (
    select 1 from INCIDENT__PERSON
    where EVENT = ? and PERSON_ID = ? and GRANTED_ACCESS = true
) as HAS_GRANT;

-- name: Incident_LinkedIncidents :many
select
    ili.EVENT_2 as LINKED_EVENT,
    e.NAME as LINKED_EVENT_NAME,
    ili.INCIDENT_NUMBER_2 as LINKED_INCIDENT,
    i2.SUMMARY as LINKED_INCIDENT_SUMMARY
from
    INCIDENT__LINKED_INCIDENT ili
    join `EVENT` e
        on e.ID = ili.EVENT_2
    join INCIDENT i2
        on i2.EVENT = ili.EVENT_2
            and i2.NUMBER = ili.INCIDENT_NUMBER_2
where
    ili.EVENT_1 = ?
    and ili.INCIDENT_NUMBER_1 = ?
;

-- name: Incidents_JournalEntries :many
select
    ire.INCIDENT_NUMBER,
    sqlc.embed(re),
    p.HANDLE as AUTHOR
from
    INCIDENT__JOURNAL_ENTRY ire
        join JOURNAL_ENTRY re
             on re.ID = ire.JOURNAL_ENTRY
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
where
    ire.EVENT = ?
    and re.GENERATED <= ?
;

-- name: Incident_JournalEntries :many
select
    ire.INCIDENT_NUMBER,
    sqlc.embed(re),
    p.HANDLE as AUTHOR
from
    INCIDENT__JOURNAL_ENTRY ire
        join JOURNAL_ENTRY re
             on re.ID = ire.JOURNAL_ENTRY
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
where
    ire.EVENT = ?
    and ire.INCIDENT_NUMBER = ?
;

-- name: IncidentTypes :many
select sqlc.embed(it)
from INCIDENT_TYPE it;

-- name: IncidentType :one
select sqlc.embed(it)
from INCIDENT_TYPE it
where it.ID = ?;

-- name: Reports :many
select sqlc.embed(fr)
from REPORT fr
where fr.EVENT = ?;

-- name: Report :one
select sqlc.embed(fr)
from REPORT fr
where fr.EVENT = ?
    and fr.NUMBER = ?;

-- name: Reports_JournalEntries :many
select
    irre.REPORT_NUMBER,
    sqlc.embed(re),
    p.HANDLE as AUTHOR,
    obo.HANDLE as ON_BEHALF_OF_HANDLE,
    obo.NAME as ON_BEHALF_OF_NAME
from
    REPORT__JOURNAL_ENTRY irre
        join JOURNAL_ENTRY re
             on irre.JOURNAL_ENTRY = re.ID
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
        left join PERSON obo
             on obo.ID = re.ON_BEHALF_OF_PERSON_ID
where
    irre.EVENT = ?
    and re.GENERATED <= ?
;

-- name: Report_JournalEntries :many
select
    sqlc.embed(re),
    p.HANDLE as AUTHOR,
    obo.HANDLE as ON_BEHALF_OF_HANDLE,
    obo.NAME as ON_BEHALF_OF_NAME
from
    REPORT__JOURNAL_ENTRY irre
        join JOURNAL_ENTRY re
             on irre.JOURNAL_ENTRY = re.ID
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
        left join PERSON obo
             on obo.ID = re.ON_BEHALF_OF_PERSON_ID
where
    irre.EVENT = ?
    and irre.REPORT_NUMBER = ?
;

-- name: AttachReportToIncident :exec
update REPORT
set INCIDENT_NUMBER = ?
where EVENT = ? and NUMBER = ?
;

-- This doesn't use "MAX" because sqlc can't figure out the type for aggregations :(.
-- name: NextReportNumber :one
select NUMBER + 1 as NEXT_ID
from REPORT
where EVENT = ?
union
select 1
order by 1 desc
limit 1;

-- This doesn't use "MAX" because sqlc can't figure out the type for aggregations :(.
-- name: NextIncidentNumber :one
select NUMBER + 1 as NEXT_ID
from INCIDENT
where EVENT = ?
union
select 1
order by 1 desc
limit 1;

-- name: CreateReport :exec
insert into REPORT (
    EVENT, NUMBER, CREATED, SUMMARY, INCIDENT_NUMBER
)
values (?, ?, ?, ?, ?);

-- name: UpdateReport :exec
update REPORT
set SUMMARY = ?, INCIDENT_NUMBER = ?
where EVENT = ? and NUMBER = ?;

-- name: CreateJournalEntry :execlastid
insert into JOURNAL_ENTRY (
    AUTHOR_PERSON_ID, TEXT, CREATED, `GENERATED`, STRICKEN,
    ATTACHED_FILE, ATTACHED_FILE_ORIGINAL_NAME, ATTACHED_FILE_MEDIA_TYPE,
    ON_BEHALF_OF_PERSON_ID
) values (
   ?, ?, ?, ?, ?, ?, ?, ?, ?
);

-- name: AttachJournalEntryToReport :exec
insert into REPORT__JOURNAL_ENTRY (
    EVENT, REPORT_NUMBER, JOURNAL_ENTRY
) values (
    ?, ?, ?
);

-- name: AttachJournalEntryToIncident :exec
insert into INCIDENT__JOURNAL_ENTRY (
    EVENT, INCIDENT_NUMBER, JOURNAL_ENTRY
) values (
    ?, ?, ?
);

-- name: AttachJournalEntryToVisit :exec
insert into VISIT__JOURNAL_ENTRY (
    EVENT, VISIT_NUMBER, JOURNAL_ENTRY
) values (
    ?, ?, ?
);

-- name: AttachVisitToIncident :exec
update VISIT
set INCIDENT_NUMBER = ?
where EVENT = ? and NUMBER = ?
;

-- name: CreateJournalEntryMention :exec
-- Record that a journal entry @mentions a person (plan 81). Insert-ignore so a
-- duplicate person in one entry's mention list is a no-op rather than an error.
insert ignore into JOURNAL_ENTRY__MENTION (
    JOURNAL_ENTRY, PERSON_ID
) values (
    ?, ?
);

-- name: IncidentHasPerson :one
-- Whether a person is already attached to an incident — used to fire an
-- "added_to_incident" notification only on a genuine new add, not on every
-- involvement edit (attach is a detach-then-reattach replace).
select exists (
    select 1 from INCIDENT__PERSON
    where EVENT = ? and INCIDENT_NUMBER = ? and PERSON_ID = ?
) as HAS_PERSON;

-- name: JournalEntryMentionPersonIDs :many
-- The (deduped) person IDs mentioned by one journal entry — the recipients of
-- "mentioned" notifications (plan 82). Read back from the persisted rows so the
-- IDs are guaranteed valid (the insert was insert-ignore).
select PERSON_ID from JOURNAL_ENTRY__MENTION where JOURNAL_ENTRY = ?;

-- name: CreateNotification :exec
insert into NOTIFICATION (
    RECIPIENT_PERSON_ID, TYPE, EVENT, INCIDENT_NUMBER, REPORT_NUMBER, JOURNAL_ENTRY, ACTOR_PERSON_ID, CREATED
) values (
    ?, ?, ?, ?, ?, ?, ?, ?
);

-- name: NotificationsForPerson :many
-- A person's most recent notifications, enriched for display (event name,
-- incident or report summary, actor handle/name).
select
    n.ID, n.TYPE, n.EVENT, n.INCIDENT_NUMBER, n.REPORT_NUMBER, n.JOURNAL_ENTRY,
    n.ACTOR_PERSON_ID, n.CREATED, n.READ_AT,
    e.NAME as EVENT_NAME,
    i.SUMMARY as INCIDENT_SUMMARY,
    r.SUMMARY as REPORT_SUMMARY,
    actor.HANDLE as ACTOR_HANDLE,
    actor.NAME as ACTOR_NAME
from NOTIFICATION n
    left join `EVENT` e on e.ID = n.EVENT
    left join INCIDENT i on i.EVENT = n.EVENT and i.NUMBER = n.INCIDENT_NUMBER
    left join REPORT r on r.EVENT = n.EVENT and r.NUMBER = n.REPORT_NUMBER
    left join PERSON actor on actor.ID = n.ACTOR_PERSON_ID
where n.RECIPIENT_PERSON_ID = ?
order by n.CREATED desc
limit 200;

-- name: UnreadNotificationCountForPerson :one
select count(*) as UNREAD from NOTIFICATION
where RECIPIENT_PERSON_ID = ? and READ_AT is null;

-- name: MarkNotificationRead :exec
-- Mark one notification read, scoped to its recipient so a caller can only mark
-- their own.
update NOTIFICATION set READ_AT = ?
where ID = ? and RECIPIENT_PERSON_ID = ? and READ_AT is null;

-- name: MarkAllNotificationsRead :exec
update NOTIFICATION set READ_AT = ?
where RECIPIENT_PERSON_ID = ? and READ_AT is null;

-- Web push subscriptions (plan 84). A device's ENDPOINT is its identity, so the
-- subscribe path reads by endpoint and then inserts or updates — rather than an
-- ODKU upsert — matching how the rest of the store handles unique-key upserts.

-- name: PushSubscriptionByEndpoint :one
select ID, PERSON_ID, ENDPOINT, P256DH, AUTH, USER_AGENT, CREATED
from PUSH_SUBSCRIPTION
where ENDPOINT = ?;

-- name: InsertPushSubscription :exec
insert into PUSH_SUBSCRIPTION (PERSON_ID, ENDPOINT, P256DH, AUTH, USER_AGENT, CREATED)
values (?, ?, ?, ?, ?, ?);

-- name: UpdatePushSubscriptionByEndpoint :exec
-- A re-subscribe of the same device refreshes its keys/owner; PERSON_ID is set
-- too so a device that changes hands re-homes to the current caller. CREATED is
-- intentionally left untouched: the client re-subscribes on every page load, so
-- bumping it would turn it into a last-seen time and reshuffle the device list.
update PUSH_SUBSCRIPTION
set PERSON_ID = ?, P256DH = ?, AUTH = ?, USER_AGENT = ?
where ENDPOINT = ?;

-- name: DeletePushSubscription :exec
-- Scoped to the caller so a person can only remove their own device.
delete from PUSH_SUBSCRIPTION
where ENDPOINT = ? and PERSON_ID = ?;

-- name: DeletePushSubscriptionByEndpoint :exec
-- Prune a dead subscription (push service returned 404/410). Not caller-scoped:
-- the endpoint is globally unique and the server prunes on the send path (84c).
delete from PUSH_SUBSCRIPTION
where ENDPOINT = ?;

-- name: PushSubscriptionsForPerson :many
-- Every device a person has subscribed (newest first). Backs the send fan-out
-- (84c) and a future "your devices" list (84d).
select ID, PERSON_ID, ENDPOINT, P256DH, AUTH, USER_AGENT, CREATED
from PUSH_SUBSCRIPTION
where PERSON_ID = ?
order by CREATED desc;

-- name: Incident_JournalEntryMentions :many
-- All mentions across the journal entries of one incident, with the mentioned
-- person's handle/name for display. Joined through INCIDENT__JOURNAL_ENTRY so
-- the event+incident scope is enforced (an entry's mentions are only readable
-- via the incident it belongs to).
select
    jem.JOURNAL_ENTRY,
    jem.PERSON_ID,
    p.HANDLE,
    p.NAME
from INCIDENT__JOURNAL_ENTRY ije
    join JOURNAL_ENTRY__MENTION jem on jem.JOURNAL_ENTRY = ije.JOURNAL_ENTRY
    join PERSON p on p.ID = jem.PERSON_ID
where ije.EVENT = ? and ije.INCIDENT_NUMBER = ?
;

-- name: Report_JournalEntryMentions :many
-- All mentions across the journal entries of one field report, scoped through
-- REPORT__JOURNAL_ENTRY (the report-side mirror of Incident_JournalEntryMentions).
select
    jem.JOURNAL_ENTRY,
    jem.PERSON_ID,
    p.HANDLE,
    p.NAME
from REPORT__JOURNAL_ENTRY rje
    join JOURNAL_ENTRY__MENTION jem on jem.JOURNAL_ENTRY = rje.JOURNAL_ENTRY
    join PERSON p on p.ID = jem.PERSON_ID
where rje.EVENT = ? and rje.REPORT_NUMBER = ?
;

--
-- The "stricken" queries seem bloated at first blush, because the whole
-- "where ID in (..." could just be "where ID =". What it's doing though is
-- ensuring that the provided eventID and incidentNumber actually align with
-- the journalEntryID in question, and that's important for authorization purposes.
--

-- name: SetIncidentJournalEntryStricken :exec
update JOURNAL_ENTRY
set STRICKEN = ?
where ID IN (
    select JOURNAL_ENTRY
    from INCIDENT__JOURNAL_ENTRY
    where EVENT = ?
        and INCIDENT_NUMBER = ?
        and JOURNAL_ENTRY = ?
);

-- name: SetReportJournalEntryStricken :exec
update JOURNAL_ENTRY
set STRICKEN = ?
where ID IN (
    select JOURNAL_ENTRY
    from REPORT__JOURNAL_ENTRY
    where EVENT = ?
      and REPORT_NUMBER = ?
      and JOURNAL_ENTRY = ?
);

-- name: SetVisitJournalEntryStricken :exec
update JOURNAL_ENTRY
set STRICKEN = ?
where ID IN (
    select JOURNAL_ENTRY
    from VISIT__JOURNAL_ENTRY
    where EVENT = ?
      and VISIT_NUMBER = ?
      and JOURNAL_ENTRY = ?
);

-- name: AttachPersonToIncident :exec
insert into INCIDENT__PERSON (EVENT, INCIDENT_NUMBER, PERSON_ID, INVOLVEMENT, GRANTED_ACCESS)
values (?, ?, ?, ?, ?);

-- name: DetachPersonFromIncident :exec
delete from INCIDENT__PERSON
where
    EVENT = ?
    and INCIDENT_NUMBER = ?
    and PERSON_ID = ?
;

-- name: LinkIncidents :exec
insert into INCIDENT__LINKED_INCIDENT
    (EVENT_1, INCIDENT_NUMBER_1, EVENT_2, INCIDENT_NUMBER_2)
values
    (?, ?, ?, ?)
;

-- name: UnlinkIncidents :exec
delete from INCIDENT__LINKED_INCIDENT
where
    EVENT_1 = ?
    and INCIDENT_NUMBER_1 = ?
    and EVENT_2 = ?
    and INCIDENT_NUMBER_2 = ?
;

-- name: AttachIncidentTypeToIncident :exec
insert into INCIDENT__INCIDENT_TYPE (
    EVENT, INCIDENT_NUMBER, INCIDENT_TYPE
) values (
     ?, ?, ?
 );

-- name: DetachIncidentTypeFromIncident :exec
delete from INCIDENT__INCIDENT_TYPE
where
    EVENT = ?
    and INCIDENT_NUMBER = ?
    and INCIDENT_TYPE = ?
;


-- name: CreateIncidentType :execlastid
insert into INCIDENT_TYPE (NAME, HIDDEN, `GROUP`)
values (?, ?, ?)
;

-- name: UpdateIncidentType :exec
update INCIDENT_TYPE
set HIDDEN = ?,
    NAME = ?,
    DESCRIPTION = ?,
    `GROUP` = ?
where ID = ?;

-- name: AddActionLog :execlastid
insert into ACTION_LOG
    (CREATED_AT, ACTION_TYPE, METHOD, PATH, REFERRER, USER_ID, USER_NAME, POSITION_ID, POSITION_NAME, CLIENT_ADDRESS, HTTP_STATUS, DURATION_MICROS)
values
    (?,?,?,?,?,?,?,?,?,?,?,?)
;

-- name: ActionLogs :many
select
    sqlc.embed(al)
from
    ACTION_LOG al
where
    al.CREATED_AT > sqlc.arg(min_time)
    and al.CREATED_AT < sqlc.arg(max_time)
;

-- name: Areas :many
select
    `EVENT`,
    `SLUG`,
    `NAME`,
    `PARENT_SLUG`,
    `SORT_ORDER`,
    `APPROVED`,
    `PROPOSED_BY_PERSON_ID`
from
    AREA
where
    `EVENT` = ?
order by `SORT_ORDER`, `NAME`
;

-- name: AreasWithProposer :many
-- Like Areas but resolves the proposer's handle/name for display (the Areas tab
-- shows who proposed a still-unapproved area). LEFT JOIN: approved/canonical
-- areas have no proposer.
select
    a.`EVENT`,
    a.`SLUG`,
    a.`NAME`,
    a.`PARENT_SLUG`,
    a.`SORT_ORDER`,
    a.`APPROVED`,
    a.`PROPOSED_BY_PERSON_ID`,
    p.HANDLE as PROPOSER_HANDLE,
    p.NAME as PROPOSER_NAME
from
    AREA a
    left join PERSON p on p.ID = a.`PROPOSED_BY_PERSON_ID`
where
    a.`EVENT` = ?
order by a.`SORT_ORDER`, a.`NAME`
;

-- name: LatestEventWithAreas :one
-- The most-recently-created (highest ID) non-group event that already has at
-- least one area. A newly-created event copies this event's areas forward, so
-- admin edits carry from one year to the next; returns no rows when no event has
-- areas yet (the very first event, which is seeded from the canonical list).
select e.ID
from `EVENT` e
where e.IS_GROUP = false
    and exists (select 1 from AREA a where a.`EVENT` = e.ID)
order by e.ID desc
limit 1
;

-- name: Area :one
select
    `EVENT`,
    `SLUG`,
    `NAME`,
    `PARENT_SLUG`,
    `SORT_ORDER`,
    `APPROVED`,
    `PROPOSED_BY_PERSON_ID`
from
    AREA
where
    `EVENT` = ?
    and `SLUG` = ?
;

-- name: CreateArea :exec
insert into AREA
    (`EVENT`, `SLUG`, `NAME`, `PARENT_SLUG`, `SORT_ORDER`, `APPROVED`, `PROPOSED_BY_PERSON_ID`)
values
    (?, ?, ?, ?, ?, ?, ?)
;

-- name: ApproveArea :exec
-- An admin approves a writer's proposed area; the proposer is kept for audit.
update AREA set
    `APPROVED` = true
where
    `EVENT` = ?
    and `SLUG` = ?
;

-- name: DeleteArea :exec
delete from AREA
where
    `EVENT` = ?
    and `SLUG` = ?
;

-- name: RepointIncidentsArea :exec
-- Re-point every incident in an event from one area slug to another. Used when
-- an admin marks a proposed area a duplicate: incidents move to the canonical
-- area before the duplicate is deleted (its AREA FK would otherwise block it).
update INCIDENT set
    `LOCATION_AREA_SLUG` = sqlc.arg(to_slug)
where
    `EVENT` = sqlc.arg(event)
    and `LOCATION_AREA_SLUG` = sqlc.arg(from_slug)
;

-- name: UpdateArea :exec
update AREA set
    -- SLUG is immutable, so it is the lookup key, never updated.
    `NAME` = ?,
    `PARENT_SLUG` = ?,
    `SORT_ORDER` = ?
where
    `EVENT` = ?
    and `SLUG` = ?
;

-- name: CreateVisit :execlastid
insert into VISIT (`EVENT`, NUMBER, CREATED) values (?, ?, ?);

-- name: UpdateVisit :exec
update VISIT set
    -- CREATED should be immutable, so it's not present in this UPDATE query
    INCIDENT_NUMBER = ?,
    GUEST_PERSON_ID = ?,
    GUEST_LEGAL_NAME = ?,
    GUEST_DESCRIPTION = ?,
    GUEST_ACTION_PLAN = ?,
    GUEST_CAMP_NAME = ?,
    GUEST_CAMP_ADDRESS = ?,
    GUEST_CAMP_DESCRIPTION = ?,
    GUEST_CAMP_CONTACTS = ?,

    ARRIVAL_TIME = ?,
    ARRIVAL_METHOD = ?,
    ARRIVAL_STATE = ?,
    ARRIVAL_REASON = ?,
    ARRIVAL_BELONGINGS = ?,

    DEPARTURE_TIME = ?,
    DEPARTURE_METHOD = ?,
    DEPARTURE_STATE = ?,

    RESOURCE_SITTER = ?,
    RESOURCE_BED_ID = ?,
    RESOURCE_REST = ?,
    RESOURCE_CLOTHES = ?,
    RESOURCE_POGS = ?,
    RESOURCE_FOOD_BEV = ?,
    RESOURCE_OTHER = ?
where
    EVENT = ?
    and NUMBER = ?
;

-- The Visit/Visits queries LEFT JOIN PERSON via GUEST_PERSON_ID so each visit
-- carries its linked guest's display name + handle (null when no guest is linked).
-- The guest's preferred name lives on PERSON.NAME since slice 5e.3. Both queries
-- select the same shape so api/visit.go can cast VisitsRow -> VisitRow.
-- name: Visit :one
select
    sqlc.embed(s),
    gp.HANDLE as GUEST_HANDLE,
    gp.NAME as GUEST_NAME
from
    VISIT s
    left join PERSON gp on gp.ID = s.GUEST_PERSON_ID
where
    s.EVENT = ?
    and s.NUMBER = ?;

-- name: Visits :many
select
    sqlc.embed(s),
    gp.HANDLE as GUEST_HANDLE,
    gp.NAME as GUEST_NAME
from
    VISIT s
    left join PERSON gp on gp.ID = s.GUEST_PERSON_ID
where
    s.EVENT = ?
group by
    s.NUMBER;

-- name: Visits_People :many
select
    sqlc.embed(vp),
    p.HANDLE,
    p.NAME
from
    VISIT__PERSON vp
    join PERSON p on p.ID = vp.PERSON_ID
where
    vp.EVENT = ?;

-- name: Visit_People :many
select
    sqlc.embed(vp),
    p.HANDLE,
    p.NAME
from
    VISIT__PERSON vp
    join PERSON p on p.ID = vp.PERSON_ID
where
    vp.EVENT = ?
    and vp.VISIT_NUMBER = ?;

-- name: AttachPersonToVisit :exec
insert into VISIT__PERSON (EVENT, VISIT_NUMBER, PERSON_ID, INVOLVEMENT)
values (?, ?, ?, ?);

-- name: DetachPersonFromVisit :exec
delete from VISIT__PERSON
where
    EVENT = ?
    and VISIT_NUMBER = ?
    and PERSON_ID = ?
;

-- name: Visit_JournalEntries :many
select
    sre.VISIT_NUMBER,
    sqlc.embed(re),
    p.HANDLE as AUTHOR
from
    VISIT__JOURNAL_ENTRY sre
        join JOURNAL_ENTRY re
             on re.ID = sre.JOURNAL_ENTRY
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
where
    sre.EVENT = ?
    and sre.VISIT_NUMBER = ?
;

-- name: Visits_JournalEntries :many
select
    sre.VISIT_NUMBER,
    sqlc.embed(re),
    p.HANDLE as AUTHOR
from
    VISIT__JOURNAL_ENTRY sre
        join JOURNAL_ENTRY re
             on re.ID = sre.JOURNAL_ENTRY
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
where
    sre.EVENT = ?
    and re.GENERATED <= ?
;

-- This doesn't use "MAX" because sqlc can't figure out the type for aggregations :(.
-- name: NextVisitNumber :one
select NUMBER + 1 as NEXT_ID
from VISIT
where EVENT = ?
union
select 1
order by 1 desc
limit 1;

--
-- Local people directory queries.
--
-- These back the local (IMS-DB) implementation of directory.IUserStore, sourced
-- from the local PERSON/POSITION/TEAM tables. See
-- docs/plans/31-local-people-directory.md and docs/plans/32-retire-clubhouse.md.
--

-- name: People :many
select ID, HANDLE, EMAIL, PASSWORD, IS_ADMIN
from PERSON;

-- AllPeople returns every person, for the admin People page. It LEFT JOINs
-- PERSON__EVENT for the given event so each row carries that event's wristband +
-- participation type — null when the person has no row for the event yet, or when
-- no event is selected (event = 0 matches nothing). The login directory and the
-- attach-person autocompletes use the People query instead.
-- name: AllPeople :many
select
    p.ID, p.HANDLE, p.NAME, p.EMAIL, p.IS_ADMIN,
    pe.WRISTBAND, pe.PARTICIPATION_TYPE
from PERSON p
    left join PERSON__EVENT pe on pe.PERSON_ID = p.ID and pe.EVENT = sqlc.arg(event)
order by coalesce(p.NAME, p.HANDLE);

-- name: PersonByHandle :one
select ID, HANDLE, EMAIL, IS_ADMIN
from PERSON
where HANDLE = ?;

-- PersonByID resolves a person by their stable primary key. Since 5e the web UI
-- addresses people by person_id (registry people may have no handle), so the
-- attach/detach and personnel-edit handlers look people up here.
-- name: PersonByID :one
select ID, HANDLE, NAME, EMAIL, IS_ADMIN
from PERSON
where ID = ?;

-- name: CreatePerson :execlastid
insert into PERSON (HANDLE, NAME, EMAIL, PASSWORD, CREATED)
values (?, ?, ?, ?, ?);

-- EditPerson updates a person's editable profile fields. NAME and EMAIL are
-- nullable identity fields the admin People page can change (the email gap closed
-- in 5e.4); HANDLE stays immutable (it's the identifier in person: access
-- expressions). Per-event wristband/participation live on PERSON__EVENT via
-- UpsertPersonEvent, not here.
-- name: EditPerson :exec
update PERSON
set NAME = ?, EMAIL = ?
where ID = ?;

-- name: SetPersonPassword :exec
update PERSON
set PASSWORD = ?
where ID = ?;

-- name: SetPersonAdmin :exec
update PERSON
set IS_ADMIN = ?
where ID = ?;

-- name: CountAdmins :one
select count(*)
from PERSON
where IS_ADMIN = true;

-- SearchPeople backs the typeahead person picker (search-first attach + admin
-- search). It matches the query term against handle, display name, and — when an
-- event is given — that event's wristband, LEFT JOINing PERSON__EVENT so each hit
-- carries the event's wristband + participation type (null when the person has no
-- row for the event yet). Pass event = 0 to search without per-event fields. Caller
-- supplies the LIKE wildcards in `query` (e.g. "%term%").
-- name: SearchPeople :many
select
    p.ID,
    p.HANDLE,
    p.NAME,
    pe.WRISTBAND,
    pe.PARTICIPATION_TYPE
from PERSON p
    left join PERSON__EVENT pe on pe.PERSON_ID = p.ID and pe.EVENT = sqlc.arg(event)
where
    coalesce(p.HANDLE, '') like sqlc.arg(query)
    or coalesce(p.NAME, '') like sqlc.arg(query)
    or coalesce(pe.WRISTBAND, '') like sqlc.arg(query)
order by coalesce(p.NAME, p.HANDLE)
limit 25;

-- PersonEvent reads how a person relates to one event (their wristband +
-- participation type), or sql.ErrNoRows if they have no row for it yet. It lets the
-- handler decide between InsertPersonEvent and UpdatePersonEvent rather than using
-- INSERT ... ON DUPLICATE KEY UPDATE, which fires on *either* unique key — so a
-- wristband already held by a different person (the EVENT,WRISTBAND key) would
-- silently relabel that person instead of conflicting. See docs/plans/51-people-registry.md.
-- name: PersonEvent :one
select PERSON_ID, EVENT, WRISTBAND, PARTICIPATION_TYPE
from PERSON__EVENT
where PERSON_ID = ? and EVENT = ?;

-- PersonEventsForPerson returns every per-event participation row for one person.
-- It backs the cross-event permission map (plan 52b: access derives from
-- PARTICIPATION_TYPE), so the caller can map each event's tier to a role.
-- name: PersonEventsForPerson :many
select EVENT, PARTICIPATION_TYPE
from PERSON__EVENT
where PERSON_ID = ?;

-- InsertPersonEvent creates a person's per-event row. A wristband already taken in
-- the event violates the (EVENT, WRISTBAND) unique key (a real conflict the caller
-- maps to 409); null wristbands don't collide (MySQL allows multiple NULLs).
-- name: InsertPersonEvent :exec
insert into PERSON__EVENT (PERSON_ID, EVENT, WRISTBAND, PARTICIPATION_TYPE)
values (?, ?, ?, ?);

-- UpdatePersonEvent updates a person's existing per-event row, keyed on their own
-- (PERSON_ID, EVENT). Setting a wristband held by another person in the event still
-- violates the (EVENT, WRISTBAND) unique key (→ 409), so it can't steal one.
-- name: UpdatePersonEvent :exec
update PERSON__EVENT
set WRISTBAND = ?, PARTICIPATION_TYPE = ?
where PERSON_ID = ? and EVENT = ?;

-- EventRoster returns only the people who have a participation row for the given
-- event (the per-event roster). It mirrors AllPeople's columns so the People page
-- renders both the same way; the "Show all people" toggle switches to AllPeople.
-- It includes the kept-but-inactive states (not_present/ejected) so an ejection
-- stays visible in the roster rather than disappearing.
-- name: EventRoster :many
select
    p.ID, p.HANDLE, p.NAME, p.EMAIL, p.IS_ADMIN,
    pe.WRISTBAND, pe.PARTICIPATION_TYPE
from PERSON p
    join PERSON__EVENT pe on pe.PERSON_ID = p.ID and pe.EVENT = sqlc.arg(event)
order by coalesce(p.NAME, p.HANDLE);

-- DeletePersonEvent removes a person's participation row for an event entirely —
-- the "added by mistake" removal. The global PERSON and any incident/visit links
-- are untouched (independent tables). To instead record an ejection, keep the row
-- and set PARTICIPATION_TYPE to 'ejected'/'not_present' via UpdatePersonEvent.
-- name: DeletePersonEvent :exec
delete from PERSON__EVENT
where PERSON_ID = ? and EVENT = ?;

-- name: PeoplePositions :many
select PERSON_ID, POSITION_ID
from PERSON__POSITION;

-- name: PeopleTeams :many
select PERSON_ID, TEAM_ID
from PERSON__TEAM;

-- name: PeoplePositionsList :many
select ID, NAME
from `POSITION`;

-- name: PeopleTeamsList :many
select ID, NAME
from TEAM;

-- ============================================================================
-- Dashboard metrics (Phase 7). All read-only, all filtered by EVENT. The
-- join-heavy category/type/area aggregations run as GROUP BY in SQL; the
-- state/priority/by-day/time-to-close/follow-up metrics are derived in Go from
-- one lightweight per-incident SELECT (MetricsIncidents) to keep the query count
-- low and sidestep sqlc's weaker inference on AVG/date aggregations.
-- See docs/plans/70-dashboards.md.
-- ============================================================================

-- MetricsIncidents returns one lightweight row per incident in the event. The
-- handler aggregates these in Go into totals (total/open/closed), counts by
-- state and priority, the by-day created series, average time-to-close (over
-- closed incidents), and the open-follow-ups list (OUTCOME='follow_up_required'
-- and STATE!='closed'). CLOSED is nullable; it is set only for closed incidents.
-- name: MetricsIncidents :many
select
    i.NUMBER,
    i.STATE,
    i.PRIORITY,
    i.CREATED,
    i.CLOSED,
    i.OUTCOME,
    i.SUMMARY
from INCIDENT i
where i.EVENT = ?
order by i.NUMBER;

-- MetricsIncidentCountByCategory counts DISTINCT incidents per INCIDENT_TYPE.GROUP
-- category. Because an incident can have several types in several categories, the
-- per-category counts sum to >= the incident total — they are "incidents with a
-- type in this category", not a partition. CATEGORY is null for ungrouped types.
-- name: MetricsIncidentCountByCategory :many
select
    it.`GROUP` as CATEGORY,
    count(distinct i.NUMBER) as COUNT
from INCIDENT i
    join INCIDENT__INCIDENT_TYPE iit
        on iit.EVENT = i.EVENT and iit.INCIDENT_NUMBER = i.NUMBER
    join INCIDENT_TYPE it
        on it.ID = iit.INCIDENT_TYPE
where i.EVENT = ?
group by it.`GROUP`;

-- MetricsIncidentCountByType counts DISTINCT incidents per incident type. Same
-- multi-type caveat as the category query: the counts can sum to more than the
-- incident total. Ordered most-frequent first.
-- name: MetricsIncidentCountByType :many
select
    it.ID as TYPE_ID,
    it.NAME as TYPE_NAME,
    count(distinct i.NUMBER) as COUNT
from INCIDENT i
    join INCIDENT__INCIDENT_TYPE iit
        on iit.EVENT = i.EVENT and iit.INCIDENT_NUMBER = i.NUMBER
    join INCIDENT_TYPE it
        on it.ID = iit.INCIDENT_TYPE
where i.EVENT = ?
group by it.ID, it.NAME
order by COUNT desc, it.NAME;

-- MetricsIncidentCountByArea counts incidents per location area. Each incident
-- has at most one LOCATION_AREA_SLUG, so this is a clean partition; incidents
-- with no area come back with a null slug/name (the handler labels them
-- "Unassigned"). The LEFT JOIN carries the area's display name. Ordered busiest
-- first, so the same result doubles as the repeat-locations ranking.
-- name: MetricsIncidentCountByArea :many
select
    i.LOCATION_AREA_SLUG as AREA_SLUG,
    a.NAME as AREA_NAME,
    count(*) as COUNT
from INCIDENT i
    left join AREA a
        on a.EVENT = i.EVENT and a.SLUG = i.LOCATION_AREA_SLUG
where i.EVENT = ?
group by i.LOCATION_AREA_SLUG, a.NAME
order by COUNT desc, a.NAME;

-- MetricsParticipationCountByEvent counts the people on an event's roster, grouped
-- by their participation rung. Each person has at most one PERSON__EVENT row per
-- event, so these counts partition the roster.
-- name: MetricsParticipationCountByEvent :many
select
    PARTICIPATION_TYPE as PARTICIPATION,
    count(*) as COUNT
from PERSON__EVENT
where EVENT = ?
group by PARTICIPATION_TYPE;
