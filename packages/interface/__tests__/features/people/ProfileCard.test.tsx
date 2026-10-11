// SPDX-License-Identifier: Apache-2.0

import { screen } from "@testing-library/react-native";
import { ProfileCard } from "@/features/people/ProfileCard";
import type { RosterAccess } from "@/features/people/roles";
import type { Roster } from "@/features/people/useRoster";
import { createFakeIms } from "@/test/fakeIms";
import { makePerson } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";

const admin: RosterAccess = {
  admin: true,
  inviteReporters: true,
  writeIncidents: true,
};
const inviter: RosterAccess = {
  admin: false,
  inviteReporters: true,
  writeIncidents: false,
};

const roster: Roster = {
  setRole: async () => undefined,
  enrol: async () => true,
  create: async () => undefined,
  createError: undefined,
  addToCrew: async () => undefined,
  removeFromCrew: async () => undefined,
  errorFor: () => undefined,
  pendingFor: () => false,
};

async function show(
  person: ReturnType<typeof makePerson>,
  access: RosterAccess,
) {
  const runtime = createTestRuntime({ fake: createFakeIms() });
  await renderWithProviders(
    <ProfileCard person={person} access={access} roster={roster} />,
    runtime,
  );
}

describe("ProfileCard — privacy", () => {
  it("shows the Email and Phone labels only when the wire carried them", async () => {
    await show(
      makePerson({ email: "ash@example.org", phone: "555-0101" }),
      admin,
    );
    expect(screen.getByText("Email")).toBeOnTheScreen();
    expect(screen.getByText("ash@example.org")).toBeOnTheScreen();
    expect(screen.getByText("Phone")).toBeOnTheScreen();
  });

  it("never shows their labels when absent", async () => {
    await show(makePerson(), inviter);
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("Phone")).toBeNull();
  });

  it("shows the admin shield for is_admin only", async () => {
    await show(makePerson({ isAdmin: true }), admin);
    expect(screen.getByText("Admin")).toBeOnTheScreen();
  });

  it("shows no shield otherwise", async () => {
    await show(makePerson({ isAdmin: false }), admin);
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("says No login for a name-only person, never 'no email'", async () => {
    await show(makePerson({ hasPassword: false }), admin);
    expect(screen.getByText("No login")).toBeOnTheScreen();
  });
});
