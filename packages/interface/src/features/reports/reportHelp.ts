// SPDX-License-Identifier: Apache-2.0

/** The report table's `?` sheet rows; `n` only appears when it is bound (`writeReports`). */
export function reportHelpRows(writeReports: boolean): [string, string][] {
  return [
    ["/", "Focus the search"],
    [
      "Enter (in search)",
      "A bare number opens that report; otherwise focus the table",
    ],
    ["j / ↓  ·  k / ↑", "Move the selection"],
    [
      "Enter",
      "Open the selected report; in the drawer, again for the full page",
    ],
    ["Esc", "Close · clear the selection · clear the search"],
    ["a", "Focus the composer (drawer or page open)"],
    ["h", "Toggle history entries (drawer or page open)"],
    ...(writeReports ? ([["n", "New report"]] as [string, string][]) : []),
    ["?", "This sheet"],
  ];
}
