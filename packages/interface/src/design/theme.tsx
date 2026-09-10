// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import {
  type ColorRoles,
  type ColorScheme,
  colors,
  type Elevation,
  type ElevationLevel,
  elevation,
  motion,
  radii,
  spacing,
  typeScale,
} from "@/design/tokens";

// The theme a primitive reads (plan 09l F14, extended by D0 in 09o): the
// colour roles and the elevation for the current scheme, plus the scales.
// The scheme follows the OS (app.json userInterfaceStyle: automatic);
// ThemeProvider's `scheme` overrides it for tests and, later, a user
// preference.

export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: ColorRoles;
  readonly spacing: typeof spacing;
  readonly radii: typeof radii;
  readonly type: typeof typeScale;
  /** Scheme-aware: a dark scheme needs a heavier shadow to read at all. */
  readonly elevation: Readonly<Record<ElevationLevel, Elevation>>;
  readonly motion: typeof motion;
}

export function themeFor(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: colors[scheme],
    spacing,
    radii,
    type: typeScale,
    elevation: elevation[scheme],
    motion,
  };
}

const ThemeContext = createContext<Theme | undefined>(undefined);

export interface ThemeProviderProps {
  scheme?: ColorScheme;
  children: ReactNode;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const system = useColorScheme();
  const scheme: ColorScheme =
    props.scheme ?? (system === "dark" ? "dark" : "light");
  const theme = useMemo(() => themeFor(scheme), [scheme]);
  return (
    <ThemeContext.Provider value={theme}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme() needs a <ThemeProvider> above it");
  }
  return theme;
}
