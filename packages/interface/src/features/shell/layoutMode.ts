// SPDX-License-Identifier: Apache-2.0

import { useWindowDimensions } from "react-native";
import { wideBreakpoint } from "@/design/tokens";

// One decision, one place (plan 09x criterion 1): every screen that branches
// on window width reads this, and only this, so a phone and a wide window
// never drift out of sync on where the line is.

export type LayoutMode = "wide" | "phone";

export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  return width >= wideBreakpoint ? "wide" : "phone";
}
