// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { act, cleanup, fireEvent, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { resetFakeRouter } from "@/test/fakeRouter";
import { makePerson } from "@/test/fixtures";
import {
  renderRoster,
  setRect,
  signedIn,
  type TestRect,
} from "@/test/rosterLayout";

// The Ladder's hovercard (09aa criterion 11) on fake timers: opens after
// stateFade x 1.5 (300 ms) of hover, closes x 0.75 (150 ms) after the
// pointer has left, a press pins it. Esc and an outside press are web
// listeners, driven through a stub `window` (Jest runs in node).

jest.mock("expo-router", () => require("@/test/fakeRouter"));

const OPEN_MS = 300;
const CLOSE_MS = 150;
const CARD: TestRect = { x: 0, y: 40, width: 180, height: 80 };

type Listener = (e: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function installWindow() {
  listeners.clear();
  (globalThis as unknown as { window?: unknown }).window = {
    addEventListener: (type: string, l: Listener) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(l);
    },
    removeEventListener: (type: string, l: Listener) => {
      listeners.get(type)?.delete(l);
    },
  };
  jest.replaceProperty(Platform, "OS", "web");
}

async function dispatch(type: string, event: object) {
  await act(async () => {
    for (const l of listeners.get(type) ?? []) {
      l({ preventDefault: () => undefined, ...event });
    }
  });
}

const key = async (k: string) =>
  dispatch("keydown", { key: k, target: { tagName: "DIV" } });

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function setup() {
  const { fake, runtime } = await signedIn({ admin: true });
  fake.people = [
    makePerson({
      personId: 13,
      handle: "rita",
      name: "Rita Reporter",
      participationType: ParticipationType.REPORTER,
    }),
  ];
  await renderRoster(runtime);
  await screen.findByTestId("people-ladder-card-13");
  setRect("people-ladder-card-13", CARD);
  jest.useFakeTimers();
}

const card = () => screen.getByTestId("people-ladder-card-13");
const hovercard = () => screen.queryByTestId("people-hovercard-13");

describe("Hovercard", () => {
  beforeEach(() => {
    resetFakeRouter();
  });
  afterEach(async () => {
    // Unmount first: the screen's effect cleanups still need the stub window.
    await cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
    (globalThis as unknown as { window?: unknown }).window = undefined;
  });

  it("opens after the hover delay, not before", async () => {
    await setup();
    await fireEvent(card(), "hoverIn");
    await advance(OPEN_MS - 1);
    expect(hovercard()).toBeNull();
    await advance(1);
    expect(hovercard()).toBeOnTheScreen();
  });

  it("closes after the pointer leaves, and stays while it is over the popover", async () => {
    await setup();
    await fireEvent(card(), "hoverIn");
    await advance(OPEN_MS);
    expect(hovercard()).toBeOnTheScreen();

    await fireEvent(card(), "hoverOut");
    await advance(CLOSE_MS - 1);
    expect(hovercard()).toBeOnTheScreen();
    await advance(1);
    expect(hovercard()).toBeNull();

    // Leaving the card for the popover keeps it open.
    await fireEvent(card(), "hoverIn");
    await advance(OPEN_MS);
    await fireEvent(card(), "hoverOut");
    await fireEvent(screen.getByTestId("people-hovercard-13"), "pointerEnter");
    await advance(CLOSE_MS * 4);
    expect(hovercard()).toBeOnTheScreen();
    await fireEvent(screen.getByTestId("people-hovercard-13"), "pointerLeave");
    await advance(CLOSE_MS);
    expect(hovercard()).toBeNull();
  });

  it("a press pins it, and the pin survives the pointer leaving", async () => {
    await setup();
    await fireEvent(card(), "hoverIn");
    await advance(OPEN_MS);
    await fireEvent.press(card());
    await fireEvent(card(), "hoverOut");
    await advance(CLOSE_MS * 10);
    expect(hovercard()).toBeOnTheScreen();
  });

  it("a press inside the hover delay stays pinned", async () => {
    await setup();
    await fireEvent(card(), "hoverIn");
    await advance(OPEN_MS / 3);
    await fireEvent.press(card());
    expect(hovercard()).toBeOnTheScreen();
    // The pending hover must not fire afterwards and downgrade the pin.
    await advance(OPEN_MS * 2);
    await fireEvent(card(), "hoverOut");
    await advance(CLOSE_MS * 10);
    expect(hovercard()).toBeOnTheScreen();
  });

  it("Esc closes a pinned card", async () => {
    installWindow();
    await setup();
    await fireEvent.press(card());
    expect(hovercard()).toBeOnTheScreen();
    await key("Escape");
    expect(hovercard()).toBeNull();
  });

  it("a press outside closes it, a press on the card does not", async () => {
    installWindow();
    await setup();
    await fireEvent.press(card());
    await dispatch("pointerdown", { clientX: 10, clientY: 60 });
    expect(hovercard()).toBeOnTheScreen();
    await dispatch("pointerdown", { clientX: 900, clientY: 700 });
    expect(hovercard()).toBeNull();
  });
});
