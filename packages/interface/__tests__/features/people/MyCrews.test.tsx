// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { MyCrews } from "@/features/people/MyCrews";
import { useRoster } from "@/features/people/useRoster";
import { resetFakeRouter } from "@/test/fakeRouter";
import { CREWS, INVITER_ID, PEOPLE } from "@/test/rosterData";
import { renderRoster, signedIn } from "@/test/rosterLayout";

// My crews (09aa criterion 12): a crew leader's crews, members, add by
// search, remove behind a confirm.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

function Panel() {
  const roster = useRoster(1);
  const crews = useQuery(ImsService.method.listMyCrews, { eventId: 1 });
  if (!crews.data) {
    return null;
  }
  return (
    <MyCrews
      eventId={1}
      crews={crews.data.crews}
      people={PEOPLE}
      roster={roster}
    />
  );
}

async function setup(personId = INVITER_ID) {
  const { fake, runtime } = await signedIn({ inviteReporters: true, personId });
  fake.people = PEOPLE;
  fake.crews = CREWS;
  await renderRoster(runtime, <Panel />);
  return fake;
}

describe("MyCrews", () => {
  beforeEach(() => {
    resetFakeRouter();
  });

  it("lists only the crews the caller leads, with their members", async () => {
    await setup();
    await screen.findByTestId("my-crews");
    expect(screen.getByText("Hospitality")).toBeOnTheScreen();
    expect(screen.getByText("Sanctuary")).toBeOnTheScreen();
    expect(screen.queryByText("Trailhead")).toBeNull();
    expect(screen.getAllByText("Leader").length).toBeGreaterThan(0);
  });

  it("removes a member only after the confirm", async () => {
    const fake = await setup();
    await screen.findByTestId("my-crews");
    const member = PEOPLE.find(
      (p) =>
        p.participationType === ParticipationType.REPORTER &&
        p.crews.some((c) => c.crewSlug === "hospitality" && !c.isLeader),
    );
    if (!member) {
      throw new Error("fixture has no hospitality member");
    }
    await fireEvent.press(
      screen.getByTestId(`my-crews-hospitality-remove-${member.personId}`),
    );
    expect(fake.setMyCrewMembershipRequests).toHaveLength(0);

    // Cancel writes nothing ...
    await fireEvent.press(
      screen.getByTestId(`my-crews-hospitality-cancel-${member.personId}`),
    );
    expect(fake.setMyCrewMembershipRequests).toHaveLength(0);

    // ... Confirm writes the one removal.
    await fireEvent.press(
      screen.getByTestId(`my-crews-hospitality-remove-${member.personId}`),
    );
    await fireEvent.press(
      screen.getByTestId(`my-crews-hospitality-confirm-${member.personId}`),
    );
    await waitFor(() =>
      expect(fake.setMyCrewMembershipRequests).toHaveLength(1),
    );
    expect(fake.setMyCrewMembershipRequests[0]).toMatchObject({
      crewSlug: "hospitality",
      personId: member.personId,
      remove: true,
    });
  });

  it("adds a member by search", async () => {
    const fake = await setup();
    await screen.findByTestId("my-crews");
    const candidate = PEOPLE.find(
      (p) =>
        p.participationType === ParticipationType.VOLUNTEER &&
        p.hasPassword &&
        (p.handle ?? "").length >= 3,
    );
    if (!candidate?.handle) {
      throw new Error("fixture has no volunteer");
    }
    await fireEvent.changeText(
      screen.getByTestId("my-crews-hospitality-add"),
      candidate.handle,
    );
    const hit = await screen.findAllByText(
      new RegExp(candidate.name || candidate.handle),
    );
    await fireEvent.press(hit[0] as never);
    await waitFor(() =>
      expect(fake.setMyCrewMembershipRequests).toHaveLength(1),
    );
    expect(fake.setMyCrewMembershipRequests[0]).toMatchObject({
      crewSlug: "hospitality",
      personId: candidate.personId,
      remove: false,
    });
  });
});
