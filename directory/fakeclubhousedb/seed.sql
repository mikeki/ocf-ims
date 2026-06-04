-- Set defaults on these several NOT NULL columns whose values are irrelevant for IMS.
-- This makes the INSERT statement less cluttered.
alter table `person`
    modify column `first_name` varchar(25) NOT NULL DEFAULT '',
    modify column `last_name` varchar(25) NOT NULL DEFAULT '',
    modify column `callsign_normalized` varchar(128) NOT NULL DEFAULT '',
    modify column `callsign_soundex` varchar(128) NOT NULL DEFAULT '',
    modify column `pronouns_custom` varchar(191) NOT NULL DEFAULT ''
;

insert into `person`
(`id`,  `callsign`,         `email`,                              `password`,                     `status`,   `on_site`)
values
-- Demo accounts. Each user's password equals their (case-sensitive) callsign.
-- Miguel is the admin (matched against IMS_ADMINS in the env).
(600,   "Miguel",           "miguel@example.com",                 "$argon2id$v=19$m=8192,t=4,p=1$tL68tr5BXPSUKD+2m4fx5A$h+JZLy1t+Ch1NnM+xro0REQrSAfq7Egtc/RgfOfzWYo", "active",   true),
(601,   "ShadowDancer",     "shadowdancer@example.com",           "$argon2id$v=19$m=8192,t=4,p=1$pZevNxeYuILQUIzHBHmEcQ$1tUEWKGlpmEHakHQXoz3UYQ5EyL01qHmlVfBfuq5oj0", "active",   true),
(602,   "TeamMember",       "teammember@example.com",             "$argon2id$v=19$m=8192,t=4,p=1$aeRknlIpDHICmM6mD7DyUA$nGvCg3AIwmWAiT1M2HBqlScDS0cEHEIoE93w71DzqlI", "active",   true)
;

insert into `position`
(`id`, `title`)
values
(701, "Driver"),
(702, "Dancer")
;

insert into `person_position`
(`person_id`, `position_id`)
values
(601, 702)
;

insert into `team`
(`id`, `title`)
values
(800, "Driving Team")
;

insert into `person_team`
(`person_id`, `team_id`)
values
(602, 800)
;

insert into `timesheet`
(`person_id`, `position_id`, `on_duty`, `off_duty`)
values
(601, 702, now(), null)
;
