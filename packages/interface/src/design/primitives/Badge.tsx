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

import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// Badge: a small pill with a tone — the state / priority / private markers on
// a row (plan 09l F14). The state colour language proper comes with D0.

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge(props: BadgeProps) {
  const { label, tone = "neutral" } = props;
  const theme = useTheme();
  const background =
    tone === "neutral" ? theme.colors.surfaceRaised : theme.colors[tone];
  const color = tone === "neutral" ? "text" : "onTone";
  return (
    <View
      accessibilityRole="text"
      style={{
        alignSelf: "flex-start",
        backgroundColor: background,
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}
