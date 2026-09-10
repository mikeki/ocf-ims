// SPDX-License-Identifier: Apache-2.0

import type { ViewProps, ViewStyle } from "react-native";
import { View } from "react-native";
import { useTheme } from "@/design/theme";
import type { ColorRoles, Radius, Spacing } from "@/design/tokens";

// Box: a View that takes its spacing, background and radius from the tokens
// (plan 09l F14), so layout code never writes a pixel literal.

export interface BoxProps extends ViewProps {
  p?: Spacing;
  px?: Spacing;
  py?: Spacing;
  gap?: Spacing;
  row?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  bg?: keyof ColorRoles;
  radius?: Radius;
  flex?: number;
}

export function Box(props: BoxProps) {
  const {
    p,
    px,
    py,
    gap,
    row,
    align,
    justify,
    bg,
    radius,
    flex,
    style,
    ...rest
  } = props;
  const theme = useTheme();
  const computed: ViewStyle = {
    flexDirection: row ? "row" : "column",
    alignItems: align,
    justifyContent: justify,
    padding: p === undefined ? undefined : theme.spacing[p],
    paddingHorizontal: px === undefined ? undefined : theme.spacing[px],
    paddingVertical: py === undefined ? undefined : theme.spacing[py],
    gap: gap === undefined ? undefined : theme.spacing[gap],
    backgroundColor: bg === undefined ? undefined : theme.colors[bg],
    borderRadius: radius === undefined ? undefined : theme.radii[radius],
    flex,
  };
  return <View {...rest} style={[computed, style]} />;
}
