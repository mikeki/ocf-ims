// SPDX-License-Identifier: Apache-2.0

import { Switch, View } from "react-native";
import type { AppError } from "@/api/errors";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { FieldError } from "@/features/incidents/controls/bits";

// The private toggle (plan 09y § Gating): enabled for an admin or the
// creator, with templ's copy on it; disabled it keeps its place and its
// copy, so a reader sees why the incident is restricted.

export const PRIVATE_COPY =
  "When private, only admins, the incident's creator, and people granted per-incident access can see this incident.";

export interface PrivateToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** An admin or the creator, with the write bit. */
  enabled: boolean;
  error?: AppError;
  /** The copy beneath; on by default. */
  copy?: boolean;
}

export function PrivateToggle(props: PrivateToggleProps) {
  const { value, onChange, enabled, copy = true } = props;
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.md,
          minHeight: theme.spacing.xxl,
        }}
      >
        <Switch
          accessibilityLabel="Private"
          value={value}
          onValueChange={onChange}
          disabled={!enabled}
          trackColor={{
            true: theme.colors.restricted,
            false: theme.colors.borderStrong,
          }}
          thumbColor={theme.colors.surface}
          testID="private-toggle"
        />
        <Text variant="label" color={enabled ? "text" : "textMuted"}>
          {value ? "Private" : "Not private"}
        </Text>
      </View>
      {copy ? (
        <Text variant="caption" color="textMuted">
          {enabled
            ? PRIVATE_COPY
            : `${PRIVATE_COPY} Only an admin or the creator can change this.`}
        </Text>
      ) : null}
      <FieldError error={props.error} />
    </View>
  );
}
