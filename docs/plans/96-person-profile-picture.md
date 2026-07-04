# 96 — Person profile picture (feedback round 10, slice 10d)

## Context

Feedback item 6: **"Have a profile picture for each person, and show it in the profile
card."**

The profile card already exists (shipped in round 9, PR B): a read-only modal showing a
person's fair name, legal name, role, wristband, and (admin-only) email/phone. This
slice adds an optional **profile picture** stored via the existing attachments backend
and displayed at the top of that card.

**Decision (locked):** upload/change is gated to **whoever can already edit the person**
— admins (`GlobalAdministratePersonnel`) and inviters (`EventInviteReporters`, for
people they manage) — matching who edits the rest of the profile today. Not
self-service.

### Current state (verified, file:line)

- **Attachments backend** — no dedicated table or interface; a `switch` on
  `conf.AttachmentsStore.Type` (local `os.Root` / S3), config `conf/imsconfig.go:311-327`,
  validation `:111-127`. Two helpers do all I/O: `saveFile()` `api/attachment.go:415-440`
  (Local `Dir.Create`+`io.Copy` / S3 `UploadToS3`), `retrieveFile()`
  `api/attachment.go:226-254` (Local `Dir.Open` / S3 `mustGetS3File`). S3 client
  `lib/attachment/s3.go`.
- **Incident attach pattern to mirror** — upload `AttachToIncident.attachToIncident`
  `api/attachment.go:352-413`: gate `EventWriteIncidents` (`:357`),
  `req.FormFile(IMSAttachmentFormKey)` (`IMSAttachmentFormKey="imsAttachment"`, `:48`),
  sniff bytes with `mimetype` (`sniffFile` `:675-686`), generate a name
  `event_%05d_incident_%05d_<rand>.<ext>` (`:383`), `saveFile` (`:396`). Download
  `GetIncidentAttachment.getIncidentAttachment` `:108-164`: gate read, `retrieveFile`,
  re-sniff, `safeToPreviewContentType` whitelist (`:187-205`; image types already
  allowed: gif/heic/jpeg/png/tiff/webp `:166-177`; SVG deliberately excluded),
  `contentDisposition` inline/attachment (`:219-224`), serve via `http.ServeContent`.
  Routes `api/mux.go:188-200`.
- **Request size** — single global `MaxRequestBytes` (default **100 MiB**,
  `conf/imsconfig.go:55`), enforced by `LimitRequestBytes` on every route
  (`api/mux.go:717-721`); over-size → `herr.RequestEntityTooLarge`
  (`api/attachment.go:370-373`). No per-attachment override.
- **PERSON schema** — `store/schema/migrations/00001_baseline.sql:69-90`; latest person
  column add is `00016_add_phone_to_person.sql` (pattern: `alter table PERSON add
  column PHONE varchar(32);`). **No image/photo/avatar column anywhere.** Latest
  migration overall is `00017`.
- **Profile card (already built)** — `web/template/personprofile.templ:27-65`
  (`PersonProfileModal`, `<dl id="person_profile_fields">` with rows
  `person_profile_fair_name`/`_legal_name`/`_role`/`_wristband`/`_email`/`_phone`;
  email/phone start hidden). Mounted `incident.templ:35`; person label clickable
  `incident.templ:184`. Populate `openPersonProfileModal(personId, eventName)`
  `web/typescript/ims.ts:1346-1405` — fetches `GET /ims/api/personnel?person_id=&event=`,
  `setRow()` hides empty rows. Backing handler `personnelByID` `api/personnel.go:201+`
  (dispatch `:77`), email/phone gated on `GlobalAdministratePersonnel` (`:222-226`).
- **People edit form** — `web/template/people.templ` (`#addPersonModal` `:63`; fields
  `add_person_handle`/`_name`/`_email`/`_phone` `:99-116`) + `web/typescript/people.ts`
  (validation, access toggle). Create/edit API `POST /ims/api/personnel` and
  `POST /ims/api/personnel/{personId}` (`api/mux.go:491,501`).
- **No image processing** — no thumbnail/resize/`image.Decode`/gravatar anywhere; only
  the content-type sniff + safe-preview whitelist. Serving is generic `http.ServeContent`.

> **Note:** the round-9 `Handle→FairName`/`Name→LegalName` rename (plan 91 PR 0) may or
> may not have landed when this is built. The card was built on pre-rename keys
> (`handle`/`name`). Match whatever is current at build time.

## Plan — one PR (optionally split upload vs display)

1. **Migration `000NN_add_profile_picture_to_person`** (pinned goose scaffold, mirror
   `00016`): add a nullable filename column, e.g.
   `alter table PERSON add column PROFILE_PICTURE varchar(255);` (stores the generated
   file name, exactly like journal-entry `ATTACHED_FILE` — the DB holds the name, the
   bytes live in the attachments backend). Down: `drop column PROFILE_PICTURE;`. Bump
   `store/integration/migrate_test.go`; regen sqlc. Update `CreatePerson`/person-update
   queries and any `PersonByID` select to include the new column.
2. **Upload endpoint** `POST /ims/api/personnel/{personId}/picture` in `api/person.go`
   (or a new `api/personpicture.go`), mirroring `AttachToIncident`:
   - **Gate on person-edit rights**, not incident write: allow when the caller has
     `GlobalAdministratePersonnel` **or** is an inviter for an event the target
     participates in (reuse the `eventForInvite`/`EventInviteReporters` check from the
     invite path, `api/person.go:283-297`). Match the exact gate used by the
     person-edit endpoints so upload rights == edit rights.
   - `req.FormFile("imsAttachment")` (reuse the constant), `sniffFile`, **reject
     non-image types** (restrict to the image subset of the safe-preview list:
     gif/heic/jpeg/png/tiff/webp — `api/attachment.go:166-177`), generate a name
     `person_%05d_<rand>.<ext>`, `saveFile` (`api/attachment.go:415`). On success, write
     the filename to `PERSON.PROFILE_PICTURE` (delete/ignore any prior file — optional
     cleanup). **`LogRequest(true, …)`** (mutating) in `api/mux.go`.
   - Register the route next to the other `/ims/api/personnel/{personId}/…` routes
     (`api/mux.go:501-531`).
3. **Serve endpoint** `GET /ims/api/personnel/{personId}/picture` mirroring
   `GetIncidentAttachment`: look up `PROFILE_PICTURE`, `retrieveFile`, re-sniff, force a
   safe **image** content-type (reuse `safeToPreviewContentType` but reject non-image),
   `http.ServeContent`. Read-only → `LogRequest(false, …)`. **Visibility:** a profile
   picture is not PII in the way email/phone are; gate it the same as the profile card's
   base fields (any viewer who can already open the card), **not** behind
   `GlobalAdministratePersonnel`. Confirm with the user if pictures should be
   admin-only.
4. **JSON** — surface a picture URL/flag in the person payload returned by
   `personnelByID` (`api/personnel.go:216-226`) and `json/personnel.go`, e.g.
   `ProfilePictureURL *string json:"profile_picture_url,omitempty"` pointing at the
   serve endpoint (omit when the person has no picture). Keep it outside the
   email/phone admin gate.
5. **Profile card UI** — add an `<img>` (or a `<dd>` row) at the top of
   `PersonProfileModal` (`web/template/personprofile.templ:27-65`) with a sensible
   CSS-sized avatar (no server-side thumbnailing exists; size with CSS,
   `max-width/height`, `object-fit: cover`). Populate it in `openPersonProfileModal`
   (`web/typescript/ims.ts:1346-1405`): set `img.src` to `profile_picture_url` and hide
   the element when absent (reuse the `setRow` hide-when-empty idiom).
6. **People edit form** — add a file input + preview to `#addPersonModal`
   (`web/template/people.templ`) and wiring in `web/typescript/people.ts` that POSTs the
   multipart form to the upload endpoint (separate from the JSON person save, like the
   incident attachment upload is separate from incident edit). Show current picture with
   a "Change"/"Remove" affordance; "Remove" clears `PROFILE_PICTURE` (a small
   `DELETE`/`?action=remove` on the picture route — mutating, logged).

**Verify:** `go run bin/build/build.go`; `go test ./... ./store/integration ./api/integration`
(migration adds the column; upload as an admin succeeds and as an unrelated non-admin is
403; non-image upload rejected; serve returns the image with a safe content-type).
`npx eslint`. Manual: as an editor, upload a JPEG for a person from the People form →
appears on their profile card; a viewer without edit rights sees the picture but no
upload control; remove it → card falls back to no image.

## Notes / decisions to confirm

- **Picture visibility:** planned **visible to anyone who can open the profile card**
  (not admin-gated). Confirm — if OCF wants pictures admin-only, gate the serve endpoint
  and the JSON field on `GlobalAdministratePersonnel` like email/phone.
- **No thumbnailing today.** Bytes are served as uploaded, sized by CSS. If large
  uploads become a problem (100 MiB global limit), add a tighter per-picture size check
  in the upload handler and/or a resize step (new dependency) — out of scope for v1.
- **Storage cleanup:** replacing/removing a picture should best-effort delete the old
  file from the backend; acceptable to defer (orphaned files are harmless) — note the
  choice in the PR.
- **SVG stays excluded** (XSS) — consistent with the existing safe-preview whitelist.
</content>
