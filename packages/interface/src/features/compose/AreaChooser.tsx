// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { Chip } from "@/features/compose/Chip";

// The area picker on the filing form (plan 09r): a search over ListAreas,
// the pick shown as a chip, and the "create it for this event" offer for a
// name nothing matches — a writer's only. A proposed area renders like any
// other here; the admin's review is elsewhere.

export interface AreaChooserProps {
  areas: Area[] | undefined;
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
  /** CreateArea; resolves to the slug to set. */
  onCreate: (name: string) => Promise<string>;
  canCreate: boolean;
  /** Rows shown before the list is cut. */
  limit?: number;
}

const CREATE_MIN = 2;

export function AreaChooser(props: AreaChooserProps) {
  const { selected, onSelect, onCreate, canCreate } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const areas = props.areas ?? [];
  const q = query.trim().toLowerCase();
  const current = selected ? areas.find((a) => a.slug === selected) : undefined;

  if (selected) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" color="textMuted">
          Area
        </Text>
        <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
          <Chip
            label={current?.name ?? selected}
            selected
            onPress={() => onSelect(undefined)}
            testID="area-selected"
          />
          <TextButton label="Change" onPress={() => onSelect(undefined)} />
        </View>
      </View>
    );
  }

  const matches = areas
    .filter((a) => !q || (a.name ?? a.slug).toLowerCase().includes(q))
    .slice(0, props.limit ?? 6);
  const exact = areas.some(
    (a) => q.length > 0 && (a.name ?? "").trim().toLowerCase() === q,
  );
  const offer = canCreate && q.length >= CREATE_MIN && !exact;

  const createArea = async () => {
    setCreating(true);
    setError(undefined);
    try {
      onSelect(await onCreate(query.trim()));
      setQuery("");
    } catch {
      setError("Couldn't create that area. Try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Field
        label="Area"
        value={query}
        onChangeText={setQuery}
        placeholder="Search areas"
        error={error}
        testID="area-search"
      />
      {matches.length > 0 ? (
        <View
          style={{
            borderColor: theme.colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: theme.radii.md,
            overflow: "hidden",
          }}
        >
          {matches.map((a) => (
            <Pressable
              key={a.slug}
              accessibilityRole="button"
              accessibilityLabel={a.name ?? a.slug}
              onPress={() => {
                onSelect(a.slug);
                setQuery("");
              }}
              pressRetentionOffset={pressRetentionOffset}
              testID={`area-${a.slug}`}
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed}
                  style={[
                    styles.row,
                    {
                      paddingHorizontal: theme.spacing.md,
                      backgroundColor: theme.colors.surface,
                      borderBottomColor: theme.colors.border,
                    },
                  ]}
                >
                  <Text>{a.name ?? a.slug}</Text>
                </PressFeedback>
              )}
            </Pressable>
          ))}
        </View>
      ) : !offer ? (
        <Text color="textMuted">No area matches</Text>
      ) : null}
      {offer ? (
        creating ? (
          <Text variant="label" color="textMuted">
            Creating…
          </Text>
        ) : (
          <TextButton
            label={`Create “${query.trim()}” for this event`}
            onPress={() => {
              void createArea();
            }}
            testID="area-create"
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  row: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
