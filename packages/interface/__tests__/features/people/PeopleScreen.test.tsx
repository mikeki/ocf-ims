// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { resetFakeRouter } from "@/test/fakeRouter";
import { makePerson } from "@/test/fixtures";
import {
  layoutColumns,
  renderRoster,
  setRect,
  signedIn,
  wideWindow,
} from "@/test/rosterLayout";
import PeopleRoute from "../../../app/(app)/events/[eventId]/people";

// The roster screen over the real runtime and the fake (09aa criteria 9, 13,
// 16, 18). Routing is `src/test/fakeRouter.ts`.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

const PEOPLE = [
  makePerson({
    personId: 11,
    handle: "wanda",
    name: "Wanda Writer",
    participationType: ParticipationType.WRITER,
    email: "wanda@example.org",
  }),
  makePerson({
    personId: 12,
    handle: "lee",
    name: "Lee Leader",
    participationType: ParticipationType.CREW_LEADER,
  }),
  makePerson({
    personId: 13,
    handle: "rita",
    name: "Rita Reporter",
    participationType: ParticipationType.REPORTER,
    email: "rita@example.org",
    phone: "555-0113",
  }),
  makePerson({
    personId: 14,
    handle: "vic",
    name: "Vic Volunteer",
    participationType: ParticipationType.VOLUNTEER,
  }),
  makePerson({
    personId: 15,
    handle: "pam",
    name: "Pam Public",
    participationType: ParticipationType.PUBLIC,
  }),
  makePerson({
    personId: 16,
    handle: "nolo",
    name: "Nola Name-only",
    hasPassword: false,
    participationType: ParticipationType.VOLUNTEER,
  }),
];

async function openCard(id: number) {
  setRect(`people-ladder-card-${id}`, {
    x: 0,
    y: 40,
    width: 180,
    height: 80,
  });
  await fireEvent.press(screen.getByTestId(`people-ladder-card-${id}`));
}

describe("PeopleScreen", () => {
  beforeEach(() => {
    resetFakeRouter();
  });

  it("lays out five columns with counts and a card per person", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-11");
    expect(screen.getByText("FC/BUM · 1")).toBeOnTheScreen();
    expect(screen.getByText("Crew leader · 1")).toBeOnTheScreen();
    expect(screen.getByText("Reporter · 1")).toBeOnTheScreen();
    expect(screen.getByText("Volunteer · 2")).toBeOnTheScreen();
    expect(screen.getByText("Public · 1")).toBeOnTheScreen();
    expect(screen.getByText("6 of 6")).toBeOnTheScreen();
    expect(screen.getAllByText("No login")).toHaveLength(1);
    expect(fake.listPersonnelRequests.at(-1)).toMatchObject({
      all: true,
      eventId: 1,
      showAll: false,
    });
  });

  it("the search filters every column", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-11");
    await fireEvent.changeText(screen.getByTestId("people-search"), "rita");
    await waitFor(() =>
      expect(screen.queryByTestId("people-ladder-card-11")).toBeNull(),
    );
    expect(screen.getByTestId("people-ladder-card-13")).toBeOnTheScreen();
    expect(screen.getByText("1 of 6")).toBeOnTheScreen();
  });

  it("an inviter sees no writer rung, no grip on a writer, and no contact field", async () => {
    const { fake, runtime } = await signedIn({ inviteReporters: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-11");
    // No grip, no menu on the writer's and the crew leader's cards ...
    expect(screen.queryByTestId("people-ladder-card-11-grip")).toBeNull();
    expect(screen.queryByTestId("people-ladder-card-11-move")).toBeNull();
    expect(screen.queryByTestId("people-ladder-card-12-grip")).toBeNull();
    // ... a grip and a menu on a reporter's, with no writer rung in it.
    expect(screen.getByTestId("people-ladder-card-13-grip")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("people-ladder-card-13-move"));
    expect(
      screen.getByTestId(
        `people-ladder-card-13-move-${ParticipationType.REPORTER}`,
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(
        `people-ladder-card-13-move-${ParticipationType.WRITER}`,
      ),
    ).toBeNull();
    // The wire withholds contact fields from an inviter, so the card has none.
    await fireEvent.press(screen.getByTestId("people-ladder-card-13-move"));
    await openCard(13);
    await screen.findByTestId("people-hovercard-13");
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("Phone")).toBeNull();
    // No "Show everyone" for an inviter.
    expect(screen.queryByText("Show everyone")).toBeNull();
  });

  it("an admin sees the contact fields and Show everyone, which asks for show_all", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-13");
    await openCard(13);
    await screen.findByTestId("people-hovercard-13");
    expect(screen.getByText("Email")).toBeOnTheScreen();
    expect(screen.getByText("Phone")).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("people-show-all"));
    await waitFor(() =>
      expect(fake.listPersonnelRequests.at(-1)?.showAll).toBe(true),
    );
  });

  it("Move to… writes the rung and the card changes column", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-14");
    await fireEvent.press(screen.getByTestId("people-ladder-card-14-move"));
    await fireEvent.press(
      screen.getByTestId(
        `people-ladder-card-14-move-${ParticipationType.PUBLIC}`,
      ),
    );
    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    expect(fake.setParticipationRequests[0]).toMatchObject({
      personId: 14,
      participationType: ParticipationType.PUBLIC,
    });
    await screen.findByText("Public · 2");
  });

  it("shows the empty state for a roster with nobody", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = [];
    await renderRoster(runtime);
    await screen.findByText("No one on this roster");
  });

  it("the stage can be laid out for the drag", async () => {
    const { fake, runtime } = await signedIn({ admin: true });
    fake.people = PEOPLE;
    await renderRoster(runtime);
    await screen.findByTestId("people-ladder-card-14");
    await layoutColumns();
    expect(screen.getByTestId("people-stage")).toBeOnTheScreen();
  });
});

describe("the people route", () => {
  beforeEach(() => {
    resetFakeRouter({ eventId: "1" });
  });

  it("answers Not found for a plain writer", async () => {
    const restore = wideWindow();
    try {
      const { runtime } = await signedIn({ writeIncidents: true });
      await renderRoster(runtime, <PeopleRoute />);
      await screen.findByText("Not found");
      expect(screen.queryByTestId("people-ladder")).toBeNull();
    } finally {
      restore();
    }
  });

  it("renders the roster inside the shell for an inviter", async () => {
    const restore = wideWindow();
    try {
      const { fake, runtime } = await signedIn({ inviteReporters: true });
      fake.people = PEOPLE;
      await renderRoster(runtime, <PeopleRoute />);
      await screen.findByTestId("people-ladder");
      expect(screen.getByTestId("shell-nav-people")).toBeOnTheScreen();
    } finally {
      restore();
    }
  });

  it("asks for a wider window below 1024", async () => {
    const { runtime } = await signedIn({ admin: true });
    await renderRoster(runtime, <PeopleRoute />);
    await screen.findByText("Open the roster on a wider window");
    expect(screen.queryByTestId("people-ladder")).toBeNull();
  });
});
