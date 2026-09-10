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
