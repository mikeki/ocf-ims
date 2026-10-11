// SPDX-License-Identifier: Apache-2.0

// The roster's rows for the shared `HelpSheet` (09x criterion 11, 09aa §
// Keyboard): no `a`/`h` (a person has no composer or journal). `n` is listed
// only when it is bound, i.e. when the viewer may add a person.

export function peopleHelpRows(canAdd: boolean): [string, string][] {
  return [
    ["/", "Focus the search"],
    ["j / ↓  ·  k / ↑", "Move the selection"],
    ["Enter", "Open (pin) the selected person's card"],
    ["Esc", "Close · clear the selection · clear the search"],
    ...(canAdd ? ([["n", "Add person"]] as [string, string][]) : []),
    ["Drag", "Drag a card by its grip, or Move to…"],
    ["?", "This sheet"],
  ];
}

/** The full set, `n` included — the roster is reachable only by someone who may add. */
export const PEOPLE_HELP_ROWS: [string, string][] = peopleHelpRows(true);
