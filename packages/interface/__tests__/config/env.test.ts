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

import { type ApiBaseUrlInputs, resolveApiBaseUrl } from "@/config/env";

// EXPO_PUBLIC_API_URL precedence (plan 09l F13).

const base: ApiBaseUrlInputs = {
  envUrl: undefined,
  platform: "ios",
  origin: undefined,
  hostUri: undefined,
  dev: false,
};

describe("resolveApiBaseUrl", () => {
  it("the explicit variable wins everywhere, trailing slash dropped", () => {
    expect(
      resolveApiBaseUrl({
        ...base,
        envUrl: "https://ims.example.org/",
        platform: "web",
        origin: "http://localhost:8081",
        hostUri: "10.0.0.2:8081",
        dev: true,
      }),
    ).toBe("https://ims.example.org");
  });

  it("web defaults to the page's origin", () => {
    expect(
      resolveApiBaseUrl({
        ...base,
        platform: "web",
        origin: "https://ims.example.org",
      }),
    ).toBe("https://ims.example.org");
  });

  it("a native dev build points at the docker stack on the Metro host", () => {
    expect(
      resolveApiBaseUrl({ ...base, dev: true, hostUri: "192.168.1.5:8081" }),
    ).toBe("http://192.168.1.5:8090");
  });

  it("a native production build without the variable fails loudly", () => {
    expect(() =>
      resolveApiBaseUrl({ ...base, hostUri: "192.168.1.5:8081" }),
    ).toThrow(/EXPO_PUBLIC_API_URL/);
    expect(() => resolveApiBaseUrl({ ...base, envUrl: "   " })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });
});
