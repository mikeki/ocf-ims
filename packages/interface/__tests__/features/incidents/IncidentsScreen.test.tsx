// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import { IncidentsScreen } from "@/features/incidents/IncidentsScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { makeArea, makeIncident, makeIncidentView } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// (jest.setup.ts makes TanStack's notifyManager synchronous for every suite:
// this screen chains two queries — useEventAccess gates useAreas — and a
// deferred notification could otherwise land outside an act() scope.)

// react-native's Jest preset replaces RefreshControl with a stub that drops
// every prop from what it renders (@react-native/jest-preset/jest/mocks/RefreshControl.js)
// — a testID never reaches the tree — but the mock's class instance keeps the
// real props, and records the latest mounted instance statically. Calling its
// onRefresh directly is the supported way to fire pull-to-refresh under this preset.
function latestRefreshControl(): { onRefresh?: () => void } {
  const latestRef = (
    RefreshControl as unknown as {
      latestRef?: { props: { onRefresh?: () => void } };
    }
  ).latestRef;
  if (!latestRef) {
    throw new Error("no RefreshControl has mounted yet");
  }
  return latestRef.props;
}

// IncidentsScreen against the real runtime (plan 09n), the same pattern as
// EventsScreen.test.tsx: sign in with a stored refresh token so the screen
// mounts already authenticated.

jest.mock("@connectrpc/connect-query", () => {
  const actual = jest.requireActual("@connectrpc/connect-query");
  return { ...actual, useQuery: jest.fn(actual.useQuery) };
});

// `useEventAccess` reads GetAuthStatus, which — unlike ListEvents/ListIncidents
// — answers 200 `authenticated: false` for an anonymous caller rather than
// throwing, so the transport's reactive refresh-and-retry never kicks in for
// it: a call fired before bootstrap finishes gets cached as "no access" for
// the hook's 5-minute staleTime. In the real app this can't happen (the
// screen only mounts once the (app) layout has already reached `signedIn`);
// here it means bootstrapping BEFORE mounting the screen, not just providing
// a refresh token for the mount-time bootstrap to consume.
async function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime;
}

describe("IncidentsScreen", () => {
  it("lists incidents newest first with their badges", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          summary: "First",
          state: IncidentState.OPEN,
          priority: IncidentPriority.HIGH,
        }),
      }),
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 2,
          summary: "Second",
          state: IncidentState.CLOSED,
          priority: IncidentPriority.NORMAL,
          private: true,
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByTestId("incident-row-2");
    const rows = screen.getAllByTestId(/^incident-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual([
      "incident-row-2",
      "incident-row-1",
    ]);
    // The incident number is its own column since 09o, not a prefix on the
    // summary — the one assertion in the suite that had to follow the design.
    screen.getByText("#1");
    screen.getByText("First");
    screen.getByText("High");
    screen.getByText("Closed");
    screen.getByText("Private");
  });

  it("opens an incident on press", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({ incident: makeIncident({ eventId: 1, number: 7 }) }),
    ];
    const runtime = await signedInRuntime(fake);
    const onOpenIncident = jest.fn();

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={onOpenIncident}
      />,
      runtime,
    );

    await screen.findByTestId("incident-row-7");
    await fireEvent.press(screen.getByTestId("incident-row-7"));

    expect(onOpenIncident).toHaveBeenCalledWith(7);
  });

  it("shows the area's name when areas are readable", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.areas = [makeArea({ slug: "center-camp", name: "Center Camp" })];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          location: { areaSlug: "center-camp" },
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText(/Center Camp/);
  });

  it("falls back to the raw slug when areas are not readable", async () => {
    const fake = createFakeIms({ user: { readAreas: false } });
    fake.events = [{ id: 1, name: "2026" }];
    fake.areas = [makeArea({ slug: "center-camp", name: "Center Camp" })];
    fake.incidents = [
      makeIncidentView({
        incident: makeIncident({
          eventId: 1,
          number: 1,
          location: { areaSlug: "center-camp" },
        }),
      }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText(/center-camp/);
    expect(screen.queryByText(/Center Camp/)).toBeNull();
    expect(fake.callsOf("ListAreas")).toHaveLength(0);
  });

  it("shows the empty state with no incidents", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("No incidents yet");
  });

  it("shows No access with no Retry when forbidden", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.behaviour.listIncidents = "forbidden";
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("No access");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows an error with retry when the list can't be reached", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.behaviour.listIncidents = "unavailable";
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByText("Can't reach the server");
    screen.getByRole("button", { name: "Retry" });
  });

  it("pulls to refresh", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    fake.incidents = [
      makeIncidentView({ incident: makeIncident({ eventId: 1, number: 1 }) }),
    ];
    const runtime = await signedInRuntime(fake);

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );

    await screen.findByTestId("incident-row-1");
    expect(fake.callsOf("ListIncidents")).toHaveLength(1);

    await act(async () => {
      latestRefreshControl().onRefresh?.();
    });

    await waitFor(() => expect(fake.callsOf("ListIncidents")).toHaveLength(2));
  });

  it("polls the list every 30 seconds (the query option, not the clock)", async () => {
    const fake = createFakeIms();
    fake.events = [{ id: 1, name: "2026" }];
    const runtime = await signedInRuntime(fake);
    const mockedUseQuery = useQuery as unknown as jest.Mock;
    mockedUseQuery.mockClear();

    await renderWithProviders(
      <IncidentsScreen
        eventId={1}
        onBack={jest.fn()}
        onOpenIncident={jest.fn()}
      />,
      runtime,
    );
    await screen.findByText("No incidents yet");

    const call = mockedUseQuery.mock.calls.find(
      ([method]) => method === ImsService.method.listIncidents,
    );
    expect(call?.[2]).toMatchObject({ refetchInterval: 30_000 });
  });
});
