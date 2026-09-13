// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { DispatchScreen } from "@/features/dispatch/DispatchScreen";
import { Shell } from "@/features/shell/Shell";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { resetFakeRouter } from "@/test/fakeRouter";
import { makeIncident, makeIncidentView } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// DispatchScreen, composed inside Shell exactly as the incidents index route
// does on a wide window (plan 09x criterion 1), over the real runtime and
// createRouterTransport + createFakeIms() (plan 09x criterion 16). Routing
// is `src/test/fakeRouter.ts` — see its header comment for why
// `expo-router/testing-library`'s `renderRouter` was rejected (it breaks
// this app's real Reanimated-based motion).
//
// The window-level keyboard map (`useKeyboardMap`) is not exercised here:
// this Jest environment is `jest-environment-node` (no `window`/DOM), so
// even flipping `Platform.OS` would not be enough — the surface's own
// keyboard walk was verified by Playwright, not Jest, for the same reason
// (09x "Verified:" line). "Enter opens the drawer" is exercised through the
// search box's real `onSubmitEditing` prop instead — the same bare-number
// jump code the keyboard map itself calls into.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function populate(fake: FakeIms) {
  fake.events = [{ id: 1, name: "2026" }];
  fake.incidents = [
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 214,
        summary: "Lost child near the main stage",
      }),
    }),
    makeIncidentView({
      incident: makeIncident({
        eventId: 1,
        number: 198,
        summary: "Generator fumes near the seating",
        state: 2, // CLOSED — hidden under the default "Open" state filter
      }),
    }),
  ];
}

function renderDispatch(runtime: Awaited<ReturnType<typeof signedInRuntime>>) {
  return renderWithProviders(
    <Shell eventId={1}>
      <DispatchScreen eventId={1} />
    </Shell>,
    runtime,
  );
}

describe("DispatchScreen (wide layout)", () => {
  beforeEach(async () => {
    resetFakeRouter();
    // The state-preference key (criterion 6) lives in the same mocked
    // AsyncStorage across every test in this file; without clearing it, a
    // "Closed" chip press in one test would leak into the next as the
    // stored fallback.
    const AsyncStorage = jest.requireMock(
      "@react-native-async-storage/async-storage",
    );
    await AsyncStorage.clear();
  });

  it("renders the event's incidents as table rows", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderDispatch(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-row-214")).toBeTruthy();
    });
    // #198 is closed, hidden under the default "Open" state filter.
    expect(screen.queryByTestId("dispatch-row-198")).toBeNull();
  });

  it("a chip writes its key, changing which rows are visible", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderDispatch(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-row-214")).toBeTruthy();
    });
    expect(screen.queryByTestId("dispatch-row-198")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Closed"));

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-row-198")).toBeTruthy();
    });
    expect(screen.queryByTestId("dispatch-row-214")).toBeNull();
  });

  it("a bare number plus Enter in the search opens the drawer", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderDispatch(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-row-214")).toBeTruthy();
    });
    expect(screen.queryByTestId("dispatch-drawer")).toBeNull();

    const search = screen.getByTestId("dispatch-search");
    await fireEvent.changeText(search, "214");
    await fireEvent(search, "submitEditing");

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-drawer")).toBeTruthy();
    });
    expect(screen.getAllByText("#214").length).toBeGreaterThan(0);
  });

  it("shows New incident only with writeIncidents", async () => {
    const fake = createFakeIms();
    populate(fake);
    fake.user.writeIncidents = true;
    const runtime = await signedInRuntime(fake);
    await renderDispatch(runtime);

    await waitFor(() => {
      expect(screen.getByText("New incident")).toBeTruthy();
    });
  });

  it("hides New incident without writeIncidents", async () => {
    const fake = createFakeIms();
    populate(fake);
    const runtime = await signedInRuntime(fake);
    await renderDispatch(runtime);

    await waitFor(() => {
      expect(screen.getByTestId("dispatch-row-214")).toBeTruthy();
    });
    expect(screen.queryByText("New incident")).toBeNull();
  });

  it("shows the wide columns, like People, once the table has a wide width", async () => {
    // The table seeds its width from the window (finding 3) rather than
    // starting at 0 until `onLayout` — which this RNTL environment never
    // fires — so a wide window must show every column from the first frame.
    const dimensions = jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 1440, height: 900, scale: 1, fontScale: 1 });
    try {
      const fake = createFakeIms();
      populate(fake);
      const runtime = await signedInRuntime(fake);
      await renderDispatch(runtime);

      await waitFor(() => {
        expect(screen.getByTestId("dispatch-row-214")).toBeTruthy();
      });
      expect(screen.getByText("People")).toBeTruthy();
    } finally {
      dimensions.mockRestore();
    }
  });
});
