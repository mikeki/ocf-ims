// SPDX-License-Identifier: Apache-2.0

import { createBlobs, ENTRY_HEADER, UPLOAD_PART } from "@/api/blobs";
import { toAppError } from "@/api/errors";
import { PROACTIVE_REFRESH_WINDOW_MS } from "@/api/transport";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The blob helper (plan 09s) over a fake XMLHttpRequest, with the real token
// cache and refresher from the runtime — so the session contract is the
// interceptor's: Bearer from the cache, a proactive refresh in the window,
// one refresh-and-replay on a 401, 413 as tooLarge.

interface Scripted {
  status: number;
  body?: string;
  entry?: string;
  progress?: [number, number][];
  networkError?: boolean;
}

class FakeXhr {
  static script: Scripted[] = [];
  static sent: {
    url: string;
    headers: Record<string, string>;
    partName: string | undefined;
    fileName: string | undefined;
  }[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  private url = "";
  private headers: Record<string, string> = {};
  private response: Scripted = { status: 0 };

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return name === ENTRY_HEADER ? (this.response.entry ?? null) : null;
  }
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    this.response = FakeXhr.script.shift() ?? { status: 500 };
    const part = body.get(UPLOAD_PART);
    FakeXhr.sent.push({
      url: this.url,
      headers: this.headers,
      partName: part ? UPLOAD_PART : undefined,
      fileName: part instanceof File ? part.name : undefined,
    });
    for (const [loaded, total] of this.response.progress ?? []) {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded,
        total,
      } as ProgressEvent);
    }
    if (this.response.networkError) {
      this.onerror?.();
      return;
    }
    this.status = this.response.status;
    this.responseText = this.response.body ?? "";
    this.onload?.();
  }
}

const ACCESS_TTL_MS = 15 * 60 * 1000;

function setup() {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const fake = createFakeIms({ clock, accessTtlMs: ACCESS_TTL_MS });
  const store = createMemoryRefreshTokenStore();
  const runtime = createTestRuntime({ fake, store, platform: "native", clock });
  FakeXhr.script = [];
  FakeXhr.sent = [];
  const blobs = createBlobs({
    baseUrl: "https://ims.test",
    tokens: runtime.tokens,
    refresher: runtime.refresher,
    xhr: () => new FakeXhr() as unknown as XMLHttpRequest,
  });
  return {
    fake,
    runtime,
    blobs,
    advance: (ms: number) => {
      now += ms;
    },
    signIn: () => runtime.session.signIn(fake.user.email, fake.user.password),
  };
}

const file = { blob: new Blob(["png"], { type: "image/png" }), name: "a.png" };

describe("blobs.uploadIncidentAttachment", () => {
  it("posts the part with the Bearer to the event-name route and returns the entry id", async () => {
    const t = setup();
    await t.signIn();
    FakeXhr.script = [
      {
        status: 204,
        entry: "57",
        progress: [
          [1, 4],
          [2, 4],
          [4, 4],
        ],
      },
    ];
    const seen: number[] = [];
    const res = await t.blobs.uploadIncidentAttachment({
      eventName: "Fair 2026",
      number: 214,
      file,
      onProgress: (f) => seen.push(f),
    });
    expect(res).toEqual({ entryId: 57 });
    expect(FakeXhr.sent[0]?.url).toBe(
      "https://ims.test/ims/api/events/Fair%202026/incidents/214/attachments",
    );
    expect(FakeXhr.sent[0]?.headers.Authorization).toBe(
      `Bearer ${t.runtime.tokens.get()?.token}`,
    );
    expect(FakeXhr.sent[0]?.partName).toBe(UPLOAD_PART);
    expect(FakeXhr.sent[0]?.fileName).toBe("a.png");
    expect(seen).toEqual([0.25, 0.5, 1, 1]);
  });

  it("refreshes first when the token is inside the proactive window", async () => {
    const t = setup();
    await t.signIn();
    const before = t.runtime.tokens.get()?.token;
    t.advance(ACCESS_TTL_MS - PROACTIVE_REFRESH_WINDOW_MS + 1);
    FakeXhr.script = [{ status: 204, entry: "1" }];
    await t.blobs.uploadIncidentAttachment({ eventName: "e", number: 1, file });
    const after = t.runtime.tokens.get()?.token;
    expect(after).not.toBe(before);
    expect(FakeXhr.sent[0]?.headers.Authorization).toBe(`Bearer ${after}`);
  });

  it("on a 401, refreshes once and replays with the new token", async () => {
    const t = setup();
    await t.signIn();
    const stale = t.runtime.tokens.get()?.token;
    t.fake.expireAccessTokens();
    FakeXhr.script = [{ status: 401 }, { status: 204, entry: "2" }];
    const res = await t.blobs.uploadIncidentAttachment({
      eventName: "e",
      number: 1,
      file,
    });
    expect(res.entryId).toBe(2);
    expect(FakeXhr.sent).toHaveLength(2);
    expect(FakeXhr.sent[0]?.headers.Authorization).toBe(`Bearer ${stale}`);
    expect(FakeXhr.sent[1]?.headers.Authorization).toBe(
      `Bearer ${t.runtime.tokens.get()?.token}`,
    );
    expect(FakeXhr.sent[1]?.headers.Authorization).not.toBe(`Bearer ${stale}`);
  });

  it("does not replay when the refresh itself fails", async () => {
    const t = setup();
    await t.signIn();
    t.fake.behaviour.refresh = "unavailable";
    FakeXhr.script = [{ status: 401 }];
    await expect(
      t.blobs.uploadIncidentAttachment({ eventName: "e", number: 1, file }),
    ).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(FakeXhr.sent).toHaveLength(1);
  });

  it("maps 413 to tooLarge with the server's words, and a network failure to unavailable", async () => {
    const t = setup();
    await t.signIn();
    FakeXhr.script = [
      { status: 413, body: "attachment exceeds the 50 MiB limit\n" },
      { status: 0, networkError: true },
    ];
    const big = await t.blobs
      .uploadIncidentAttachment({ eventName: "e", number: 1, file })
      .catch((e) => toAppError(e));
    expect(big).toMatchObject({
      kind: "tooLarge",
      message: "attachment exceeds the 50 MiB limit",
    });
    const gone = await t.blobs
      .uploadIncidentAttachment({ eventName: "e", number: 1, file })
      .catch((e) => toAppError(e));
    expect(gone).toMatchObject({ kind: "unavailable", retryable: true });
  });

  it("builds the download address and its headers from the same cache", async () => {
    const t = setup();
    await t.signIn();
    expect(t.blobs.attachmentUrl("Fair 2026", 214, 57)).toBe(
      "https://ims.test/ims/api/events/Fair%202026/incidents/214/attachments/57",
    );
    expect(await t.blobs.authHeaders()).toEqual({
      Authorization: `Bearer ${t.runtime.tokens.get()?.token}`,
    });
  });
});
