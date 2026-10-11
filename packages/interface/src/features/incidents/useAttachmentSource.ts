// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { Platform } from "react-native";
import type { AttachmentOwner } from "@/api/blobs";
import { useBlobs } from "@/api/providers";

// What an image component is given for an attachment (plan 09s): on native
// the route's URL plus the Authorization header (refreshed first when the
// token is near expiry — an image component cannot retry a 401); on web the
// bytes fetched with the Bearer and handed over as an object URL, revoked on
// unmount, since a browser image cannot carry a header. The owner (09z
// criterion 0) picks the route: an incident's entry through the incident
// route, a report's through the report route, whichever screen shows it.

export interface AttachmentSource {
  uri: string;
  headers?: Record<string, string>;
}

export function useAttachmentSource(
  eventName: string,
  on: AttachmentOwner,
  entryId: number,
): AttachmentSource | undefined {
  const { kind, number } = on;
  const blobs = useBlobs();
  const [source, setSource] = useState<AttachmentSource | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    const load = async () => {
      if (Platform.OS === "web") {
        const bytes = await blobs.fetchAttachment(
          eventName,
          { kind, number },
          entryId,
          controller.signal,
        );
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(bytes);
        setSource({ uri: objectUrl });
        return;
      }
      const headers = await blobs.authHeaders();
      if (!cancelled) {
        setSource({
          uri:
            kind === "report"
              ? blobs.reportAttachmentUrl(eventName, number, entryId)
              : blobs.attachmentUrl(eventName, number, entryId),
          headers,
        });
      }
    };
    // A failed fetch leaves the muted surface: a 404 renders as nothing, never "private".
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blobs, eventName, kind, number, entryId]);

  return source;
}
