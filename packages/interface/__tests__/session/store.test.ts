//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { base64Encode } from "@bufbuild/protobuf/wire";
import {
  createSecureRefreshTokenStore,
  MAX_REFRESH_TOKEN_BYTES,
  REFRESH_TOKEN_KEY,
  utf8ByteLength,
} from "@/session/secureStore";
import { createMemorySecureStore } from "@/test/storage";

// The native refresh-token store (plan 09l F9) and the SecureStore size
// assertion (09i E4 / §11).

/**
 * A refresh JWT shaped like the server's (authz.CreateRefreshToken): HS256,
 * the registered claims plus the token type and the person's handle, a
 * 32-byte signature — base64url throughout.
 */
function fixtureRefreshJwt(handle = "Dispatcher Dee"): string {
  const b64url = (s: string) =>
    base64Encode(new TextEncoder().encode(s), "url");
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: "ims",
      sub: "42",
      exp: 1_789_000_000,
      iat: 1_788_395_200,
      tok: "refresh",
      handle,
    }),
  );
  const signature = base64Encode(new Uint8Array(32).fill(7), "url");
  return `${header}.${payload}.${signature}`;
}

describe("the refresh token fits expo-secure-store", () => {
  it("a realistic HS256 refresh JWT is well under the 2 KB limit", () => {
    const token = fixtureRefreshJwt();
    const size = utf8ByteLength(token);
    expect(size).toBeLessThan(MAX_REFRESH_TOKEN_BYTES / 4);
    expect(size).toBeGreaterThan(100);
  });

  it("even with a long handle it stays under the limit", () => {
    const token = fixtureRefreshJwt("x".repeat(200));
    expect(utf8ByteLength(token)).toBeLessThan(MAX_REFRESH_TOKEN_BYTES);
  });

  it("counts UTF-8 bytes, not code units", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("createSecureRefreshTokenStore", () => {
  it("round-trips the token under its key", async () => {
    const secure = createMemorySecureStore();
    const store = createSecureRefreshTokenStore(secure);
    const token = fixtureRefreshJwt();

    await store.save(token);
    expect(secure.items.get(REFRESH_TOKEN_KEY)).toBe(token);
    await expect(store.load()).resolves.toBe(token);

    await store.clear();
    expect(secure.items.has(REFRESH_TOKEN_KEY)).toBe(false);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("refuses a value over the limit and an empty one", async () => {
    const secure = createMemorySecureStore();
    const store = createSecureRefreshTokenStore(secure);

    await expect(
      store.save("x".repeat(MAX_REFRESH_TOKEN_BYTES + 1)),
    ).rejects.toThrow(/over the 2048-byte/);
    await expect(store.save("")).rejects.toThrow(/empty/);
    expect(secure.items.size).toBe(0);

    await expect(
      store.save("x".repeat(MAX_REFRESH_TOKEN_BYTES)),
    ).resolves.toBeUndefined();
  });

  it("treats a missing or empty stored value as no token", async () => {
    const secure = createMemorySecureStore();
    const store = createSecureRefreshTokenStore(secure);
    await expect(store.load()).resolves.toBeUndefined();
    secure.items.set(REFRESH_TOKEN_KEY, "");
    await expect(store.load()).resolves.toBeUndefined();
  });
});
