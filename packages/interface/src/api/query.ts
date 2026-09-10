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

import { QueryClient } from "@tanstack/react-query";
import { toAppError } from "@/api/errors";

// The TanStack Query client with the app's defaults (plan 09l F10). Screens get
// it from the provider; the session layer clears it on sign-out.

/** How long a read is fresh before a mount refetches it. */
export const QUERY_STALE_MS = 30_000;
/** How long an unused read stays in memory — at least the persister's maxAge, or a restored entry is dropped at once. */
export const QUERY_GC_MS = 24 * 60 * 60 * 1000;
/** Automatic retries for a retryable failure (Unavailable / network), before the error reaches the screen. */
export const QUERY_MAX_RETRIES = 2;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_MS,
        gcTime: QUERY_GC_MS,
        retry: (failureCount, error) =>
          failureCount < QUERY_MAX_RETRIES && toAppError(error).retryable,
      },
      mutations: {
        // A write is never replayed automatically (09i §3: no write queue).
        retry: 0,
      },
    },
  });
}
