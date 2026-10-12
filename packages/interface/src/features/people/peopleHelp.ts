// SPDX-License-Identifier: Apache-2.0

// The roster's rows for the shared `HelpSheet` (09x criterion 11, 09aa §
// Keyboard): no `a`/`h` (a person has no composer or journal). The roster is
// reachable only by someone who may add a person, so `n` is always listed.

export function peopleHelpRows(): [string, string][] {
  return [
    ["/", "Focus the search"],
    ["j / ↓  ·  k / ↑", "Move the selection"],
    ["Enter", "Open (pin) the selected person's card"],
    ["Esc", "Close · clear the selection · clear the search"],
    ["n", "Add person"],
    ["Drag", "Drag a card by its grip, or Move to…"],
    ["?", "This sheet"],
  ];
}
