// SPDX-License-Identifier: Apache-2.0

import type { Blobs, UploadArgs } from "@/api/blobs";
import { httpStatusError } from "@/api/errors";

// A programmable Blobs for screen tests (plan 09s): records uploads, plays a
// progress sequence, and can be flipped into the two failure modes a screen
// renders differently. The real helper is tested over a fake XMLHttpRequest.

export type UploadBehaviour = "ok" | "tooLarge" | "unavailable";

export interface FakeBlobs extends Blobs {
  uploads: UploadArgs[];
  behaviour: { upload: UploadBehaviour };
  /** The entry id the next successful upload answers with. */
  nextEntryId: number;
  /** Bytes handed back by fetchAttachment. */
  bytes: Blob;
}

export function createFakeBlobs(): FakeBlobs {
  const fake: FakeBlobs = {
    uploads: [],
    behaviour: { upload: "ok" },
    nextEntryId: 900,
    bytes: new Blob(["png"], { type: "image/png" }),
    async uploadIncidentAttachment(args) {
      fake.uploads.push(args);
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
    },
    attachmentUrl: (eventName, number, entryId) =>
      `https://fake/ims/api/events/${eventName}/incidents/${number}/attachments/${entryId}`,
    authHeaders: async () => ({ Authorization: "Bearer fake" }),
    fetchAttachment: async () => fake.bytes,
  };
  return fake;
}
