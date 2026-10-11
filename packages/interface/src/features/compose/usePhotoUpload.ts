// SPDX-License-Identifier: Apache-2.0

import { createConnectQueryKey, useTransport } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toAppError } from "@/api/errors";
import { useBlobs } from "@/api/providers";
import type { PendingPhoto } from "@/features/compose/PhotoAttach";
import { type PickedPhoto, usePhotoPicker } from "@/features/compose/photo";

// The pending photo's state and its upload (plan 09s): one photo per send,
// held as component state (never drafted), uploaded after the text entry
// posts; a failure keeps the chip with the server's words and Retry. After an
// upload the incident and the list refetch — no optimistic entry.

export interface PhotoOwner {
  /** Whose attachment route the upload takes; incident by default. */
  kind: "incident" | "report";
}

export function usePhotoUpload(
  eventId: number,
  eventName: string,
  owner: PhotoOwner = { kind: "incident" },
) {
  const kind = owner.kind;
  const blobs = useBlobs();
  const picker = usePhotoPicker();
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingPhoto | undefined>(undefined);

  const pick = useCallback((photo: PickedPhoto) => {
    setPending({ photo });
  }, []);
  const clear = useCallback(() => setPending(undefined), []);

  /** Resolves true when the photo landed (or there was none); false keeps the chip with the error. */
  const upload = useCallback(
    async (number: number): Promise<boolean> => {
      if (!pending) {
        return true;
      }
      const photo = pending.photo;
      setPending({ photo, progress: 0 });
      try {
        const file = await picker.toUpload(photo);
        const args = {
          eventName,
          number,
          file,
          onProgress: (fraction: number) =>
            setPending({ photo, progress: fraction }),
        };
        if (kind === "report") {
          await blobs.uploadReportAttachment(args);
        } else {
          await blobs.uploadIncidentAttachment(args);
        }
      } catch (e) {
        const error = toAppError(e);
        setPending({ photo, error: error.message });
        return false;
      }
      setPending(undefined);
      const invalidations =
        kind === "report"
          ? [
              createConnectQueryKey({
                schema: ImsService.method.getReport,
                transport,
                input: { eventId, reportNumber: number },
                cardinality: "finite",
              }),
              createConnectQueryKey({
                schema: ImsService.method.listReports,
                transport,
                cardinality: "finite",
              }),
            ]
          : [
              createConnectQueryKey({
                schema: ImsService.method.getIncident,
                transport,
                input: { eventId, incidentNumber: number },
                cardinality: "finite",
              }),
              createConnectQueryKey({
                schema: ImsService.method.listIncidents,
                transport,
                cardinality: "finite",
              }),
            ];
      await Promise.all(
        invalidations.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      return true;
    },
    [pending, picker, blobs, eventName, eventId, kind, transport, queryClient],
  );

  return { pending, pick, clear, upload };
}
