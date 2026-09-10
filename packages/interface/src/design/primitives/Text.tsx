// SPDX-License-Identifier: Apache-2.0

import type { TextProps as RNTextProps } from "react-native";
import { Text as RNText } from "react-native";
import { useTheme } from "@/design/theme";
import type { ColorRoles, TypeVariant } from "@/design/tokens";

// Text: the type scale and the colour roles, nothing else (plan 09l F14).

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: keyof ColorRoles;
  align?: "left" | "center" | "right";
}

export function Text(props: TextProps) {
  const { variant = "body", color = "text", align, style, ...rest } = props;
  const theme = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        theme.type[variant],
        { color: theme.colors[color], textAlign: align },
        style,
      ]}
    />
  );
}
