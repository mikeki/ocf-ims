//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { TextStyle } from "react-native";

// The design tokens (plan 09i E10, 09l F14). This file is the contract between
// design and code: D0 (Claude Design, slice 3a.4) replaces the VALUES; the
// shape — colour roles, a spacing scale, radii, a type scale — is what the
// primitives consume. Nothing outside src/design/ writes a colour, spacing or
// font-size literal.

export type ColorScheme = "light" | "dark";

export interface ColorRoles {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly border: string;
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
}

export const colors: Readonly<Record<ColorScheme, ColorRoles>> = {
  light: {
    background: "#F7F7F5",
    surface: "#FFFFFF",
    surfaceRaised: "#EFEFEC",
    border: "#D9D9D4",
    text: "#1B1B1A",
    textMuted: "#5F5F5B",
    primary: "#2F6B4F",
    onPrimary: "#FFFFFF",
    danger: "#B3261E",
    onDanger: "#FFFFFF",
    success: "#2F6B4F",
    warning: "#9A6700",
    info: "#2B5C8A",
    onTone: "#FFFFFF",
  },
  dark: {
    background: "#141514",
    surface: "#1E201E",
    surfaceRaised: "#2A2C2A",
    border: "#3A3D3A",
    text: "#F1F1EE",
    textMuted: "#A9ABA6",
    primary: "#7FC29B",
    onPrimary: "#0F1F17",
    danger: "#F2B8B5",
    onDanger: "#3A0B09",
    success: "#7FC29B",
    warning: "#E3B341",
    info: "#8AB8E6",
    onTone: "#0F0F0F",
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type Spacing = keyof typeof spacing;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export type Radius = keyof typeof radii;

export type TypeVariant = "title" | "heading" | "body" | "label" | "caption";

export const typeScale: Readonly<
  Record<TypeVariant, Pick<TextStyle, "fontSize" | "lineHeight" | "fontWeight">>
> = {
  title: { fontSize: 24, lineHeight: 30, fontWeight: "600" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  label: { fontSize: 14, lineHeight: 18, fontWeight: "500" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
};

/** Minimum touch target (Apple HIG / Material). */
export const touchTarget = 44;
