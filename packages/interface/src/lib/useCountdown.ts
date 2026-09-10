// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

// A one-second countdown from `seconds` (plan 09n T9): the login screen's
// throttle indicator (Retry-After). `undefined` means "not counting", and
// answers 0. The countdown restarts whenever `seconds` OR `restartKey`
// changes — the login screen passes the AppError itself as the key, so a
// second throttled answer with the same Retry-After (a new error object, the
// same number) still starts a fresh countdown.

export function useCountdown(
  seconds: number | undefined,
  restartKey?: unknown,
): number {
  const [remaining, setRemaining] = useState(seconds ?? 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restartKey is in the list only to restart the countdown; the effect has no use for its value.
  useEffect(() => {
    setRemaining(seconds ?? 0);
    if (seconds === undefined || seconds <= 0) {
      return undefined;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [seconds, restartKey]);

  return remaining;
}
