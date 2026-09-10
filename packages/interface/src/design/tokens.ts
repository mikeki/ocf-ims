// SPDX-License-Identifier: Apache-2.0

import type { TextStyle, ViewStyle } from "react-native";

// The design tokens (plan 09i E10, 09l F14, D0 in 09o). This file is the
// contract between design and code: D0 fixed the VALUES; the shape — colour
// roles, a spacing scale, radii, a type scale, elevation, motion — is what
// the primitives consume. Nothing outside src/design/ writes a colour,
// spacing, font-size or duration literal.
//
// The direction is "Dispatch" (09o route B, chosen 2026-09-10): dense, cool
// and tabular — a list built to be scanned, not decorated. See DESIGN.md for
// the why, the colour language and what was deliberately left undone.

export type ColorScheme = "light" | "dark";

export interface ColorRoles {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  /** Below the surface: a well, a table head, an inset. */
  readonly surfaceSunken: string;
  /** A decorative separator. Never the only thing carrying a boundary. */
  readonly border: string;
  /** A boundary that must be perceivable: a control, a field, a focus ring. */
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly danger: string;
  readonly onDanger: string;
  readonly success: string;
  readonly warning: string;
  readonly info: string;
  readonly onTone: string;
  /** "Private" — restricted, and distinct from every state and priority hue. */
  readonly restricted: string;
  readonly onRestricted: string;
  readonly focus: string;
  readonly overlay: string;
}

export const colors: Readonly<Record<ColorScheme, ColorRoles>> = {
  light: {
    background: "#F2F4F7",
    surface: "#FFFFFF",
    surfaceRaised: "#E9EDF2",
    surfaceSunken: "#E1E6EC",
    border: "#D3D9E0",
    borderStrong: "#6F7C8B",
    text: "#141A21",
    textMuted: "#566270",
    primary: "#2457A6",
    onPrimary: "#FFFFFF",
    danger: "#B42318",
    onDanger: "#FFFFFF",
    success: "#1B6E45",
    warning: "#93520A",
    info: "#0A667F",
    onTone: "#FFFFFF",
    restricted: "#6D28D9",
    onRestricted: "#FFFFFF",
    focus: "#2457A6",
    overlay: "rgba(20, 26, 33, 0.45)",
  },
  dark: {
    background: "#0D1117",
    surface: "#161B22",
    surfaceRaised: "#1F262E",
    surfaceSunken: "#090C10",
    border: "#2A323C",
    borderStrong: "#6B7684",
    text: "#E6EDF3",
    textMuted: "#98A4B3",
    primary: "#79B1F5",
    onPrimary: "#06213F",
    danger: "#FF8B84",
    onDanger: "#3F0806",
    success: "#6FD39A",
    warning: "#F0B94D",
    info: "#5ED3E6",
    onTone: "#071014",
    restricted: "#C9A6F5",
    onRestricted: "#23093F",
    focus: "#79B1F5",
    overlay: "rgba(0, 0, 0, 0.55)",
  },
};

export const spacing = {
  xs: 2,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
} as const;

export type Spacing = keyof typeof spacing;

// One radius language with hierarchy: a badge is a pill, a control is `md`,
// a container is `lg`, an inset mark is `sm`.
export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  pill: 999,
} as const;

export type Radius = keyof typeof radii;

/** `figure` is the incident number: tabular, so a column of them aligns. */
export type TypeVariant =
  | "title"
  | "heading"
  | "body"
  | "label"
  | "caption"
  | "figure";

export type TypeStep = Pick<
  TextStyle,
  "fontSize" | "lineHeight" | "fontWeight" | "letterSpacing" | "fontVariant"
>;

// The platform system font throughout — no face is shipped. Tracking is
// tightened on the large steps and left alone on body and below.
export const typeScale: Readonly<Record<TypeVariant, TypeStep>> = {
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  body: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 16, fontWeight: "500", letterSpacing: 0 },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
    letterSpacing: 0,
  },
  figure: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
  },
};

export type ElevationLevel = 0 | 1 | 2;

/**
 * One token, three renderings: `boxShadow` covers iOS and web (React Native
 * 0.76+ maps it to the native shadow), `elevation` is Android's own. Level 0
 * is flat — this direction separates with rules and tone, not with shadow.
 */
export interface Elevation {
  readonly boxShadow?: ViewStyle["boxShadow"];
  readonly elevation: number;
}

export const elevation: Readonly<
  Record<ColorScheme, Readonly<Record<ElevationLevel, Elevation>>>
> = {
  light: {
    0: { elevation: 0 },
    1: { boxShadow: "0 1px 2px rgba(20, 26, 33, 0.10)", elevation: 1 },
    2: { boxShadow: "0 4px 12px rgba(20, 26, 33, 0.14)", elevation: 3 },
  },
  dark: {
    0: { elevation: 0 },
    1: { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.40)", elevation: 1 },
    2: { boxShadow: "0 4px 12px rgba(0, 0, 0, 0.52)", elevation: 3 },
  },
};

/**
 * The motion budget (plan 09o § Motion and feel). Rows and buttons are
 * pressed dozens of times a session, so the only feedback is a
 * near-imperceptible press scale; `stateFade` is for an empty or error body
 * the person waited for. Both are dropped under reduced motion.
 */
export const motion = {
  /** Press-in scale on anything pressable. */
  pressScale: 0.97,
  /** The press transition, in ms. */
  pressDuration: 120,
  /** An empty / error state fading in, in ms. */
  stateFade: 200,
  /** Strong ease-out. The only curve; never ease-in. */
  easeOut: [0.23, 1, 0.32, 1],
} as const;

/** A drifting finger must not cancel a press. */
export const pressRetentionOffset = {
  top: 20,
  bottom: 20,
  left: 20,
  right: 20,
} as const;

/** Minimum touch target (Apple HIG / Material). */
export const touchTarget = 44;
