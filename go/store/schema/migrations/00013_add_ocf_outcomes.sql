-- +goose Up
-- Round-7 feedback: extend the incident-outcome taxonomy with the OCF-specific
-- dispositions used at the Fair. Appended after the original eight so existing
-- rows keep their values and the enum ordinals of the originals are unchanged.
alter table INCIDENT
    modify OUTCOME enum(
        'information_only', 'resolved_on_scene', 'referred_to_coordinator',
        'referred_to_management', 'referred_to_community_support',
        'referred_to_mediation', 'follow_up_required', 'no_action_needed',
        'taken_to_big_bird', 'taken_to_little_wing', 'asked_to_leave',
        'booted', 'arrested', 'transported_in_ambulance'
    );

-- +goose Down
-- Best-effort revert to the original eight. Fails if any row uses a new value
-- (production rolls forward; this is dev convenience only).
alter table INCIDENT
    modify OUTCOME enum(
        'information_only', 'resolved_on_scene', 'referred_to_coordinator',
        'referred_to_management', 'referred_to_community_support',
        'referred_to_mediation', 'follow_up_required', 'no_action_needed'
    );
