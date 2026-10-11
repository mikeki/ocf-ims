// SPDX-License-Identifier: Apache-2.0
import { createContext } from "react";

// The person whose role menu is open. A FlatList's CellRendererComponent must keep
// one identity (a new one remounts every cell and closes the menu), so the cell
// reads the open row from here rather than from a closure.
export const OpenMenuContext = createContext<number | undefined>(undefined);
