// SPDX-License-Identifier: Apache-2.0

import { AccountBody } from "@/prototypes/reports/accountParts";
import type { ReportPaneProps } from "@/prototypes/reports/types";

// Variant (docs/plans/09z-reports-design.md § The prototype round,
// "Account"): the report as a document, read start to end — a title, a
// byline, one thin controls strip (the incident link, Edit summary, History
// / Stricken), the entries as dated paragraphs oldest first with no card
// chrome and no row borders, the composer at the end. The body itself lives
// in accountParts.tsx so Companion's left column renders the exact same
// thing (see that file's header note for the two findings it hit).

export function Account(props: ReportPaneProps) {
  return <AccountBody {...props} />;
}
