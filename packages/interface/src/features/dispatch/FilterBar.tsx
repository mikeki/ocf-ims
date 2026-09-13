// SPDX-License-Identifier: Apache-2.0

import type { IncidentView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/incident_pb";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { Chip } from "@/features/compose/Chip";
import {
  clearFilters,
  isFiltered,
  type Lookups,
  type PriorityKey,
  peopleOptions,
  type StateFilter,
} from "@/features/dispatch/query";
import type { DispatchQuery } from "@/features/dispatch/useDispatchQuery";

// The filter bar (plan 09x criterion 5), promoted from
// src/prototypes/dispatch/FilterBar.tsx: chips for state, priority, type,
// area, person, mine and days, plus the search field and Clear. "New
// incident" moved to the shell (criterion 2); the person chip's choices come
// from the loaded rows (criterion 4), not a fixture or a new RPC.

export interface FilterBarProps {
  d: DispatchQuery;
  rows: IncidentView[];
  lookups: Lookups;
  onHelp: () => void;
}

const STATES: [StateFilter, string][] = [
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
];

const PRIORITIES: [PriorityKey, string][] = [
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"],
];

const DAYS: [number | undefined, string][] = [
  [1, "Today"],
  [2, "2 days"],
  [undefined, "Any day"],
];

export function FilterBar(props: FilterBarProps) {
  const { d, rows, lookups } = props;
  const theme = useTheme();
  const { query } = d;

  const togglePriority = (key: PriorityKey) =>
    d.setQuery({
      priority: query.priority.includes(key)
        ? query.priority.filter((p) => p !== key)
        : [...query.priority, key],
    });

  return (
    <View
      style={[
        styles.bar,
        {
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Search d={d} />
        <View style={styles.spacer} />
        <Text variant="caption" color="textMuted">
          {`${d.visible.length} of ${rows.length}`}
        </Text>
        <View style={styles.centered}>
          <TextButton label="Keys ?" onPress={props.onHelp} />
        </View>
      </View>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Group label="State">
          {STATES.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              tone={key === "open" ? "info" : "neutral"}
              selected={query.state === key}
              onPress={() => d.setState(key)}
            />
          ))}
        </Group>
        <Group label="Priority">
          {PRIORITIES.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              tone={key === "high" ? "danger" : "neutral"}
              selected={query.priority.includes(key)}
              onPress={() => togglePriority(key)}
            />
          ))}
        </Group>
        <Menu
          label="Type"
          options={lookups.types.map((t) => ({
            key: String(t.id),
            label: t.name || `Type #${t.id}`,
          }))}
          selected={query.type.map(String)}
          onToggle={(key) => {
            const id = Number.parseInt(key, 10);
            d.setQuery({
              type: query.type.includes(id)
                ? query.type.filter((t) => t !== id)
                : [...query.type, id],
            });
          }}
        />
        <Menu
          label="Area"
          options={lookups.areas.map((a) => ({
            key: a.slug,
            label: a.name || a.slug,
          }))}
          selected={query.area}
          onToggle={(slug) =>
            d.setQuery({
              area: query.area.includes(slug)
                ? query.area.filter((a) => a !== slug)
                : [...query.area, slug],
            })
          }
        />
        <Menu
          label="Person"
          options={peopleOptions(rows)}
          selected={query.person === undefined ? [] : [String(query.person)]}
          onToggle={(key) => {
            const id = Number.parseInt(key, 10);
            d.setQuery({ person: query.person === id ? undefined : id });
          }}
        />
        <Chip
          label="Mine"
          tone="info"
          selected={query.mine}
          onPress={() => d.setQuery({ mine: !query.mine })}
        />
        <Group label="Started">
          {DAYS.map(([days, label]) => (
            <Chip
              key={label}
              label={label}
              tone="neutral"
              selected={query.days === days}
              onPress={() => d.setQuery({ days })}
            />
          ))}
        </Group>
        {isFiltered(query) ? (
          <View style={styles.centered}>
            <TextButton
              label="Clear"
              onPress={() => d.setQuery(clearFilters(query))}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Group(props: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={props.label}
      style={[styles.row, { gap: theme.spacing.xs }]}
    >
      {props.children}
    </View>
  );
}

/** The search box: `/` focuses it, Enter hands focus back to the table. */
function Search(props: { d: DispatchQuery }) {
  const { d } = props;
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(d.query.q);
  // The URL is the truth: an Esc or a Clear that empties `q` empties the box.
  useEffect(() => setText(d.query.q), [d.query.q]);
  return (
    <TextInput
      ref={d.searchRef}
      accessibilityLabel="Search incidents"
      placeholder="Search  /"
      placeholderTextColor={theme.colors.textMuted}
      value={text}
      onChangeText={(next) => {
        setText(next);
        d.setQuery({ q: next });
      }}
      onSubmitEditing={d.submitSearch}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      blurOnSubmit={false}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        styles.search,
        theme.type.body,
        {
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
          borderColor: focused ? theme.colors.focus : theme.colors.borderStrong,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          boxShadow: focused
            ? `0 0 0 3px ${theme.colors.focusRing}`
            : undefined,
        },
      ]}
      testID="dispatch-search"
    />
  );
}

interface MenuProps {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
}

/** A chip that drops a list: the type, area and person filters. */
function Menu(props: MenuProps) {
  const { label, options, selected, onToggle } = props;
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const title = selected.length
    ? `${label} · ${selected.length}`
    : `${label} ▾`;
  return (
    <View style={styles.menuAnchor}>
      <Chip
        label={title}
        tone="info"
        selected={selected.length > 0}
        onPress={() => setOpen((on) => !on)}
      />
      {open ? (
        <>
          <Pressable
            accessibilityLabel={`Close ${label} menu`}
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              theme.elevation[2],
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
                paddingVertical: theme.spacing.xs,
              },
            ]}
          >
            {options.map((option) => {
              const on = selected.includes(option.key);
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="menuitem"
                  accessibilityState={{ checked: on }}
                  onPress={() => onToggle(option.key)}
                  pressRetentionOffset={pressRetentionOffset}
                >
                  {({ pressed }) => (
                    <PressFeedback
                      pressed={pressed}
                      style={[
                        styles.item,
                        {
                          paddingHorizontal: theme.spacing.md,
                          paddingVertical: theme.spacing.sm,
                          gap: theme.spacing.sm,
                          backgroundColor: on
                            ? theme.colors.surfaceRaised
                            : "transparent",
                        },
                      ]}
                    >
                      <Text
                        variant="label"
                        color={on ? "primary" : "textMuted"}
                      >
                        {on ? "✓" : " "}
                      </Text>
                      <Text variant="label">{option.label}</Text>
                    </PressFeedback>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  spacer: { flex: 1 },
  centered: { justifyContent: "center" },
  search: {
    width: 220,
    borderWidth: 1,
    outlineWidth: 0,
  },
  menuAnchor: {
    zIndex: 3,
  },
  backdrop: {
    position: "absolute",
    top: -2000,
    left: -4000,
    width: 8000,
    height: 6000,
  },
  menu: {
    position: "absolute",
    top: 36,
    left: 0,
    minWidth: 200,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
  },
});
