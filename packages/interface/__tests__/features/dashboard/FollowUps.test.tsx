// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@/design/theme";
import { FollowUps } from "@/features/dashboard/FollowUps";

// FollowUps (plan 09ab): number · summary rows that open the incident.

describe("FollowUps", () => {
  it("opens the incident on press", async () => {
    const onOpen = jest.fn();
    await render(
      <ThemeProvider scheme="light">
        <FollowUps
          items={[
            { incidentNumber: 142, summary: "Missing camper near the meadow" },
            { incidentNumber: 138, summary: "Structure damage from wind" },
          ]}
          onOpen={onOpen}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText("Structure damage from wind")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Open incident 142"));
    expect(onOpen).toHaveBeenCalledWith(142);
  });

  it("says no follow-ups are owed when empty", async () => {
    await render(
      <ThemeProvider scheme="light">
        <FollowUps items={[]} onOpen={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByText("No follow-ups owed")).toBeTruthy();
  });
});
