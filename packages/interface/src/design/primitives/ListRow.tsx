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

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { touchTarget } from "@/design/tokens";

// ListRow: title, optional subtitle, an optional accessory on the right
// (a Badge, a count), pressable when given onPress (plan 09l F14). The events
// and incidents lists (3a.3) are made of these.

export interface ListRowProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

export function ListRow(props: ListRowProps) {
  const theme = useTheme();
  const content = (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.md,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
      ]}
    >
      <View style={styles.text}>
        <Text variant="body" numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={2}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.right ? <View>{props.right}</View> : null}
    </View>
  );
  if (!props.onPress) {
    return content;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      testID={props.testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flex: 1,
  },
});
