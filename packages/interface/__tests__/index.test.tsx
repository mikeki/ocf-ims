// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen } from "@testing-library/react-native";
import { createFakeIms } from "@/test/fakeIms";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";
import Index from "../app/index";

// The index route inside the real providers: the session bootstraps on mount
// and the route shows each state.

describe("the index route", () => {
  it("resumes a stored native session and shows who is signed in", async () => {
    const fake = createFakeIms();
    const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
    const runtime = createTestRuntime({ fake, store, platform: "native" });

    await renderWithProviders(<Index />, runtime);

    screen.getByText("OCF IMS");
    await screen.findByText("Signed in as Dee");
    screen.getByText("member");

    await fireEvent.press(screen.getByText("Sign out"));
    await screen.findByText("Sign in");
    expect(fake.callsOf("Logout")).toHaveLength(1);
  });

  it("shows the sign-in form when signed out, and signs in through it", async () => {
    const fake = createFakeIms({ user: { admin: true } });
    const runtime = createTestRuntime({ fake, platform: "web" });

    await renderWithProviders(<Index />, runtime);

    await screen.findByText("Sign in");
    await fireEvent.changeText(screen.getByLabelText("Email"), fake.user.email);
    await fireEvent.changeText(screen.getByLabelText("Password"), "wrong");
    await fireEvent.press(screen.getByText("Sign in"));
    await screen.findByText("Wrong email or password.");

    await fireEvent.changeText(
      screen.getByLabelText("Password"),
      fake.user.password,
    );
    await fireEvent.press(screen.getByText("Sign in"));
    await screen.findByText("Signed in as Dee");
    screen.getByText("admin");
  });

  it("shows the unreachable state with a retry when the server is down", async () => {
    const fake = createFakeIms();
    fake.cookieRefreshToken = fake.issueRefreshToken();
    fake.behaviour.refresh = "unavailable";
    const runtime = createTestRuntime({ fake, platform: "web" });

    await renderWithProviders(<Index />, runtime);

    await screen.findByText("Can't reach the server");
    fake.behaviour.refresh = "ok";
    await fireEvent.press(screen.getByText("Retry"));
    await screen.findByText("Signed in as Dee");
  });
});
