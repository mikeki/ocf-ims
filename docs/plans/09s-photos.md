<!-- SPDX-License-Identifier: Apache-2.0 -->

# 09s — slice 3b.4: photos

> **Status:** **Built** — brief 2026-09-12; 3b.4a (server) merged the same day, 3b.4b
> (client) built 2026-09-12 on the brief's recommendations for the open questions below
> (no prototype round; the form carries a photo; the small modal kept). The phone hand
> check is owed.
> **Parent:** [09i-expo-client.md](09i-expo-client.md) (Phase 3, the 3b.4 row)
> under [09-proto-connect-platform.md](09-proto-connect-platform.md)
> **Follows:** [09r](09r-file-and-append.md) (3b.2 — file and append). A photo rides on a
> journal entry, so it goes wherever an entry can be written: the filing form and the
> incident's docked composer.
> **Owner:** Architect (this brief, the blob helper, the server fix, review) → Builder
> (Sonnet, the picker, the composer's attach control, the journal's thumbnails).
> **The skills:** Emil Kowalski's skills govern all UI work (the maintainer's rule,
> 2026-09-10) — `animate-expo` for anything that moves, `review-animations` before the PR
> is called done. Whether this slice gets a `prototype` round is open question 1.
> **Last updated:** 2026-09-12

## Objective

A person at the fair points their phone at the thing and the photo lands on the incident.
That is the whole slice: take or choose a photo, shrink it, upload it against the entry
routes that already exist, and show it in the journal. 09i §8 lists the deliverable:
camera / library via `expo-image-picker`, upload via `src/api/blobs.ts` with progress and
retry, preview via headers on native and a blob URL on web, `attach_files` gating.

Photos are the one thing in 3b that does not go over Connect. Attachments stay on the two
plain-HTTP routes (09i E7, M8), so this slice also lands the client's first authenticated
non-Connect call — which is why the blob helper is architect-tier and why the brief spends
most of its words on the wire.

## What is already true on the wire (verified, 2026-09-12)

| Question | Answer | Source |
|---|---|---|
| Upload | `POST /ims/api/events/{eventName}/incidents/{n}/attachments`, `multipart/form-data`, **one part named `imsAttachment`**. Answers `204` with the new entry's id in the `IMS-Journal-Entry-Number` header | `internal/incident/attachment.go` `attachToIncident`; `api/mux.go` |
| Who may upload | `EventWriteIncidents` — **and nothing else**: no 52f grant path, no privacy check (see shaping fact 1) | same |
| What the upload writes | One journal entry, text `File Name: <original>, Size: <human>, Type:<sniffed mime>`, `ATTACHED_FILE` = `event_%05d_incident_%05d_<random><ext>`, `ATTACHED_FILE_ORIGINAL_NAME`, `ATTACHED_FILE_MEDIA_TYPE`; then an SSE / stream poke | `addIncidentJournalEntry` |
| The name and type are the server's | The media type is **sniffed from the bytes** (`mimetype.DetectReader`), never taken from the part's header; the storage name gets the sniffed extension | `SniffFile` |
| Limits | Per file `IMS_MAX_ATTACHMENT_SIZE` (default **50 MiB**) → `413` with a human message; the whole-request cap is the outer backstop, also `413` | `checkAttachmentSize`; `.env.example` |
| Download | `GET …/incidents/{n}/attachments/{attachmentNumber}` where **`attachmentNumber` is the journal entry's id** — not anything on the `Attachment` message. `Content-Type` is the sniffed type downgraded to `application/octet-stream` unless on the safe list; `Content-Disposition: inline` for the safe list, `attachment` otherwise | `getIncidentAttachment`, `SafeToPreviewContentType`, `ContentDisposition` |
| Who may download | Event read, or a 52f grant; a **private** incident answers `404` unless admin / creator / grantee — the read rules, mirrored | same |
| Auth on both routes | `Authorization: Bearer <access token>` — the REST middleware reads the header, exactly as Connect does; no cookie needed | `internal/server/middleware.go` |
| CORS | The six blob routes carry the dev CORS adapter (3a.0), so the interim-mode export on `localhost:8082` can upload and download against staging like it calls Connect | `api/mux.go` |
| What the client sees on an entry | `JournalEntry.attachment: Attachment{id, previewable}` — **`id` is the original filename** (`json.Attachment.name` copied across), *not* the storage key the proto comment claims and *not* the number the download route wants. `previewable` is "the sniffed type is on the safe list" (images, PDF, plain text, MP4) — it does not say *which* | `connect.go` `journalEntryToProto`; `resources/v1/journal_entry.proto` |
| Whether attachments are on | `AccessForEvent.attach_files` = "the server has an attachments store" — global, not per person or event; staging runs the `local` store, so it is `true` there | `internal/auth/connect.go`; `deploy/.env.staging.example` |
| Event addressing | The blob routes take the **event name**, not the id the client holds; the events list the client already caches carries both | `rpc/v1/event.proto` |
| The templ client's shrink | Longest edge **1536 px**, JPEG at **0.85**, done in the browser before upload, upload as-is when it cannot decode; the server does not re-cap | `web/typescript/ims.ts` `downscaleImageForUpload` |

### The three facts that shape the slice

**1. The upload route is behind the Connect writes on privacy and grants — a server fix first.**
`UpdateIncident` (3b.2's append) lets a 52f grantee append a journal-only payload and answers
`404` on a private incident the caller may not view (`requireIncidentVisible`). The REST
upload does neither: it asks for `EventWriteIncidents` and then writes, without looking at
the incident. Two consequences. A grantee who can type an entry into the composer cannot
attach a photo to it (`403`) — a trap for the UI this slice builds, since `viewer_may_add_journal`
would show the control. And a writer who may not view a private incident can still add an
entry to it by number — the side door CLAUDE.md says every incident write must close. Both
are a server change, in the Architect's lane, small, provable in `api/integration`, and
needed by 3b.4b whichever way the open questions go. **It goes first as 3b.4a**, its own PR:
the upload route gets the same gate as `UpdateIncident` (write bit, or a grant — an upload
is journal-only by construction — then visibility), with tests for the grantee, the
non-grantee reporter and the private-incident writer. The report upload route is 3b.3's.

**2. The client cannot tell a photo from a PDF.** `Attachment{id, previewable}` says the
file is safe to preview, not what it is; the only hint is the extension on the original
filename, which a phone camera roll does not always carry and a user can rename. The row
has to decide whether to render an image or a "file" row *before* any bytes arrive, and on
native an image component fed a PDF fails silently. The server has the sniffed type on the
stored row (`ATTACHED_FILE_MEDIA_TYPE`, already used for `previewable`). **3b.4a adds
`Attachment.media_type` (field 3, the sanitised type)** — additive, pre-freeze, one line in
`journalEntryToProto` and one in `json.Attachment`. The client renders an image when it is
`image/*`, a file row otherwise. The proto comment on `id` is corrected in the same change:
it is the original filename; the entry's own `id` addresses the download.

**3. Progress needs `XMLHttpRequest`, on both platforms.** `fetch` reports nothing while a
body uploads, and a 3 MB photo over fair Wi-Fi is long enough to need a bar. React Native's
`XMLHttpRequest` fires `upload.onprogress` and takes a `FormData` part of the shape
`{uri, name, type}`; the browser's fires the same event over a `Blob`. One helper, one code
path, no `expo-file-system` upload API (whose legacy `uploadAsync` is the only variant with
progress, and native-only). The helper is the one place in the client that speaks HTTP
directly — the "three blob helpers" exception to 09i's no-hand-written-fetch rule.

## What 3b.4 builds

### 3b.4a — server (Architect; own PR, first)

- `attachToIncident`: gate = `EventWriteIncidents` **or** a 52f grant (`IncidentPersonHasGrant`),
  then `mayViewIncident` on the stored row — `403` without either bit, `404` when the incident
  is private and the caller is not admin / creator / grantee (the same order and codes as
  `UpdateIncident`). The `hasGrant` lookup happens once and feeds both checks.
- `Attachment.media_type` on the proto and the JSON view; `journalEntryToProto` copies it.
  The `id` comment corrected. `buf lint`, `buf breaking` clean (additive).
- `api/integration`: a granted reporter uploads and downloads; a plain reporter is `403`; a
  writer who is not creator / admin / grantee gets `404` on a private incident's upload;
  `media_type` round-trips on the read (`image/png` for a PNG, `application/octet-stream` for
  junk). The Go verification protocol in full.

### 3b.4b — client (Builder; Architect writes `src/api/blobs.ts` and reviews)

**The blob helper — `src/api/blobs.ts` (architect-tier).** Built by the runtime beside the
transport, from the same token cache and refresher, so it inherits the session contract
without re-deriving it:

- `uploadIncidentAttachment({eventName, number, file, onProgress, signal})` → `Promise<{entryId}>`.
  `file` is `{uri, name, type}` on native and a `Blob` + name on web. Bearer attached from
  the cache; a token expiring inside the proactive window refreshes first; a `401` refreshes
  once and replays (the interceptor's rule, 09l F4). `413` → `AppError{kind: "tooLarge"}`
  carrying the server's message; other statuses → the `toAppError` mapping by HTTP status.
  Progress is `loaded / total` from the upload event, clamped, monotone.
- `attachmentSource(eventName, number, entryId)` → native: `{uri, headers: {Authorization}}`
  for `expo-image` (refreshing first if the token is near expiry — the image component
  cannot retry a 401); web: `useAttachmentUrl(...)`, a hook that fetches with the Bearer
  and hands back an object URL, revoked on unmount. Web keeps the blob route same-origin
  in production, so no cookie is involved either way.
- Nothing else in the client may build a URL to `/ims/api/`.

**Choosing a photo — `src/features/compose/photo.ts` + `PhotoPicker`.** `expo-image-picker`
(SDK 57.0.x) with `mediaTypes: ["images"]`, `quality: 1` (we shrink ourselves), `exif: false`,
`allowsEditing: false`. Two actions on native — *Take photo* (`launchCameraAsync`) and *Choose
from library* — offered from the attach control; web offers only the library (the browser's
file input, which the tracer drives). Permissions are asked **at the tap**, never on launch
(09i 3b.5's rule applies here too); a denial renders an inline note with *Open settings*
(`Linking.openSettings`) and no dialog. The picker is behind an injectable seam so the
composer's tests supply a fake asset and never touch the native module.

**Shrinking — `shrinkForUpload(asset)`.** `expo-image-manipulator` on both platforms:
resize so the longest edge is **1536 px** (the templ number; a fair photo is evidence,
not art), save as JPEG at **0.85**, skip when already within bounds, upload the original
when the manipulation throws. Runs before the progress bar appears; a 12 MP HEIC becomes
roughly 300 KB. `fileName` for the part is the asset's or `photo.jpg`.

**Where the control lives.**

- *The incident's docked composer* (`AppendComposer`): a camera glyph at the left of the
  Send row, shown when `attachFiles && viewerMayAddJournal`. A chosen photo appears as a
  **thumbnail chip** above the box (64 pt, `radii.md`, an ✕ to drop it); Send posts the text
  entry first (if any), then uploads the photo, with a determinate bar across the chip's
  foot; the chip clears on success. A failed upload keeps the chip and shows *Retry* on it
  — the text entry, already posted, is not resent. One photo per send in 3b.4.
- *The filing form* (`NewIncidentScreen`): the same control on the *First entry* section,
  when `attachFiles && writeIncidents`. **File** creates the incident, then uploads the
  photo to the new number before leaving the screen (the templ "creates the incident
  first" rule, 09i §8), the docked button reading *Uploading photo…*. If the upload fails the
  incident is already filed: the form says so (*Incident #N is filed; the photo did not
  upload*) and offers *Retry* and *Continue without it* — Continue opens the incident.
  Photos are **not drafted** (a cache URI does not survive on native and a data URI does
  not belong in AsyncStorage); a pending photo is component state.

**Showing it — `JournalEntryRow`.** An entry whose `attachment.media_type` is `image/*`
renders the image under its text at a fixed 180 pt height, `contentFit: "cover"`,
`radii.md`, with a `textMuted` surface behind it while loading (`expo-image`; `placeholder`
unset — no blurhash exists). Any other attachment renders a file row: the name, the type
in caption, no tap (opening a PDF or video on a phone needs a download-and-share path that
is out of scope). A tap on an image opens `attachment/[entryId]` as a modal: the image at
full width on `background`, a *Close* in the header, no zoom. The entry's server text
(*File Name: …*) stays as the row's text.

**Cache.** After an upload: invalidate `getIncident` for the number and `listIncidents`
for the event (a new entry; `last_modified` moved). No optimistic entry — the server's text
and the id are its own, and the bar already tells the user what is happening.

**Motion.** Nothing new enters the budget. The chip and the bar appear without an
animation; the bar's fill is an absolutely positioned childless view whose width follows
progress events with no transition (the events are frequent enough). Press feedback on
the glyph, the chip's ✕ and the modal's Close, as everywhere.

**Privacy.** A `404` from the blob routes renders as *Not found*, never *private*; the
client never fetches an attachment for an entry it did not receive on `GetIncident`.

**Tests.** `blobs.test.ts` over a fake `XMLHttpRequest` (Bearer present; progress
sequence; 401 → refresh → replay once; 413 → tooLarge; abort). Composer tests with the
injected picker: chip appears, ✕ drops it, Send posts text then uploads (order asserted on
the fake), failure keeps the chip, control absent without `attachFiles` or without
`viewerMayAddJournal`. Form tests: file then upload, upload failure keeps the screen with
both offers. Row tests: image vs file row by `media_type`. The fake IMS grows nothing —
the blob helper is faked at its seam.

**The tracer** grows: on the incident, attach a generated PNG through the file chooser,
Send, assert the image renders in the journal (an `img` whose `src` is a blob URL); interim
mode against staging.

**Config.** `app.json` gains the `expo-image-picker` plugin with the two permission
strings (*"Allow OCF IMS to use the camera to photograph an incident"* / *"…to choose a photo
from your library"*); `expo-image-picker`, `expo-image-manipulator`, `expo-image` installed
via `expo install` so the versions match SDK 57. The web export needs nothing.

## Acceptance criteria

1. A writer takes or chooses a photo from the incident's composer; it uploads with a bar
   and appears in the journal as an image within one refetch.
2. A granted reporter can do the same (3b.4a); a plain reporter never sees the control.
3. The filing form can carry a photo; a failed upload after filing leaves the user on the
   form with the incident number and two ways out.
4. A photo over the cap is refused with the server's message, the chip kept.
5. Every upload is a JPEG at most 1536 px on its longest edge unless the source was
   smaller or undecodable.
6. A non-image attachment renders as a file row and never as a broken image.
7. Without `attach_files` no attach control renders anywhere; without a session no blob
   route is ever called.
8. `src/api/*`, `src/session/*`, `src/lib/permissions.ts` unchanged except the new
   `blobs.ts` and the runtime line that builds it (architect edits).
9. The 09i §9 list passes; `/review-animations` says Approve.

## Out of scope

- **Reports' attachments.** 3b.3, with the report upload route's own gate.
- **Videos, PDFs, multiple photos per entry, zoom, download-and-share.** The journal shows
  a file row for them; the web app opens them.
- **Editing or striking an entry**, removing an attachment — there is no delete route.
- **Offline queueing of an upload.** The chip survives a failure, not a restart.

## Verification

3b.4a, from `go/`: the full protocol — `go build ./...`, `go vet ./...`, `gofmt -l`,
`go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 run`, `go test ./...`,
`go test ./api/integration`, `go tool buf lint ../proto`, `go tool buf breaking ../proto
--against '.git#branch=master,subdir=proto'`, `go mod tidy` (no diff).

3b.4b, from the repo root, the 09i §9 list:

```bash
pnpm generate
pnpm -F @ocf-ims/interface typecheck
pnpm lint
pnpm -F @ocf-ims/interface test
EXPO_PUBLIC_API_URL=https://<staging host> pnpm -F @ocf-ims/interface export:web --clear
E2E_EMAIL=<seed email> E2E_PASSWORD=<seed password> pnpm -F @ocf-ims/interface e2e
```

## Checklist

- [x] 3b.4a: upload gate mirrors `UpdateIncident` (grant path; privacy `404`); tests
- [x] 3b.4a: `Attachment.media_type`; the `id` comment corrected; `buf breaking` clean
- [x] `src/api/blobs.ts` + runtime wiring; `blobs.test.ts`
- [x] Picker seam, shrink, permissions at the tap
- [x] Composer control, chip, bar, retry; form control with file-then-upload
- [x] Journal image / file row; the full-width modal
- [x] `app.json` plugin + permission strings; packages via `expo install`
- [x] Tracer step; interim mode green against staging
- [ ] `/review-animations` Approve
- [ ] A hand check on a real phone: camera, library, a denied permission, a 4G upload

## Open questions

1. **Does this slice get a `prototype` round?** The Architect's recommendation is **no**:
   the shape is fixed by convention (a camera glyph on the composer row, a thumbnail chip
   before send, the image inline in the log — what every messaging app does) and a round
   would be three tints of that. The maintainer can call one on the chip and the journal
   row if the description above reads wrong.
2. **Should the filing form carry a photo at all in 3b.4?** The brief says yes, with the
   file-then-upload rule and the two-way-out failure state. The cheaper cut is the composer
   only — the filed incident replaces the form, and the composer is one tap away.
3. **Full-screen view: keep or cut?** A modal with no zoom is small; the case for cutting
   it is that 3c's incident editor will want a real viewer (zoom, video, PDF) and this one
   would be thrown away.
