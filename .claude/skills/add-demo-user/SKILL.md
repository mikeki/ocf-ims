---
name: add-demo-user
description: Add one or more demo users to the local people directory. Use when the user asks to add demo/test users, seed users, or login accounts for the dev/demo environment — they live in store/fakeimsdb/seed.sql (the IMS-DB PERSON table) and (if the dev stack is already running) need to be inserted into the live ims-db container as well.
---

# Add demo user(s) to the local people directory

Demo users for local dev live in the IMS-DB `PERSON` table, seeded from
`store/fakeimsdb/seed.sql`. This file is loaded into the `ims-db` MariaDB container
**only on first init** (via `/docker-entrypoint-initdb.d/`), so for an already-running
stack you must also apply the new rows to the live DB.

## 1. Pick handle, email, password, and id

- **Handle**: alphanumeric, no spaces (e.g. `Shell Bell` → `ShellBell`, `J-Rock` → `JRock`). Must be unique (`PERSON.HANDLE` is a unique key).
- **Email**: use a real address or `<handle>@example.com`.
- **Password**: any string — the seed traditionally uses the handle itself, but anything works.
- **id**: next free integer above the highest existing row. Persons currently start at 600; check `seed.sql` for the current max.

## 2. Generate the argon2id password hash

The server expects ClubhouseParams: `m=8192, t=4, p=1, saltLen=16, keyLen=32`.

**Preferred** — use the project's `ocf-ims` CLI. Build it once with
`go run bin/build/build.go` (the `cmd` package needs the code generators to have
run), then:
```bash
./ocf-ims hash_password --password='<the-password>'
```

**Fallback** — if `go` isn't available, use the `argon2` npm package with matching params:
```bash
mkdir -p /tmp/argon2-gen && cd /tmp/argon2-gen && npm install argon2 >/dev/null
node -e "const a=require('argon2');a.hash('<password>',{type:a.argon2id,version:0x13,memoryCost:8192,timeCost:4,parallelism:1,hashLength:32,saltLength:16}).then(console.log)"
```

Either produces a PHC string like `$argon2id$v=19$m=8192,t=4,p=1$<salt>$<hash>`.

## 3. Add the row to `store/fakeimsdb/seed.sql`

Append inside the existing `insert into PERSON (...) values` block. Columns are
`(ID, HANDLE, EMAIL, PASSWORD, STATUS, ON_SITE, CREATED)`. Keep alignment consistent.
Example:

```sql
(607, 'NewHandle', 'user@example.com', '$argon2id$v=19$m=8192,t=4,p=1$...', 'active', true, 0),
```

This makes the user appear on any **fresh** stack init.

## 4. If the dev stack is already running, also insert into the live DB

The seed only runs when `./.docker/mysql/data-ims/` is empty. To add to a running
stack without wiping data (credentials come from `docker-compose.dev.yml`:
`ims` / `ims` / db `ims`, unless `.env` overrides them):

```bash
docker exec -i ranger-ims-db mariadb -uims -pims ims <<'SQL'
insert into PERSON (ID, HANDLE, EMAIL, PASSWORD, STATUS, ON_SITE, CREATED) values
(607, 'NewHandle', 'user@example.com', '$argon2id$v=19$m=8192,t=4,p=1$...', 'active', true, 0);
SQL
```

Verify:
```bash
docker exec ranger-ims-db mariadb -uims -pims ims \
  -e "SELECT ID, HANDLE, EMAIL FROM PERSON ORDER BY ID;"
```

## 5. Wait for cache or restart the IMS server

The IMS server caches the user directory in-memory (default TTL **5 minutes**, see `conf/imsconfig.go` → `InMemoryCacheTTL`). New users become loginable either after the TTL elapses or immediately after:

```bash
docker restart ocf-ims
```

## Notes

- Only `active`-status persons are loaded by the directory (the `People` query filters on `STATUS = 'active'`), so seed new login users with `STATUS = 'active'`.
- Admin access is the `PERSON.IS_ADMIN` flag (default `false`) — a seeded user is **not** an admin unless you set `IS_ADMIN = true` on their row (or toggle it later from Admin → People & Passwords).
- Positions/teams are separate tables (`POSITION`, `TEAM`, `PERSON__POSITION`, `PERSON__TEAM`) — only add rows there if the user explicitly asks. Note `POSITION` is a reserved word and must be backticked in SQL.
