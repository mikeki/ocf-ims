// SPDX-License-Identifier: Apache-2.0

import { httpStatusError } from "@/api/errors";
import type { Refresher } from "@/api/refresh";
import type { AccessTokenCache } from "@/api/tokens";
import { PROACTIVE_REFRESH_WINDOW_MS } from "@/api/transport";

// The blob helper (plan 09s): the client's one authenticated non-Connect
// path — the two plain-HTTP attachment routes. Built beside the transport
// from the same token cache and refresher, so it inherits the session
// contract: the Bearer from the cache, a proactive refresh inside the window,
// one refresh-and-replay on a 401. Upload goes over XMLHttpRequest for its
// progress events (fetch reports nothing while a body uploads). Nothing else
// in the client may build a URL under /ims/api/.

/** A file to upload: `{uri, name, type}` on native, a Blob + name on web. */
export type UploadFile =
  | { readonly uri: string; readonly name: string; readonly type: string }
  | { readonly blob: Blob; readonly name: string };

export interface UploadArgs {
  eventName: string;
  number: number;
  file: UploadFile;
  /** 0..1, monotone. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface Blobs {
  uploadIncidentAttachment(args: UploadArgs): Promise<{ entryId: number }>;
  /** The download URL for an entry's file (an address, never fetched without the headers below). */
  attachmentUrl(eventName: string, number: number, entryId: number): string;
  /** The Authorization header for a download, after a proactive refresh if the token is close to expiry. */
  authHeaders(): Promise<Record<string, string>>;
  /** Web: the bytes, for an object URL — a browser image cannot carry a header. */
  fetchAttachment(
    eventName: string,
    number: number,
    entryId: number,
    signal?: AbortSignal,
  ): Promise<Blob>;
}

export interface BlobsDeps {
  baseUrl: string;
  tokens: AccessTokenCache;
  refresher: Refresher;
  /** Injected for tests: a fake XMLHttpRequest. */
  xhr?: () => XMLHttpRequest;
  fetch?: typeof globalThis.fetch;
  proactiveWindowMs?: number;
}

/** The part name the server reads. */
export const UPLOAD_PART = "imsAttachment";
/** The response header carrying the new journal entry's id. */
export const ENTRY_HEADER = "IMS-Journal-Entry-Number";

export function createBlobs(deps: BlobsDeps): Blobs {
  const window = deps.proactiveWindowMs ?? PROACTIVE_REFRESH_WINDOW_MS;
  const makeXhr = deps.xhr ?? (() => new XMLHttpRequest());
  const fetchImpl =
    deps.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const bearer = (): string | undefined => {
    const current = deps.tokens.get();
    return current ? `Bearer ${current.token}` : undefined;
  };

  const prepare = async (): Promise<string | undefined> => {
    if (deps.tokens.expiringWithin(window)) {
      await deps.refresher.refresh();
    }
    return bearer();
  };

  const incidentRoute = (eventName: string, number: number): string =>
    `${deps.baseUrl}/ims/api/events/${encodeURIComponent(eventName)}/incidents/${number}/attachments`;

  const send = (
    url: string,
    args: UploadArgs,
    auth: string | undefined,
  ): Promise<{ status: number; text: string; entry: string | null }> =>
    new Promise((resolve, reject) => {
      const xhr = makeXhr();
      let last = 0;
      xhr.open("POST", url);
      if (auth) {
        xhr.setRequestHeader("Authorization", auth);
      }
      xhr.upload.onprogress = (event) => {
        if (!args.onProgress || !event.lengthComputable || event.total <= 0) {
          return;
        }
        const fraction = Math.min(
          1,
          Math.max(last, event.loaded / event.total),
        );
        last = fraction;
        args.onProgress(fraction);
      };
      xhr.onload = () => {
        resolve({
          status: xhr.status,
          text: xhr.responseText ?? "",
          entry: xhr.getResponseHeader(ENTRY_HEADER),
        });
      };
      xhr.onerror = () => resolve({ status: 0, text: "", entry: null });
      xhr.onabort = () => reject(httpStatusError(0, "Upload cancelled"));
      if (args.signal) {
        if (args.signal.aborted) {
          xhr.abort();
          return;
        }
        args.signal.addEventListener("abort", () => xhr.abort(), {
          once: true,
        });
      }
      const form = new FormData();
      if ("blob" in args.file) {
        form.append(UPLOAD_PART, args.file.blob, args.file.name);
      } else {
        // React Native's FormData takes a file descriptor object.
        form.append(UPLOAD_PART, args.file as unknown as Blob);
      }
      xhr.send(form);
    });

  return {
    async uploadIncidentAttachment(args) {
      const url = incidentRoute(args.eventName, args.number);
      let auth = await prepare();
      let res = await send(url, args, auth);
      if (res.status === 401) {
        const outcome = await deps.refresher.refresh();
        if (outcome.kind === "refreshed") {
          auth = bearer();
          res = await send(url, args, auth);
        }
      }
      if (res.status === 204 || res.status === 200) {
        const entryId = Number.parseInt(res.entry ?? "", 10);
        if (!Number.isFinite(entryId)) {
          throw httpStatusError(
            500,
            "The server did not say which entry it made",
          );
        }
        args.onProgress?.(1);
        return { entryId };
      }
      throw httpStatusError(res.status, res.text.trim());
    },
    attachmentUrl(eventName, number, entryId) {
      return `${incidentRoute(eventName, number)}/${entryId}`;
    },
    async authHeaders(): Promise<Record<string, string>> {
      const auth = await prepare();
      const headers: Record<string, string> = {};
      if (auth) {
        headers.Authorization = auth;
      }
      return headers;
    },
    async fetchAttachment(eventName, number, entryId, signal) {
      const url = `${incidentRoute(eventName, number)}/${entryId}`;
      const get = async (auth: string | undefined) =>
        fetchImpl(url, {
          headers: auth ? { Authorization: auth } : {},
          signal,
        });
      let res: Response;
      try {
        res = await get(await prepare());
        if (res.status === 401) {
          const outcome = await deps.refresher.refresh();
          if (outcome.kind === "refreshed") {
            res = await get(bearer());
          }
        }
      } catch (e) {
        if (signal?.aborted) {
          throw httpStatusError(0, "Cancelled");
        }
        throw httpStatusError(0, e instanceof Error ? e.message : String(e));
      }
      if (!res.ok) {
        throw httpStatusError(res.status, (await res.text()).trim());
      }
      return res.blob();
    },
  };
}
