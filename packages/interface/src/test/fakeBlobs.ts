// SPDX-License-Identifier: Apache-2.0

import type { AttachmentOwner, Blobs, UploadArgs } from "@/api/blobs";
import { httpStatusError } from "@/api/errors";

// A programmable Blobs for screen tests (plan 09s): records uploads, plays a
// progress sequence, and can be flipped into the two failure modes a screen
// renders differently. The real helper is tested over a fake XMLHttpRequest.
// Uploads and fetches record which owner they addressed (`kind`), so a screen
// spec on either platform can assert a report's photo never took the incident
// route.

export type UploadBehaviour = "ok" | "tooLarge" | "unavailable";

export interface FakeBlobs extends Blobs {
  uploads: (UploadArgs & { kind: AttachmentOwner["kind"] })[];
  /** Every fetchAttachment call (the web path), by owner. */
  fetches: { eventName: string; on: AttachmentOwner; entryId: number }[];
  behaviour: { upload: UploadBehaviour };
  /** The entry id the next successful upload answers with. */
  nextEntryId: number;
  /** Bytes handed back by fetchAttachment. */
  bytes: Blob;
}

export function createFakeBlobs(): FakeBlobs {
  const fake: FakeBlobs = {
    uploads: [],
    fetches: [],
    behaviour: { upload: "ok" },
    nextEntryId: 900,
    bytes: new Blob(["png"], { type: "image/png" }),
    uploadIncidentAttachment: (args) => upload("incident", args),
    uploadReportAttachment: (args) => upload("report", args),
    attachmentUrl: (eventName, on, entryId) =>
      `https://fake/ims/api/events/${eventName}/${on.kind === "report" ? "reports" : "incidents"}/${on.number}/attachments/${entryId}`,
    authHeaders: async () => ({ Authorization: "Bearer fake" }),
    fetchAttachment: async (eventName, on, entryId) => {
      fake.fetches.push({ eventName, on, entryId });
      return fake.bytes;
    },
  };
  const upload = async (kind: AttachmentOwner["kind"], args: UploadArgs) => {
    fake.uploads.push({ ...args, kind });
    args.onProgress?.(0.5);
    if (fake.behaviour.upload === "tooLarge") {
      throw httpStatusError(413, "attachment exceeds the 50 MiB limit");
    }
    if (fake.behaviour.upload === "unavailable") {
      throw httpStatusError(0, "no network");
    }
    args.onProgress?.(1);
    fake.nextEntryId += 1;
    return { entryId: fake.nextEntryId };
  };
  return fake;
}
