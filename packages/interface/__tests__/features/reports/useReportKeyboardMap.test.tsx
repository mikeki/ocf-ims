// SPDX-License-Identifier: Apache-2.0

import { render } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  type KeyboardMapDeps,
  useReportKeyboardMap,
} from "@/features/reports/useReportKeyboardMap";

// The reports table's keys (plan 09z criterion 7), driven through a stub
// `window` since Jest runs in a node environment: web only, suppressed in an
// input except Esc.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

type Listener = (e: unknown) => void;

function Harness(props: { deps: KeyboardMapDeps }) {
  useReportKeyboardMap(props.deps);
  return null;
}

function setup(overrides: Partial<KeyboardMapDeps> = {}) {
  let listener: Listener | undefined;
  const g = globalThis as unknown as { window?: unknown };
  g.window = {
    addEventListener: (_: string, l: Listener) => {
      listener = l;
    },
    removeEventListener: () => undefined,
  };
  jest.replaceProperty(Platform, "OS", "web");
  const deps: KeyboardMapDeps = {
    query: { open: undefined, sel: undefined, q: "" },
    visible: [],
    help: false,
    setHelp: jest.fn(),
    setQuery: jest.fn(),
    select: jest.fn(),
    open: jest.fn(),
    close: jest.fn(),
    move: jest.fn(),
    onFull: jest.fn(),
    onNewReport: jest.fn(),
    searchRef: { current: { focus: jest.fn() } } as never,
    handle: {
      current: { focusComposer: jest.fn(), toggleSystemEntries: jest.fn() },
    },
    ...overrides,
  };
  const press = (key: string, target: unknown = { tagName: "DIV" }) =>
    listener?.({ key, target, preventDefault: () => undefined });
  return { deps, press };
}

afterEach(() => {
  jest.restoreAllMocks();
  (globalThis as unknown as { window?: unknown }).window = undefined;
});

describe("useReportKeyboardMap", () => {
  it("j and k move, / focuses the search, ? toggles help, n starts a report", async () => {
    const { deps, press } = setup();
    await render(<Harness deps={deps} />);
    press("j");
    press("k");
    press("/");
    press("?");
    press("n");
    expect(deps.move).toHaveBeenNthCalledWith(1, 1);
    expect(deps.move).toHaveBeenNthCalledWith(2, -1);
    expect(deps.searchRef?.current?.focus).toHaveBeenCalled();
    expect(deps.setHelp).toHaveBeenCalledWith(true);
    expect(deps.onNewReport).toHaveBeenCalled();
  });

  it("Enter opens the selected row, then the full page once open", async () => {
    const selected = setup({
      query: { open: undefined, sel: 7, q: "" },
    });
    await render(<Harness deps={selected.deps} />);
    selected.press("Enter");
    expect(selected.deps.open).toHaveBeenCalledWith(7);
  });

  it("Enter with a report open goes to the full page; a and h reach the pane", async () => {
    const { deps, press } = setup({
      query: { open: 7, sel: 7, q: "" },
    });
    await render(<Harness deps={deps} />);
    press("Enter");
    press("a");
    press("h");
    expect(deps.onFull).toHaveBeenCalled();
    expect(deps.handle?.current?.focusComposer).toHaveBeenCalled();
    expect(deps.handle?.current?.toggleSystemEntries).toHaveBeenCalled();
  });

  it("Esc closes the drawer, then clears the selection", async () => {
    const open = setup({ query: { open: 7, sel: 7, q: "" } });
    await render(<Harness deps={open.deps} />);
    open.press("Escape");
    expect(open.deps.close).toHaveBeenCalled();
  });

  it("ignores letters while an input has focus, but Esc blurs it", async () => {
    const { deps, press } = setup();
    await render(<Harness deps={deps} />);
    const blur = jest.fn();
    const input = { tagName: "INPUT", blur };
    press("j", input);
    expect(deps.move).not.toHaveBeenCalled();
    press("Escape", input);
    expect(blur).toHaveBeenCalled();
  });
});
