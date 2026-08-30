-- +goose Up
-- Feedback item 1 / slice 10a (PR B): the legacy INCIDENT.OUTCOME enum has been
-- superseded by the OUTCOME_ID FK (backfilled in 00020) and nothing reads it any
-- more. Drop it. This is the final step promoting outcomes to data-driven rows.
-- +goose StatementBegin
alter table INCIDENT drop column OUTCOME;
-- +goose StatementEnd

-- +goose Down
-- Best-effort revert: re-add the enum column (empty). It is NOT backfilled from
-- OUTCOME_ID — production rolls forward, this is dev convenience only.
-- +goose StatementBegin
alter table INCIDENT
    add column OUTCOME enum(
        'information_only', 'resolved_on_scene', 'referred_to_coordinator',
        'referred_to_management', 'referred_to_community_support',
        'referred_to_mediation', 'follow_up_required', 'no_action_needed',
        'taken_to_big_bird', 'taken_to_little_wing', 'asked_to_leave',
        'booted', 'arrested', 'transported_in_ambulance'
    ) default null;
-- +goose StatementEnd
