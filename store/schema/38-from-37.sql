-- Cut incident location over to the structured per-event AREA model (added in
-- migration 37) and retire the Burning Man PLACE directory.
--
-- INCIDENT gains a nullable LOCATION_AREA_SLUG FK into AREA(EVENT, SLUG); the
-- playa free-text LOCATION_NAME / LOCATION_ADDRESS are dropped. LOCATION_DESCRIPTION
-- is retained as the freeform "place / details" box alongside the area FK.
alter table INCIDENT
    add column LOCATION_AREA_SLUG varchar(128),
    add constraint INCIDENT_TO_AREA
        foreign key (`EVENT`, LOCATION_AREA_SLUG) references AREA(`EVENT`, `SLUG`),
    drop column LOCATION_NAME,
    drop column LOCATION_ADDRESS;

-- PLACE was the Burning Man camp/art/mutant-vehicle directory; its only
-- incident-facing role was the location autocomplete that AREA now replaces.
drop table `PLACE`;

update `SCHEMA_INFO` set `VERSION` = 38 where true;
