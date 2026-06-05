-- Remove the deprecated Concentric Streets / radial-clock geography feature.
--
-- This Burning Man-specific location model (concentric ring streets + radial
-- hour/minute clock addresses) has been unused since late 2025. Migration
-- 24-from-23 already folded the radial/concentric values into the free-form
-- LOCATION_ADDRESS column (e.g. "10:05 & Esplanade"), so dropping these columns
-- and the CONCENTRIC_STREET table loses no data.

-- The FK INCIDENT (EVENT, LOCATION_CONCENTRIC) -> CONCENTRIC_STREET and its
-- backing index must go before the column can be dropped.
alter table `INCIDENT`
    drop foreign key if exists `INCIDENT_ibfk_2`;

drop index if exists `EVENT` on `INCIDENT`;

alter table `INCIDENT`
    drop column if exists `LOCATION_CONCENTRIC`,
    drop column if exists `LOCATION_RADIAL_HOUR`,
    drop column if exists `LOCATION_RADIAL_MINUTE`;

drop table if exists `CONCENTRIC_STREET`;

update `SCHEMA_INFO`
set `VERSION` = 32
where true;
