-- name: QueryEventID :one
select sqlc.embed(e) from EVENT e where e.NAME = ?;

-- name: SchemaVersion :one
select VERSION from SCHEMA_INFO;

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

-- This returns access for a target event, as well as for that event's
-- parent group, if any. If the target event *is* a group, this query
-- will return nothing. That's intentional, and it helps prevent people
-- from adding incidents or FRs to event groups as though those were events.
-- name: EventAndParentAccess :many
select sqlc.embed(ea)
from `EVENT` e
    join EVENT_ACCESS ea
        on e.ID = ea.EVENT
where e.ID = sqlc.arg(event_id)
    and not e.IS_GROUP
union all
select sqlc.embed(ea)
from `EVENT` e
    join EVENT_ACCESS ea
        on e.PARENT_GROUP = ea.EVENT
where e.ID = sqlc.arg(event_id)
    and e.PARENT_GROUP is not null
;


-- name: EventAccessAll :many
select sqlc.embed(ea)
from EVENT_ACCESS ea
;

-- name: ClearEventAccessForMode :exec
delete from EVENT_ACCESS
where EVENT = ? and MODE = ?;

-- name: ClearEventAccessForExpression :exec
delete from EVENT_ACCESS
where EVENT = ? and EXPRESSION = ?;

-- name: AddEventAccess :execlastid
insert into EVENT_ACCESS (EVENT, EXPRESSION, MODE, VALIDITY, EXPIRES)
values (?, ?, ?, ?, ?);

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
    p.NAME
from
    INCIDENT__PERSON ip
    join PERSON p on p.ID = ip.PERSON_ID
where
    ip.EVENT = ?;

-- name: Incident_People :many
select
    sqlc.embed(ip),
    p.HANDLE,
    p.NAME
from
    INCIDENT__PERSON ip
    join PERSON p on p.ID = ip.PERSON_ID
where
    ip.EVENT = ?
    and ip.INCIDENT_NUMBER = ?;

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
    p.HANDLE as AUTHOR
from
    REPORT__JOURNAL_ENTRY irre
        join JOURNAL_ENTRY re
             on irre.JOURNAL_ENTRY = re.ID
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
where
    irre.EVENT = ?
    and re.GENERATED <= ?
;

-- name: Report_JournalEntries :many
select
    sqlc.embed(re),
    p.HANDLE as AUTHOR
from
    REPORT__JOURNAL_ENTRY irre
        join JOURNAL_ENTRY re
             on irre.JOURNAL_ENTRY = re.ID
        join PERSON p
             on p.ID = re.AUTHOR_PERSON_ID
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
    ATTACHED_FILE, ATTACHED_FILE_ORIGINAL_NAME, ATTACHED_FILE_MEDIA_TYPE
) values (
   ?, ?, ?, ?, ?, ?, ?, ?
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
insert into INCIDENT__PERSON (EVENT, INCIDENT_NUMBER, PERSON_ID, INVOLVEMENT)
values (?, ?, ?, ?);

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
    `SORT_ORDER`
from
    AREA
where
    `EVENT` = ?
order by `SORT_ORDER`, `NAME`
;

-- name: Area :one
select
    `EVENT`,
    `SLUG`,
    `NAME`,
    `PARENT_SLUG`,
    `SORT_ORDER`
from
    AREA
where
    `EVENT` = ?
    and `SLUG` = ?
;

-- name: CreateArea :exec
insert into AREA
    (`EVENT`, `SLUG`, `NAME`, `PARENT_SLUG`, `SORT_ORDER`)
values
    (?, ?, ?, ?, ?)
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
select ID, HANDLE, EMAIL, STATUS, ON_SITE, PASSWORD, IS_ADMIN
from PERSON
where STATUS = 'active';

-- AllPeople returns every person regardless of status, for the admin People page
-- (so admins can see and reactivate inactive people). It LEFT JOINs PERSON__EVENT
-- for the given event so each row carries that event's wristband + participation
-- type — null when the person has no row for the event yet, or when no event is
-- selected (event = 0 matches nothing). The login directory and the attach-person
-- autocompletes use the active-only People query instead.
-- name: AllPeople :many
select
    p.ID, p.HANDLE, p.NAME, p.EMAIL, p.STATUS, p.ON_SITE, p.IS_ADMIN,
    pe.WRISTBAND, pe.PARTICIPATION_TYPE
from PERSON p
    left join PERSON__EVENT pe on pe.PERSON_ID = p.ID and pe.EVENT = sqlc.arg(event)
order by coalesce(p.NAME, p.HANDLE);

-- name: PersonByHandle :one
select ID, HANDLE, EMAIL, STATUS, ON_SITE, IS_ADMIN
from PERSON
where HANDLE = ?;

-- PersonByID resolves a person by their stable primary key. Since 5e the web UI
-- addresses people by person_id (registry people may have no handle), so the
-- attach/detach and personnel-edit handlers look people up here.
-- name: PersonByID :one
select ID, HANDLE, NAME, EMAIL, STATUS, ON_SITE, IS_ADMIN
from PERSON
where ID = ?;

-- name: CreatePerson :execlastid
insert into PERSON (HANDLE, NAME, EMAIL, STATUS, ON_SITE, PASSWORD, CREATED)
values (?, ?, ?, ?, ?, ?, ?);

-- EditPerson updates a person's editable profile fields. NAME and EMAIL are
-- nullable identity fields the admin People page can change (the email gap closed
-- in 5e.4); HANDLE stays immutable (it's the identifier in person: access
-- expressions). Per-event wristband/participation live on PERSON__EVENT via
-- UpsertPersonEvent, not here.
-- name: EditPerson :exec
update PERSON
set NAME = ?, EMAIL = ?, STATUS = ?, ON_SITE = ?
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
-- row for the event yet). Active people only, mirroring the attach autocompletes;
-- pass event = 0 to search without per-event fields. Caller supplies the LIKE
-- wildcards in `query` (e.g. "%term%").
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
    p.STATUS = 'active'
    and (
        coalesce(p.HANDLE, '') like sqlc.arg(query)
        or coalesce(p.NAME, '') like sqlc.arg(query)
        or coalesce(pe.WRISTBAND, '') like sqlc.arg(query)
    )
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
