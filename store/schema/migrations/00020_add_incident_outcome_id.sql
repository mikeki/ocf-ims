-- +goose Up
-- Feedback item 1 / slice 10a (PR B): rewire INCIDENT from the hardcoded OUTCOME
-- enum to the data-driven OUTCOME table added in 00019. Add a nullable OUTCOME_ID
-- FK and backfill it from the legacy enum by matching each enum value to the
-- seeded OUTCOME row's display NAME. The legacy OUTCOME enum column is dropped in
-- the next migration (00021), once nothing reads it.
-- +goose StatementBegin
alter table INCIDENT
    add column OUTCOME_ID integer default null,
    add constraint `INCIDENT_OUTCOME_TO_OUTCOME` foreign key (OUTCOME_ID) references OUTCOME(ID);
-- +goose StatementEnd
-- +goose StatementBegin
-- Backfill: map every legacy enum value to its OUTCOME row by the display NAME the
-- 00019 seed used. Rows with a NULL enum stay NULL (no outcome recorded).
update INCIDENT i
join OUTCOME o on o.NAME = case i.OUTCOME
    when 'information_only'             then 'Information Only'
    when 'resolved_on_scene'           then 'Resolved On Scene'
    when 'referred_to_coordinator'     then 'Referred to Coordinator'
    when 'referred_to_management'      then 'Referred to Management'
    when 'referred_to_community_support' then 'Referred to Community Support'
    when 'referred_to_mediation'       then 'Referred to Mediation'
    when 'follow_up_required'          then 'Follow-Up Required'
    when 'no_action_needed'            then 'No Action Needed'
    when 'taken_to_big_bird'           then 'Taken to Big Bird'
    when 'taken_to_little_wing'        then 'Taken to Little Wing'
    when 'asked_to_leave'              then 'Asked to Leave'
    when 'booted'                      then 'Booted'
    when 'arrested'                    then 'Arrested'
    when 'transported_in_ambulance'    then 'Transported in Ambulance'
end
set i.OUTCOME_ID = o.ID
where i.OUTCOME is not null;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
alter table INCIDENT
    drop foreign key `INCIDENT_OUTCOME_TO_OUTCOME`,
    drop column OUTCOME_ID;
-- +goose StatementEnd
