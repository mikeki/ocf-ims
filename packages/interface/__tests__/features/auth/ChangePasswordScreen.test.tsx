// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ChangePasswordScreen } from "@/features/auth/ChangePasswordScreen";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

function signedInRuntime(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  return createTestRuntime({ fake, store, platform: "native" });
}

describe("ChangePasswordScreen", () => {
  it("rejects a password shorter than 8 characters before calling the server", async () => {
    const fake = createFakeIms({ user: { usingDefaultPassword: true } });
    const runtime = signedInRuntime(fake);
    await renderWithProviders(<ChangePasswordScreen />, runtime);

    await fireEvent.changeText(screen.getByLabelText("New password"), "short");
    await fireEvent.changeText(
      screen.getByLabelText("Confirm password"),
      "short",
    );
    await fireEvent.press(screen.getByText("Save password"));

    await screen.findByText("Use at least 8 characters.");
    expect(fake.callsOf("ChangeOwnPassword")).toHaveLength(0);
  });

  it("rejects mismatched passwords before calling the server", async () => {
    const fake = createFakeIms({ user: { usingDefaultPassword: true } });
    const runtime = signedInRuntime(fake);
    await renderWithProviders(<ChangePasswordScreen />, runtime);

    await fireEvent.changeText(
      screen.getByLabelText("New password"),
      "longenough1",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Confirm password"),
      "longenough2",
    );
    await fireEvent.press(screen.getByText("Save password"));

    await screen.findByText("The passwords don't match.");
    expect(fake.callsOf("ChangeOwnPassword")).toHaveLength(0);
  });

  it("changes the password and lifts the gate by refreshing auth status", async () => {
    const fake = createFakeIms({ user: { usingDefaultPassword: true } });
    const runtime = signedInRuntime(fake);
    await renderWithProviders(<ChangePasswordScreen />, runtime);

    await fireEvent.changeText(
      screen.getByLabelText("New password"),
      "longenough1",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Confirm password"),
      "longenough1",
    );
    await fireEvent.press(screen.getByText("Save password"));

    await waitFor(() =>
      expect(fake.callsOf("ChangeOwnPassword")).toHaveLength(1),
    );
    expect(fake.user.usingDefaultPassword).toBe(false);
    await waitFor(() =>
      expect(runtime.session.getState()).toMatchObject({
        status: "signedIn",
        auth: { usingDefaultPassword: false },
      }),
    );
  });

  it("shows an ErrorState when the server can't be reached", async () => {
    const fake = createFakeIms({ user: { usingDefaultPassword: true } });
    fake.behaviour.changeOwnPassword = "unavailable";
    const runtime = signedInRuntime(fake);
    await renderWithProviders(<ChangePasswordScreen />, runtime);

    await fireEvent.changeText(
      screen.getByLabelText("New password"),
      "longenough1",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Confirm password"),
      "longenough1",
    );
    await fireEvent.press(screen.getByText("Save password"));

    await screen.findByText("Can't reach the server");
  });

  it("signs out", async () => {
    const fake = createFakeIms({ user: { usingDefaultPassword: true } });
    const runtime = signedInRuntime(fake);
    await renderWithProviders(<ChangePasswordScreen />, runtime);

    await fireEvent.press(screen.getByText("Sign out"));
    expect(fake.callsOf("Logout")).toHaveLength(1);
  });
});
