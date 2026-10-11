// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen } from "@testing-library/react-native";
import { FlatList } from "react-native";
import { RoleMenu } from "@/features/people/RoleMenu";
import { createFakeIms } from "@/test/fakeIms";
import { makePerson, makeRoster } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";

const RUNGS = [
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

describe("RoleMenu", () => {
  it("writes on pick with no confirm, from the last card of a list", async () => {
    const people = makeRoster(12);
    const last = people[people.length - 1] ?? makePerson();
    const onSelect = jest.fn();
    await renderWithProviders(
      <FlatList
        data={people}
        initialNumToRender={people.length}
        keyExtractor={(p) => String(p.personId)}
        renderItem={({ item }) => (
          <RoleMenu
            person={item}
            rungs={RUNGS}
            onSelect={onSelect}
            testID={`menu-${item.personId}`}
          />
        )}
      />,
      createTestRuntime({ fake: createFakeIms() }),
    );
    await fireEvent.press(screen.getByTestId(`menu-${last.personId}`));
    await fireEvent.press(
      screen.getByTestId(
        `menu-${last.personId}-option-${ParticipationType.PUBLIC}`,
      ),
    );
    expect(onSelect).toHaveBeenCalledWith(ParticipationType.PUBLIC);
  });

  it("renders a plain label when there are no rungs", async () => {
    await renderWithProviders(
      <RoleMenu
        person={makePerson({ participationType: ParticipationType.WRITER })}
        rungs={[]}
        onSelect={jest.fn()}
        testID="menu"
      />,
      createTestRuntime({ fake: createFakeIms() }),
    );
    expect(screen.getByText("FC/BUM")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the error line under the control", async () => {
    await renderWithProviders(
      <RoleMenu
        person={makePerson()}
        rungs={RUNGS}
        onSelect={jest.fn()}
        error={{ kind: "permission", message: "not allowed" } as never}
        testID="menu"
      />,
      createTestRuntime({ fake: createFakeIms() }),
    );
    expect(screen.getByTestId("menu-error")).toBeOnTheScreen();
  });
});
