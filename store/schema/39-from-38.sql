-- Add a nullable incident OUTCOME (disposition) enum to INCIDENT.
--
-- OUTCOME is orthogonal to STATE: STATE is the operational workflow (new →
-- dispatched → closed), while OUTCOME classifies what happened with the
-- incident (Information Only, Resolved On Scene, Referred to Coordinator, …).
-- There is no coupling between the two. Nullable so an incident can have no
-- recorded disposition yet.
alter table INCIDENT
    add column OUTCOME enum(
        'information_only', 'resolved_on_scene', 'referred_to_coordinator',
        'referred_to_management', 'referred_to_community_support',
        'referred_to_mediation', 'follow_up_required', 'no_action_needed'
    );

update `SCHEMA_INFO` set `VERSION` = 39 where true;
