// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Chip } from "@/features/compose/Chip";
import {
  clearFilters,
  isFiltered,
  type LinkFilter,
} from "@/prototypes/reports/reportQuery";
import type { ReportQuery } from "@/prototypes/reports/useReportQuery";

// The report table's filter bar, a retyped copy of
// src/features/dispatch/FilterBar.tsx: the search field, the Unlinked ·
// Linked · All chips in place of Open · Closed · All, and Clear. No
// priority / type / area / people menus (§ The table) — a report carries
// none of them.

export interface ReportFilterBarProps {
  q: ReportQuery;
  total: number;
  onHelp: () => void;
}

const LINKS: [LinkFilter, string][] = [
  ["unlinked", "Unlinked"],
  ["linked", "Linked"],
  ["all", "All"],
];

export function ReportFilterBar(props: ReportFilterBarProps) {
  const { q, total } = props;
  const theme = useTheme();
  const { query } = q;

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
        <Search q={q} />
        <View style={styles.spacer} />
        <Text variant="caption" color="textMuted">
          {`${q.visible.length} of ${total}`}
        </Text>
        <View style={styles.centered}>
          <TextButton label="Keys ?" onPress={props.onHelp} />
        </View>
      </View>
      <View style={[styles.row, { gap: theme.spacing.sm }]}>
        <Group label="Link">
          {LINKS.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              tone={key === "unlinked" ? "info" : "neutral"}
              selected={query.link === key}
              onPress={() => q.setLink(key)}
            />
          ))}
        </Group>
        {isFiltered(query) ? (
          <View style={styles.centered}>
            <TextButton
              label="Clear"
              onPress={() => q.setQuery(clearFilters(query))}
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
function Search(props: { q: ReportQuery }) {
  const { q } = props;
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(q.query.q);
  // The URL is the truth: an Esc or a Clear that empties `q` empties the box.
  useEffect(() => setText(q.query.q), [q.query.q]);
  return (
    <TextInput
      ref={q.searchRef}
      accessibilityLabel="Search reports"
      placeholder="Search  /"
      placeholderTextColor={theme.colors.textMuted}
      value={text}
      onChangeText={(next) => {
        setText(next);
        q.setQuery({ q: next });
      }}
      onSubmitEditing={q.submitSearch}
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
      testID="report-search"
    />
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
});
