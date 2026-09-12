// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { BoardScreen } from "@/features/board/BoardScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { makeIncident, makeIncidentView } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The Board's filing bar (plan 09r): a writer's affordance, and what it hands
// the form.

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function boardFake(writeIncidents: boolean) {
  const fake = createFakeIms({ user: { writeIncidents } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.incidents = [
    makeIncidentView({
      incident: makeIncident({ eventId: 1, number: 1, summary: "One" }),
    }),
  ];
  return fake;
}

describe("QuickBar on the Board", () => {
  it("pulls up the form on a tap", async () => {
    const fake = boardFake(true);
    const runtime = await signedInRuntime(fake);
    const onFile = jest.fn();
    await renderWithProviders(
      <BoardScreen
        eventId={1}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
        onOpenReport={() => undefined}
        onFile={onFile}
      />,
      runtime,
    );
    await waitFor(() => expect(screen.getByTestId("quick-bar")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("quick-bar"));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("is absent for a caller without write access", async () => {
    const fake = boardFake(false);
    const runtime = await signedInRuntime(fake);
    await renderWithProviders(
      <BoardScreen
        eventId={1}
        onBack={() => undefined}
        onOpenIncident={() => undefined}
        onOpenReport={() => undefined}
        onFile={() => undefined}
      />,
      runtime,
    );
    await waitFor(() =>
      expect(screen.getByTestId("board-segment-all")).toBeTruthy(),
    );
    expect(screen.queryByTestId("quick-bar")).toBeNull();
  });
});
