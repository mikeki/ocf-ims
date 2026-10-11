// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import {
  AUTO_REFRESH_OPTIONS,
  type AutoRefresh,
} from "@/prototypes/dashboard/useAutoRefresh";

// The refresh model's toolbar (docs/plans/09ab-dashboard-design.md § The
// refresh model): Refresh, "Updated n min ago" (its own 30 s clock — the
// brief's own number, distinct from the rest of the app's one-minute clock),
// the auto-refresh chips, and a failed refetch's "Couldn't refresh — Retry"
// in place of the freshness line. The numbers on the page never blank for
// this — `useMetrics` keeps the previous frame itself.

const CLOCK_TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function updatedLabel(generatedAtMs: number | undefined, now: number): string {
  if (generatedAtMs === undefined) {
    return "—";
  }
  const minutes = Math.max(0, Math.floor((now - generatedAtMs) / 60_000));
  return minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`;
}

export interface ToolbarProps {
  generatedAtMs: number | undefined;
  isRefreshing: boolean;
  lastError: string | undefined;
  onRefresh: () => void;
  preference: AutoRefresh;
  onPreferenceChange: (value: AutoRefresh) => void;
  testID?: string;
}

export function Toolbar(props: ToolbarProps) {
  const {
    generatedAtMs,
    isRefreshing,
    lastError,
    onRefresh,
    preference,
    onPreferenceChange,
    testID,
  } = props;
  const theme = useTheme();
  const now = useNow();

  return (
    <View
      accessibilityRole="toolbar"
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: theme.spacing.lg,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <TextButton
        label={isRefreshing ? "Refreshing…" : "Refresh"}
        onPress={onRefresh}
        testID={testID ? `${testID}-refresh` : undefined}
      />
      {lastError ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <Text variant="caption" color="danger">
            Couldn't refresh
          </Text>
          <TextButton label="Retry" onPress={onRefresh} />
        </View>
      ) : (
        <Text variant="caption" color="textMuted">
          {updatedLabel(generatedAtMs, now)}
        </Text>
      )}
      <View style={{ flex: 1 }} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.sm,
        }}
      >
        <Text variant="caption" color="textMuted">
          Auto-refresh
        </Text>
        {AUTO_REFRESH_OPTIONS.map((option) => {
          const active = option.key === preference;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onPreferenceChange(option.key)}
              testID={testID ? `${testID}-refresh-${option.key}` : undefined}
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed}
                  style={{
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.xs,
                    borderRadius: theme.radii.pill,
                    backgroundColor: active
                      ? theme.tones.info.tint
                      : theme.colors.surfaceRaised,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{
                      color: active
                        ? theme.tones.info.ink
                        : theme.colors.textMuted,
                    }}
                  >
                    {option.label}
                  </Text>
                </PressFeedback>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
