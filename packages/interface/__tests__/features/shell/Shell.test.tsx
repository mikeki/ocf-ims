// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Shell } from "@/features/shell/Shell";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { pushed, resetFakeRouter, setFakePathname } from "@/test/fakeRouter";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The shell's destinations and actions (plan 09z criterion 11).

jest.mock("expo-router", () => require("@/test/fakeRouter"));

async function renderShell(fake: FakeIms, path: string) {
  setFakePathname(path);
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  await renderWithProviders(
    <Shell eventId={1}>
      <Text>body</Text>
    </Shell>,
    runtime,
  );
  await screen.findByTestId("shell-nav-reports");
}

describe("Shell", () => {
  beforeEach(() => {
    resetFakeRouter();
  });

  it("always shows Reports after Incidents, and Reports navigates from the incidents routes", async () => {
    await renderShell(createFakeIms(), "/events/1/incidents");
    expect(screen.getByTestId("shell-nav-incidents")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("shell-nav-reports"));
    expect(pushed).toContain("/events/1/reports");
  });

  it("marks Reports active on the reports routes and Incidents navigates back", async () => {
    await renderShell(createFakeIms(), "/events/1/reports/7");
    // The current page is a plain marker; the other one is a link.
    expect(
      screen.getByTestId("shell-nav-reports").props.accessibilityRole,
    ).toBe("text");
    await fireEvent.press(screen.getByTestId("shell-nav-incidents"));
    expect(pushed).toContain("/events/1/incidents");
  });

  it("shows New report only with writeReports", async () => {
    await renderShell(createFakeIms(), "/events/1/reports");
    expect(screen.queryByText("New report")).toBeNull();
  });

  it("shows New report beside New incident for a writer and navigates to the form", async () => {
    await renderShell(
      createFakeIms({ user: { writeReports: true, writeIncidents: true } }),
      "/events/1/reports",
    );
    expect(await screen.findByText("New incident")).toBeTruthy();
    await fireEvent.press(await screen.findByText("New report"));
    expect(pushed).toContain("/events/1/reports/new");
  });

  it("shows People after Reports for an inviter and navigates to the roster", async () => {
    await renderShell(
      createFakeIms({ user: { inviteReporters: true } }),
      "/events/1/incidents",
    );
    await screen.findByTestId("shell-nav-people");
    await fireEvent.press(screen.getByTestId("shell-nav-people"));
    expect(pushed).toContain("/events/1/people");
  });

  it("shows People for an admin, active on the roster route", async () => {
    await renderShell(
      createFakeIms({ user: { admin: true } }),
      "/events/1/people",
    );
    await screen.findByTestId("shell-nav-people");
    expect(screen.getByTestId("shell-nav-people").props.accessibilityRole).toBe(
      "text",
    );
    // Incidents is a link again, not the active marker.
    await fireEvent.press(screen.getByTestId("shell-nav-incidents"));
    expect(pushed).toContain("/events/1/incidents");
  });

  it("has no People item for a plain writer", async () => {
    await renderShell(
      createFakeIms({ user: { writeIncidents: true, writeReports: true } }),
      "/events/1/incidents",
    );
    // GetAuthStatus has answered once New incident is there.
    await screen.findByText("New incident");
    expect(screen.queryByTestId("shell-nav-people")).toBeNull();
  });
});
