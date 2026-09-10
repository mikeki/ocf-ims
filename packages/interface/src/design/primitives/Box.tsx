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
