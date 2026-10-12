// SPDX-License-Identifier: Apache-2.0

import { render } from "@testing-library/react-native";
import { Platform } from "react-native";
import {
  type PeopleKeyboardMapDeps,
  usePeopleKeyboardMap,
} from "@/features/people/usePeopleKeyboardMap";

// The roster's keys (09aa criterion 12): the overlay stack on Esc is the
// panel, then the hovercard, then the selection, then the search; `n`
// preventDefaults so it never types into the panel's search field.

jest.mock("expo-router", () => require("@/test/fakeRouter"));

type Listener = (e: unknown) => void;

function Harness(props: { deps: PeopleKeyboardMapDeps }) {
  usePeopleKeyboardMap(props.deps);
  return null;
}

function setup(overrides: Partial<PeopleKeyboardMapDeps> = {}) {
  let listener: Listener | undefined;
  const g = globalThis as unknown as { window?: unknown };
  g.window = {
    addEventListener: (_: string, l: Listener) => {
      listener = l;
    },
    removeEventListener: () => undefined,
  };
  jest.replaceProperty(Platform, "OS", "web");
  const deps: PeopleKeyboardMapDeps = {
    order: [1, 2, 3],
    query: { open: undefined, sel: undefined, q: "" },
    help: false,
    setHelp: jest.fn(),
    setQuery: jest.fn(),
    select: jest.fn(),
    open: jest.fn(),
    close: jest.fn(),
    onAddPerson: jest.fn(),
    searchRef: { current: { focus: jest.fn() } } as never,
    panel: false,
    closePanel: jest.fn(),
    ...overrides,
  };
  const preventDefault = jest.fn();
  const press = (key: string, target: unknown = { tagName: "DIV" }) =>
    listener?.({ key, target, preventDefault });
  return { deps, press, preventDefault };
}

afterEach(() => {
  jest.restoreAllMocks();
  (globalThis as unknown as { window?: unknown }).window = undefined;
});

describe("usePeopleKeyboardMap", () => {
  it("Esc closes the panel first, whatever else is open", async () => {
    const { deps, press } = setup({
      panel: true,
      query: { open: 2, sel: 2, q: "x" },
    });
    await render(<Harness deps={deps} />);
    press("Escape");
    expect(deps.closePanel).toHaveBeenCalledTimes(1);
    expect(deps.close).not.toHaveBeenCalled();
    expect(deps.select).not.toHaveBeenCalled();
  });

  it("then the hovercard, then the selection, then the search", async () => {
    const a = setup({ query: { open: 2, sel: 2, q: "x" } });
    await render(<Harness deps={a.deps} />);
    a.press("Escape");
    expect(a.deps.close).toHaveBeenCalledTimes(1);
    expect(a.deps.select).not.toHaveBeenCalled();

    const b = setup({ query: { open: undefined, sel: 2, q: "x" } });
    await render(<Harness deps={b.deps} />);
    b.press("Escape");
    expect(b.deps.select).toHaveBeenCalledWith(undefined);
    expect(b.deps.setQuery).not.toHaveBeenCalled();

    const c = setup({ query: { open: undefined, sel: undefined, q: "x" } });
    await render(<Harness deps={c.deps} />);
    c.press("Escape");
    expect(c.deps.setQuery).toHaveBeenCalledWith({ q: "" });
  });

  it("n preventDefaults and adds a person, except while the panel is open", async () => {
    const { deps, press, preventDefault } = setup();
    await render(<Harness deps={deps} />);
    press("n");
    expect(preventDefault).toHaveBeenCalled();
    expect(deps.onAddPerson).toHaveBeenCalledTimes(1);

    const open = setup({ panel: true });
    await render(<Harness deps={open.deps} />);
    open.press("n");
    expect(open.deps.onAddPerson).not.toHaveBeenCalled();
  });

  it("j and k walk the order, and walk from a pinned card", async () => {
    const a = setup({ query: { open: undefined, sel: 1, q: "" } });
    await render(<Harness deps={a.deps} />);
    a.press("j");
    expect(a.deps.select).toHaveBeenCalledWith(2);

    const b = setup({ query: { open: 2, sel: 2, q: "" } });
    await render(<Harness deps={b.deps} />);
    b.press("k");
    expect(b.deps.open).toHaveBeenCalledWith(1);
  });
});
