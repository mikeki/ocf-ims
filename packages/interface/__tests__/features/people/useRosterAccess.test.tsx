// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useEventAccess } from "@/features/events/hooks";
import { useRosterAccess } from "@/features/people/roles";
import { renderRoster, signedIn } from "@/test/rosterLayout";

// One GetAuthStatus observer policy: the roster's access reader shares
// `useEventAccess`'s stale window instead of refetching on every mount.

let callsWhenSecondMounted = 0;

function Probe({ count }: { count: () => number }) {
  const events = useEventAccess(1);
  const [second, setSecond] = useState(false);
  useEffect(() => {
    if (events.inviteReporters) {
      callsWhenSecondMounted = count();
      setSecond(true);
    }
  }, [events.inviteReporters, count]);
  // The first observer stays mounted (the test client collects unobserved queries at once).
  return second ? <Roster /> : <Text>first</Text>;
}

function Roster() {
  const access = useRosterAccess(1);
  return <Text testID="roster-access">{String(access.inviteReporters)}</Text>;
}

describe("useRosterAccess", () => {
  it("does not refetch GetAuthStatus within the stale window", async () => {
    const { fake, runtime } = await signedIn({ inviteReporters: true });
    await renderRoster(
      runtime,
      <Probe count={() => fake.callsOf("GetAuthStatus").length} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("roster-access").props.children).toBe("true"),
    );
    // The mount of the second reader added no request to the first's.
    expect(fake.callsOf("GetAuthStatus")).toHaveLength(callsWhenSecondMounted);
  });
});
