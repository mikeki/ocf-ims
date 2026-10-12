// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Dimensions, Platform, StyleSheet } from "react-native";
import DashboardRoute from "@/../app/(app)/events/[eventId]/dashboard";
import { DashboardScreen } from "@/features/dashboard/DashboardScreen";
import * as metricsHook from "@/features/dashboard/useMetrics";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { pushed, resetFakeRouter, setFakePathname } from "@/test/fakeRouter";
import { makeMetrics } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The dashboard screen and its route (plan 09ab criteria 8-15).

const dismissed: string[] = [];
// A screen another route has been pushed over: its focus effects are cleaned up.
const mockBlurs: (() => void)[] = [];
jest.mock("expo-router", () => {
  const router = require("@/test/fakeRouter");
  const { useEffect } = require("react");
  return {
    ...router,
    useFocusEffect: (effect: () => undefined | (() => void)) => {
      useEffect(() => {
        const cleanup = effect();
        if (cleanup) {
          mockBlurs.push(cleanup);
        }
        return cleanup;
      }, []);
    },
    useRouter: () => ({
      ...router.useRouter(),
      dismissTo: (href: string) => {
        dismissed.push(href);
      },
    }),
  };
});

async function runtimeFor(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

function writer(): FakeIms {
  const fake = createFakeIms({ user: { writeIncidents: true } });
  fake.metrics[1] = makeMetrics();
  return fake;
}

async function renderScreen(fake: FakeIms) {
  const runtime = await runtimeFor(fake);
  await renderWithProviders(
    <DashboardScreen eventId={1} onOpenFollowUp={(n) => pushed.push(n)} />,
    runtime,
  );
}

function wide() {
  return jest
    .spyOn(Dimensions, "get")
    .mockReturnValue({ width: 1440, height: 900, scale: 1, fontScale: 1 });
}

beforeEach(() => {
  resetFakeRouter({ eventId: "1" });
  dismissed.length = 0;
  mockBlurs.length = 0;
});

let platform: { restore: () => void } | undefined;

afterEach(() => {
  platform?.restore();
  platform = undefined;
  jest.restoreAllMocks();
  (globalThis as unknown as { window?: unknown }).window = undefined;
});

describe("DashboardScreen", () => {
  it("is only a spinner before the first answer", async () => {
    // Pending first answer, held by the hook: nothing but the spinner.
    jest.spyOn(metricsHook, "useMetrics").mockReturnValue({
      metrics: undefined,
      isLoading: true,
      isRefreshing: true,
      error: undefined,
      lastError: undefined,
      changedKeys: new Set(),
      refresh: () => undefined,
    });
    await renderScreen(writer());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-total")).toBeNull();
    jest.restoreAllMocks();
  });

  it("then shows every card", async () => {
    await renderScreen(writer());
    expect(await screen.findByTestId("dashboard-total")).toBeTruthy();
    expect(screen.queryByLabelText("Loading")).toBeNull();
    for (const title of [
      "Priority",
      "Category",
      "Type",
      "Area",
      "Per day",
      "Roles",
      "Open follow-ups",
    ]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    // Type and Area each fold their tail behind "Top 10".
    expect(screen.getAllByText("Top 10").length).toBeGreaterThan(0);
    expect(screen.queryByText("Top 10 areas")).toBeNull();
    expect(screen.getByText("People, not incidents")).toBeTruthy();
  });

  it("renders every card with its empty line for an empty event", async () => {
    await renderScreen(createFakeIms({ user: { writeIncidents: true } }));
    expect(await screen.findByText("No incidents closed yet")).toBeTruthy();
    expect(screen.getByText("Open follow-ups")).toBeTruthy();
    expect(screen.getByText("No follow-ups owed")).toBeTruthy();
  });

  it("answers Not found, not a 403 message, for a reporter", async () => {
    await renderScreen(createFakeIms());
    expect(await screen.findByText("Not found")).toBeTruthy();
    expect(screen.queryByText(/not allowed|permission|403/i)).toBeNull();
  });

  it("answers Couldn't load with Retry when the first read fails", async () => {
    const fake = writer();
    fake.behaviour.getMetrics = "unavailable";
    await renderScreen(fake);
    expect(await screen.findByText("Couldn't load")).toBeTruthy();
    fake.behaviour.getMetrics = "ok";
    await fireEvent.press(screen.getByText("Retry"));
    expect(await screen.findByTestId("dashboard-total")).toBeTruthy();
  });

  it("shows the loading state while a Retry after a failed first load is in flight", async () => {
    jest.spyOn(metricsHook, "useMetrics").mockReturnValue({
      metrics: undefined,
      isLoading: false,
      isRefreshing: true,
      error: { kind: "unavailable", message: "redeploying" } as never,
      lastError: undefined,
      changedKeys: new Set(),
      refresh: () => undefined,
    });
    await renderScreen(writer());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(screen.queryByText("Couldn't load")).toBeNull();
  });

  it("says No roles yet, not No incidents yet, on an empty Roles card", async () => {
    await renderScreen(createFakeIms({ user: { writeIncidents: true } }));
    expect(await screen.findByText("No roles yet")).toBeTruthy();
  });

  it("wraps the KPI tiles two to a row on a phone, four across when wide", async () => {
    await renderScreen(writer());
    const phone = StyleSheet.flatten(
      (await screen.findByTestId("dashboard-total")).props.style,
    );
    expect(phone.flexBasis).toBe("40%");
    await screen.unmount();
    wide();
    await renderScreen(writer());
    const desk = StyleSheet.flatten(
      (await screen.findByTestId("dashboard-total")).props.style,
    );
    expect(desk.flexBasis).toBe(0);
  });

  it("marks what moved after a second answer", async () => {
    const fake = writer();
    await renderScreen(fake);
    await screen.findByTestId("dashboard-total");
    expect(screen.queryByTestId("dashboard-open-changed")).toBeNull();
    const base = makeMetrics();
    fake.metrics[1] = makeMetrics({
      open: base.open + 1n,
      total: base.total + 1n,
    });
    await fireEvent.press(screen.getByTestId("dashboard-toolbar-refresh"));
    expect(await screen.findByTestId("dashboard-open-changed")).toBeTruthy();
    expect(screen.getByTestId("dashboard-total-changed")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-closed-changed")).toBeNull();
  });

  it("keeps the numbers when a refresh fails", async () => {
    const fake = writer();
    await renderScreen(fake);
    await screen.findByTestId("dashboard-total");
    fake.behaviour.getMetrics = "unavailable";
    await fireEvent.press(screen.getByTestId("dashboard-toolbar-refresh"));
    expect(await screen.findByText(/Couldn't refresh/)).toBeTruthy();
    expect(screen.getByTestId("dashboard-total")).toBeTruthy();
    fake.behaviour.getMetrics = "ok";
    await fireEvent.press(screen.getByText("Retry"));
    await waitFor(() =>
      expect(screen.queryByText(/Couldn't refresh/)).toBeNull(),
    );
  });

  it("opens a follow-up by its incident number", async () => {
    const fake = writer();
    const first = makeMetrics().openFollowUps[0];
    expect(first).toBeDefined();
    await renderScreen(fake);
    await fireEvent.press(
      await screen.findByText(new RegExp(`${first?.summary.slice(0, 20)}`)),
    );
    expect(pushed).toContain(first?.incidentNumber);
  });

  it("refetches on r and opens help on ? (web)", async () => {
    type Listener = (e: unknown) => void;
    let listener: Listener | undefined;
    (globalThis as unknown as { window?: unknown }).window = {
      addEventListener: (type: string, l: Listener) => {
        if (type === "keydown") {
          listener = l;
        }
      },
      removeEventListener: () => undefined,
    };
    platform = jest.replaceProperty(Platform, "OS", "web");
    const fake = writer();
    await renderScreen(fake);
    await screen.findByTestId("dashboard-total");
    expect(fake.getMetricsRequests).toHaveLength(1);
    await act(async () => {
      listener?.({ key: "r", target: { tagName: "DIV" } });
    });
    await waitFor(() => expect(fake.getMetricsRequests).toHaveLength(2));
    await act(async () => {
      listener?.({ key: "?", target: { tagName: "DIV" } });
    });
    expect(await screen.findByText("Refresh the numbers")).toBeTruthy();
  });

  it("does not refetch on r while another route is pushed over it (web)", async () => {
    type Listener = (e: unknown) => void;
    let listener: Listener | undefined;
    (globalThis as unknown as { window?: unknown }).window = {
      addEventListener: (type: string, l: Listener) => {
        if (type === "keydown") {
          listener = l;
        }
      },
      removeEventListener: () => undefined,
    };
    platform = jest.replaceProperty(Platform, "OS", "web");
    const fake = writer();
    await renderScreen(fake);
    await screen.findByTestId("dashboard-total");
    for (const blur of mockBlurs) {
      blur();
    }
    await act(async () => {
      listener?.({ key: "r", target: { tagName: "DIV" } });
    });
    expect(fake.getMetricsRequests).toHaveLength(1);
  });
});

async function renderRoute(fake: FakeIms) {
  const runtime = await runtimeFor(fake);
  setFakePathname("/events/1/dashboard");
  await renderWithProviders(<DashboardRoute />, runtime);
}

describe("the dashboard route", () => {
  it("shows the Back-to-Incidents header on a phone, without the shell", async () => {
    await renderRoute(writer());
    expect(await screen.findByTestId("dashboard-total")).toBeTruthy();
    expect(screen.queryByTestId("shell-nav-dashboard")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Incidents"));
    expect(dismissed).toContain("/events/1/incidents");
  });

  it("puts a Dashboard item in the shell for a writer, active on the route", async () => {
    wide();
    await renderRoute(writer());
    const item = await screen.findByTestId("shell-nav-dashboard");
    expect(item.props.accessibilityRole).toBe("text");
    expect(await screen.findByTestId("dashboard-total")).toBeTruthy();
  });

  it("has no Dashboard item for a reporter, and the route says Not found", async () => {
    wide();
    await renderRoute(createFakeIms());
    expect(await screen.findByText("Not found")).toBeTruthy();
    expect(screen.queryByTestId("shell-nav-dashboard")).toBeNull();
  });

  it("opens a follow-up on its own page on a phone", async () => {
    await renderRoute(writer());
    const first = makeMetrics().openFollowUps[0];
    await fireEvent.press(
      await screen.findByText(new RegExp(`${first?.summary.slice(0, 20)}`)),
    );
    expect(pushed).toContain(`/events/1/incidents/${first?.incidentNumber}`);
  });

  it("opens a follow-up in the incident drawer's URL when wide", async () => {
    wide();
    await renderRoute(writer());
    const first = makeMetrics().openFollowUps[0];
    await fireEvent.press(
      await screen.findByText(new RegExp(`${first?.summary.slice(0, 20)}`)),
    );
    expect(pushed).toContain(
      `/events/1/incidents?open=${first?.incidentNumber}`,
    );
  });
});
