// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime, renderWithProviders } from "@/test/harness";

describe("LoginScreen", () => {
  it("disables Sign in until both fields are filled", async () => {
    const fake = createFakeIms();
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    await fireEvent.changeText(
      screen.getByLabelText("Password"),
      fake.user.password,
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("shows Wrong email or password for bad credentials", async () => {
    const fake = createFakeIms();
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    await fireEvent.changeText(screen.getByLabelText("Password"), "wrong");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Wrong email or password.");
  });

  it("signs in on correct credentials", async () => {
    const fake = createFakeIms();
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    await fireEvent.changeText(
      screen.getByLabelText("Password"),
      fake.user.password,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(fake.callsOf("Login")).toHaveLength(1));
    expect(screen.queryByText("Wrong email or password.")).toBeNull();
  });

  it("shows the server's message and leaves the button enabled when it can't be reached", async () => {
    const fake = createFakeIms();
    fake.behaviour.getAuthStatus = "unavailable";
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    await fireEvent.changeText(
      screen.getByLabelText("Password"),
      fake.user.password,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText(
      "Can't reach the server. Check the connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("counts down a throttled attempt and disables Sign in until it reaches zero", async () => {
    jest.useFakeTimers();
    const fake = createFakeIms();
    fake.behaviour.login = "throttled";
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    await fireEvent.changeText(
      screen.getByLabelText("Password"),
      fake.user.password,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Too many attempts. Try again in 7 s.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();

    await act(async () => {
      jest.advanceTimersByTime(7000);
    });

    await screen.findByText("Too many attempts. You can try again now.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();

    // A second throttled answer with the same Retry-After restarts the countdown.
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Too many attempts. Try again in 7 s.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(fake.callsOf("Login")).toHaveLength(2);
    jest.useRealTimers();
  });

  it("toggles the password's visibility", async () => {
    const fake = createFakeIms();
    const runtime = createTestRuntime({ fake });
    await renderWithProviders(<LoginScreen />, runtime);

    const password = screen.getByLabelText("Password");
    expect(password.props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByText("Show password"));
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);

    await fireEvent.press(screen.getByText("Hide password"));
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
  });
});
