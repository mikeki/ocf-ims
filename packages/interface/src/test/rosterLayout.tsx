// SPDX-License-Identifier: Apache-2.0

import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { fireEvent, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Dimensions } from "react-native";
import { PeopleScreen } from "@/features/people/PeopleScreen";
import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import { createTestRuntime, renderWithProviders } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The roster's Jest helpers (09aa). react-native's Jest preset gives every
// View a `measureInWindow` that never calls back and RNTL never fires
// `onLayout`, so the Ladder's geometry (the card, the columns, the stage) is
// stated by the test: `setRect` programs one host's measurement, and
// `layoutColumns` lays the five columns side by side.

export interface TestRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every mocked View shares one `measureInWindow`, so it answers by the
// calling instance's testID.
const rects = new Map<string, TestRect>();
let installed = false;

function install(): void {
  if (installed) {
    return;
  }
  installed = true;
  const natives = require("@react-native/jest-preset/jest/MockNativeMethods")
    .default as { measureInWindow: jest.Mock };
  natives.measureInWindow.mockImplementation(function (
    this: { props?: { testID?: string } },
    cb: (x: number, y: number, w: number, h: number) => void,
  ) {
    const rect = rects.get(this?.props?.testID ?? "");
    if (rect) {
      cb(rect.x, rect.y, rect.width, rect.height);
    }
  });
}

export function setRect(testID: string, rect: TestRect): void {
  install();
  rects.set(testID, rect);
}

const COLUMN_RUNGS = [
  ParticipationType.WRITER,
  ParticipationType.CREW_LEADER,
  ParticipationType.REPORTER,
  ParticipationType.VOLUNTEER,
  ParticipationType.PUBLIC,
];

export const COLUMN_WIDTH = 200;
export const COLUMN_HEIGHT = 800;

/** Column `i` spans x in [i * 200, i * 200 + 200), the whole stage 1000 x 800 at the origin. */
export async function layoutColumns(): Promise<void> {
  setRect("people-stage", {
    x: 0,
    y: 0,
    width: COLUMN_WIDTH * COLUMN_RUNGS.length,
    height: COLUMN_HEIGHT,
  });
  await fireEvent(screen.getByTestId("people-stage"), "layout");
  for (const [i, rung] of COLUMN_RUNGS.entries()) {
    const id = `people-column-${rung}`;
    setRect(id, {
      x: i * COLUMN_WIDTH,
      y: 0,
      width: COLUMN_WIDTH,
      height: COLUMN_HEIGHT,
    });
    await fireEvent(screen.getByTestId(id), "layout");
  }
}

/** Slides every column's stubbed rect by `dx`, as a sideways scroll of the Ladder would; nothing is re-laid-out. */
export function shiftColumns(dx: number): void {
  for (const [i, rung] of COLUMN_RUNGS.entries()) {
    setRect(`people-column-${rung}`, {
      x: i * COLUMN_WIDTH + dx,
      y: 0,
      width: COLUMN_WIDTH,
      height: COLUMN_HEIGHT,
    });
  }
}

/** The x at the middle of the column holding `rung`. */
export function columnX(rung: ParticipationType): number {
  return COLUMN_RUNGS.indexOf(rung) * COLUMN_WIDTH + COLUMN_WIDTH / 2;
}

/** A signed-in runtime over `fake`; `user` overrides who is signed in. */
export async function signedIn(user: Partial<FakeUser> = {}): Promise<{
  fake: FakeIms;
  runtime: ReturnType<typeof createTestRuntime>;
}> {
  const fake = createFakeIms({ user });
  fake.events = [{ id: 1, name: "2026" }];
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return { fake, runtime };
}

export function renderRoster(
  runtime: ReturnType<typeof createTestRuntime>,
  ui: ReactElement = <PeopleScreen eventId={1} />,
) {
  return renderWithProviders(ui, runtime);
}

/** Makes the window wide (the route's gate), returns the restore. */
export function wideWindow(width = 1440): () => void {
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 });
  return () => spy.mockRestore();
}
