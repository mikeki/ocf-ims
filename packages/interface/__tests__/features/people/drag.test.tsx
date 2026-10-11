// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { resetFakeRouter } from "@/test/fakeRouter";
import { makePerson } from "@/test/fixtures";
import {
  columnX,
  layoutColumns,
  renderRoster,
  setRect,
  signedIn,
} from "@/test/rosterLayout";

// The Ladder's drag (09aa criterion 10), driven as the browser drives it:
// pointer events on the grip, then on the full-stage overlay.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

let mockReduced = false;
const mockWithSpring = jest.fn();
jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated");
  // A proxy, not a spread: the module's `default` and `__esModule` are getters.
  return new Proxy(actual, {
    get(target, key) {
      if (key === "useReducedMotion") {
        return () => mockReduced;
      }
      if (key === "withSpring") {
        return (...args: unknown[]) => {
          mockWithSpring(...args);
          return target.withSpring(...args);
        };
      }
      return Reflect.get(target, key);
    },
  });
});

const PEOPLE = [
  makePerson({
    personId: 11,
    handle: "wanda",
    name: "Wanda Writer",
    participationType: ParticipationType.WRITER,
  }),
  makePerson({
    personId: 13,
    handle: "rita",
    name: "Rita Reporter",
    participationType: ParticipationType.REPORTER,
  }),
  makePerson({
    personId: 14,
    handle: "vic",
    name: "Vic Volunteer",
    participationType: ParticipationType.VOLUNTEER,
  }),
];

async function pickUp(id: number, from: { x: number; y: number }) {
  setRect(`people-ladder-card-${id}`, {
    x: from.x - 20,
    y: from.y - 20,
    width: 180,
    height: 80,
  });
  const preventDefault = jest.fn();
  await fireEvent(
    screen.getByTestId(`people-ladder-card-${id}-grip`),
    "pointerDown",
    {
      nativeEvent: { clientX: from.x, clientY: from.y },
      stopPropagation: jest.fn(),
      preventDefault,
    },
  );
  await screen.findByTestId("people-drag-overlay");
  return preventDefault;
}

async function dragTo(x: number, y: number) {
  const overlay = screen.getByTestId("people-drag-overlay");
  await fireEvent(overlay, "pointerMove", {
    nativeEvent: { clientX: x, clientY: y },
  });
  await fireEvent(overlay, "pointerUp", {
    nativeEvent: { clientX: x, clientY: y },
  });
}

async function setup(user: Parameters<typeof signedIn>[0]) {
  const { fake, runtime } = await signedIn(user);
  fake.people = PEOPLE;
  await renderRoster(runtime);
  await screen.findByTestId("people-ladder-card-14");
  await layoutColumns();
  return fake;
}

describe("the Ladder drag", () => {
  beforeEach(() => {
    resetFakeRouter();
    mockReduced = false;
    mockWithSpring.mockClear();
  });

  it("a drop on an allowed column calls setRole once and opens nothing", async () => {
    const fake = await setup({ admin: true });
    const preventDefault = await pickUp(14, {
      x: columnX(ParticipationType.VOLUNTEER),
      y: 60,
    });
    // The grip cancels the compat mousedown that would start a text selection.
    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByTestId("people-drag-ghost")).toBeOnTheScreen();

    await dragTo(columnX(ParticipationType.PUBLIC), 100);

    await waitFor(() => expect(fake.setParticipationRequests).toHaveLength(1));
    expect(fake.setParticipationRequests[0]).toMatchObject({
      personId: 14,
      participationType: ParticipationType.PUBLIC,
    });
    // A hard cut: the ghost is gone at once, no spring, and no card opened.
    expect(screen.queryByTestId("people-drag-ghost")).toBeNull();
    expect(mockWithSpring).not.toHaveBeenCalled();
    expect(screen.queryByTestId("people-hovercard-14")).toBeNull();
    // The click that follows a drag's release is swallowed, not a card press.
    await fireEvent.press(screen.getByTestId("people-ladder-card-14"));
    expect(screen.queryByTestId("people-hovercard-14")).toBeNull();
    await screen.findByText("Public · 1");
  });

  it("a drop on a dimmed column calls nothing and springs the ghost home", async () => {
    // An inviter's ceiling stops below FC/BUM: that column dims for the drag.
    const fake = await setup({ inviteReporters: true });
    await pickUp(13, { x: columnX(ParticipationType.REPORTER), y: 60 });
    await dragTo(columnX(ParticipationType.WRITER), 100);

    expect(fake.setParticipationRequests).toHaveLength(0);
    expect(mockWithSpring).toHaveBeenCalledWith(0, {
      duration: 400,
      dampingRatio: 0.8,
    });
    expect(screen.queryByTestId("people-hovercard-13")).toBeNull();
  });

  it("a drop outside every column calls nothing", async () => {
    const fake = await setup({ admin: true });
    await pickUp(14, { x: columnX(ParticipationType.VOLUNTEER), y: 60 });
    await dragTo(5000, 5000);
    expect(fake.setParticipationRequests).toHaveLength(0);
    expect(mockWithSpring).toHaveBeenCalled();
  });

  it("under reduced motion the ghost clears without a spring", async () => {
    mockReduced = true;
    const fake = await setup({ inviteReporters: true });
    await pickUp(13, { x: columnX(ParticipationType.REPORTER), y: 60 });
    await dragTo(columnX(ParticipationType.WRITER), 100);

    expect(fake.setParticipationRequests).toHaveLength(0);
    expect(mockWithSpring).not.toHaveBeenCalled();
    expect(screen.queryByTestId("people-drag-ghost")).toBeNull();
    expect(screen.queryByTestId("people-drag-overlay")).toBeNull();
  });

  it("there is no grip on a card the viewer may not move", async () => {
    await setup({ inviteReporters: true });
    expect(screen.queryByTestId("people-ladder-card-11-grip")).toBeNull();
    expect(screen.getByTestId("people-ladder-card-13-grip")).toBeOnTheScreen();
  });
});
