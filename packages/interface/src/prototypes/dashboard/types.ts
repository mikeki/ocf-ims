// SPDX-License-Identifier: Apache-2.0

import type { Metrics } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/metrics_pb";
import type { ChangedKey } from "@/prototypes/dashboard/useMetrics";

// The shape every variant (Board / Tables / Shift) renders from — layout is
// the only thing that differs between them (docs/plans/09ab-dashboard-design.md
// § The prototype round).

export interface DashboardPaneProps {
  metrics: Metrics;
  changedKeys: ReadonlySet<ChangedKey>;
  onOpenFollowUp: (incidentNumber: number) => void;
}
