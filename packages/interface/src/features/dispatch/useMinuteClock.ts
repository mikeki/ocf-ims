// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/**
 * A shared clock, ticking once a minute (plan 09x finding 7): `now` was
 * frozen at mount before this, so a long-lived tab's "days" filter never
 * narrowed and `useDispatchQuery` and `IncidentPage` disagreed on "now".
 * Both read this one hook instead. The interval is cleared on unmount.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}
