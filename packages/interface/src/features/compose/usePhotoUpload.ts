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

export function usePhotoUpload(eventId: number, eventName: string) {
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
        await blobs.uploadIncidentAttachment({
          eventName,
          number,
          file,
          onProgress: (fraction) => setPending({ photo, progress: fraction }),
        });
      } catch (e) {
        const error = toAppError(e);
        setPending({ photo, error: error.message });
        return false;
      }
      setPending(undefined);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.getIncident,
            transport,
            input: { eventId, incidentNumber: number },
            cardinality: "finite",
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: ImsService.method.listIncidents,
            transport,
            cardinality: "finite",
          }),
        }),
      ]);
      return true;
    },
    [pending, picker, blobs, eventName, eventId, transport, queryClient],
  );

  return { pending, pick, clear, upload };
}
