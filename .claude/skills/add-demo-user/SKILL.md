---
name: add-demo-user
description: Add one or more demo users to the fake Clubhouse directory. Use when the user asks to add demo/test users, seed users, or login accounts for the dev/demo environment — they live in directory/fakeclubhousedb/seed.sql and (if the dev stack is already running) need to be inserted into the live clubhouse-db container as well.
---

# Add demo user(s) to the fake Clubhouse directory

Demo users for local dev live in `directory/fakeclubhousedb/seed.sql`. This file is loaded into the `clubhouse-db` MariaDB container **only on first init** (via `/docker-entrypoint-initdb.d/`), so for an already-running stack you must also apply the new rows to the live DB.

## 1. Pick callsign, email, password, and id

- **Callsign**: alphanumeric, no spaces (e.g. `Shell Bell` → `ShellBell`, `J-Rock` → `JRock`). Must be unique.
- **Email**: must be unique. Use real address or `<callsign>@example.com`.
- **Password**: any string — the seed traditionally uses the callsign itself, but anything works.
- **id**: next free integer above the highest existing row. Persons currently start at 600; check `seed.sql` for the current max.

## 2. Generate the argon2id password hash

The server expects ClubhouseParams: `m=8192, t=4, p=1, saltLen=16, keyLen=32`.

**Preferred** — use the project's CLI (requires `go` on PATH):
```bash
go run main.go hash_password --password='<the-password>'
```

**Fallback** — if `go` isn't available, use the `argon2` npm package with matching params:
```bash
mkdir -p /tmp/argon2-gen && cd /tmp/argon2-gen && npm install argon2 >/dev/null
node -e "const a=require('argon2');a.hash('<password>',{type:a.argon2id,version:0x13,memoryCost:8192,timeCost:4,parallelism:1,hashLength:32,saltLength:16}).then(console.log)"
```

Either produces a PHC string like `$argon2id$v=19$m=8192,t=4,p=1$<salt>$<hash>`.

## 3. Add the row to `directory/fakeclubhousedb/seed.sql`

Append inside the existing `insert into person (...) values` block. Keep column alignment consistent. Example:

```sql
(614, "NewCallsign", "user@example.com", "$argon2id$v=19$m=8192,t=4,p=1$...", "active", true),
```

This makes the user appear on any **fresh** stack init.

## 4. If the dev stack is already running, also insert into the live DB

The seed only runs when `./.docker/mysql/data-clubhouse/` is empty. To add to a running stack without wiping data:

```bash
docker exec -i ranger-clubhouse-db mariadb -uclubhouseuser -pclubhousepassword rangers <<'SQL'
insert into `person` (`id`, `callsign`, `email`, `password`, `status`, `on_site`) values
(614, "NewCallsign", "user@example.com", "$argon2id$v=19$m=8192,t=4,p=1$...", "active", true);
SQL
```

Credentials come from `docker-compose.dev.yml` (`clubhouseuser` / `clubhousepassword` / db `rangers`) unless `.env` overrides them.

Verify:
```bash
docker exec ranger-clubhouse-db mariadb -uclubhouseuser -pclubhousepassword rangers \
  -e "SELECT id, callsign, email FROM person ORDER BY id;"
```

## 5. Wait for cache or restart the IMS server

The IMS server caches the user directory in-memory (default TTL **5 minutes**, see `conf/imsconfig.go` → `InMemoryCacheTTL`). New users become loginable either after the TTL elapses or immediately after:

```bash
docker restart ranger-ims-go
```

## Notes

- The `ALTER TABLE person` at the top of `seed.sql` sets defaults on several NOT NULL columns (`first_name`, `last_name`, `callsign_normalized`, `callsign_soundex`, `pronouns_custom`) so they can be omitted from inserts. That ALTER ran on first init and remains in effect — direct `docker exec` inserts can omit those columns too.
- `IMS_ADMINS` (in `.env`) controls which callsigns get admin access — adding a user here does **not** grant admin.
- Positions/teams are separate tables (`position`, `team`, `person_position`, `person_team`) — only add rows there if the user explicitly asks.
