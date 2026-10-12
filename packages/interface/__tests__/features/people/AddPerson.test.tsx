// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AddPerson } from "@/features/people/AddPerson";
import type { RosterAccess } from "@/features/people/roles";
import { useRoster } from "@/features/people/useRoster";
import { resetFakeRouter } from "@/test/fakeRouter";
import { makePerson } from "@/test/fixtures";
import { renderRoster, signedIn } from "@/test/rosterLayout";

// Add person (09aa criterion 12): search first, then the create form; the
// admin picks a rung, the inviter's create is a reporter.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

const ADMIN: RosterAccess = {
  admin: true,
  inviteReporters: true,
  writeIncidents: true,
};
const INVITER: RosterAccess = {
  admin: false,
  inviteReporters: true,
  writeIncidents: false,
};

function Panel(props: { access: RosterAccess; onClose?: () => void }) {
  const roster = useRoster(1);
  return (
    <AddPerson
      eventId={1}
      access={props.access}
      roster={roster}
      onClose={props.onClose ?? (() => undefined)}
    />
  );
}

async function setup(
  user: Parameters<typeof signedIn>[0],
  access: RosterAccess,
) {
  const { fake, runtime } = await signedIn(user);
  fake.people = [
    makePerson({
      personId: 21,
      handle: "rita",
      name: "Rita Reporter",
      participationType: ParticipationType.UNSPECIFIED,
    }),
  ];
  await renderRoster(runtime, <Panel access={access} />);
  return fake;
}

describe("AddPerson", () => {
  beforeEach(() => {
    resetFakeRouter();
  });

  it("enrols an existing person at Reporter by default", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    await fireEvent.changeText(screen.getByTestId("add-person-search"), "rita");
    await fireEvent.press(await screen.findByTestId("add-person-enrol-21"));
    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    expect(fake.setParticipationRequests[0]).toMatchObject({
      personId: 21,
      participationType: ParticipationType.REPORTER,
    });
    expect(fake.createPersonRequests).toHaveLength(0);
    await screen.findByText("Enrolled as Reporter");
  });

  it("an admin enrols at the rung picked", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    await fireEvent.press(
      screen.getByTestId(
        `add-person-enrol-rung-${ParticipationType.VOLUNTEER}`,
      ),
    );
    await fireEvent.changeText(screen.getByTestId("add-person-search"), "rita");
    await fireEvent.press(await screen.findByTestId("add-person-enrol-21"));
    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    expect(fake.setParticipationRequests[0]?.participationType).toBe(
      ParticipationType.VOLUNTEER,
    );
  });

  it("a refused enrol keeps Enrol pressable and shows the error beside it", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    fake.behaviour.setParticipation = "forbidden";
    await fireEvent.changeText(screen.getByTestId("add-person-search"), "rita");
    await fireEvent.press(await screen.findByTestId("add-person-enrol-21"));
    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    await screen.findByText("You can't do that here.");
    expect(screen.queryByText(/Enrolled as/)).toBeNull();
    expect(screen.getByTestId("add-person-enrol-21")).toBeOnTheScreen();
  });

  it("an inviter enrols a hit at Reporter, the admin's chosen rung going as chosen (hits carry no has_password)", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    await fireEvent.press(
      screen.getByTestId(`add-person-enrol-rung-${ParticipationType.WRITER}`),
    );
    await fireEvent.changeText(screen.getByTestId("add-person-search"), "rita");
    await fireEvent.press(await screen.findByTestId("add-person-enrol-21"));
    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    expect(fake.setParticipationRequests[0]?.participationType).toBe(
      ParticipationType.WRITER,
    );
  });

  it("shows a hit already on the roster as such, with no Enrol", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = [
      makePerson({
        personId: 22,
        handle: "vera",
        name: "Vera Volunteer",
        participationType: ParticipationType.VOLUNTEER,
      }),
    ];
    await renderRoster(runtime, <Panel access={ADMIN} />);
    await fireEvent.changeText(screen.getByTestId("add-person-search"), "vera");
    await screen.findByText("On the roster as Volunteer");
    expect(screen.queryByTestId("add-person-enrol-22")).toBeNull();
  });

  it("creates a new person when nobody matches, the admin choosing the rung", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    await fireEvent.changeText(
      screen.getByTestId("add-person-search"),
      "zelda",
    );
    await fireEvent.press(await screen.findByTestId("add-person-create"));
    expect(screen.getByTestId("add-person-fair-name").props.value).toBe(
      "zelda",
    );
    await fireEvent.press(
      screen.getByTestId(`add-person-rung-${ParticipationType.PUBLIC}`),
    );
    await fireEvent.press(screen.getByTestId("add-person-submit"));
    await screen.findByTestId("add-person-created");
    expect(fake.setParticipationRequests).toHaveLength(0);
    expect(fake.createPersonRequests).toHaveLength(1);
    expect(fake.createPersonRequests[0]).toMatchObject({
      handle: "zelda",
      eventId: 1,
      participationType: ParticipationType.PUBLIC,
    });
  });

  it("an inviter has no rung to choose and creates a reporter", async () => {
    const fake = await setup({ inviteReporters: true }, INVITER);
    expect(screen.queryByText("Enrol as")).toBeNull();
    await fireEvent.changeText(
      screen.getByTestId("add-person-search"),
      "zelda",
    );
    await fireEvent.press(await screen.findByTestId("add-person-create"));
    expect(
      screen.queryByTestId(`add-person-rung-${ParticipationType.PUBLIC}`),
    ).toBeNull();
    expect(
      screen.getByText("They'll be added as a reporter."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("add-person-submit"));
    await screen.findByTestId("add-person-created");
    expect(fake.createPersonRequests[0]?.participationType).toBe(
      ParticipationType.UNSPECIFIED,
    );
    expect(screen.getByText("Reporter")).toBeOnTheScreen();
  });

  it("puts a refusal at the field, never thrown", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    fake.behaviour.createPerson = "forbidden";
    await fireEvent.changeText(
      screen.getByTestId("add-person-search"),
      "zelda",
    );
    await fireEvent.press(await screen.findByTestId("add-person-create"));
    await fireEvent.press(screen.getByTestId("add-person-submit"));
    await screen.findByTestId("add-person-error");
  });

  it("a name is required, shown at its field before anything is sent", async () => {
    const fake = await setup({ admin: true }, ADMIN);
    await fireEvent.changeText(
      screen.getByTestId("add-person-search"),
      "zelda",
    );
    await fireEvent.press(await screen.findByTestId("add-person-create"));
    await fireEvent.changeText(screen.getByTestId("add-person-fair-name"), "");
    await fireEvent.press(screen.getByTestId("add-person-submit"));
    expect(
      await screen.findByText("A fair name is required."),
    ).toBeOnTheScreen();
    expect(fake.createPersonRequests).toHaveLength(0);
  });
});
