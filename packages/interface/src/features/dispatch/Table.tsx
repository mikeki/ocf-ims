// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset } from "@/design/tokens";
import { type Column, columnsFor } from "@/features/dispatch/columns";
import { IncidentRow, rowHeight } from "@/features/dispatch/IncidentRow";
import {
  clearFilters,
  defaultDir,
  isFiltered,
  type Lookups,
  type SortKey,
} from "@/features/dispatch/query";
import type { DispatchQuery } from "@/features/dispatch/useDispatchQuery";
import { EmptyState } from "@/features/shell/EmptyState";

// The table (plan 09x criterion 3), promoted from
// src/prototypes/dispatch/Table.tsx: fixed-height rows with `getItemLayout`
// (finding 4: fine without a windowed-list dependency), a header that sorts
// with a visible direction, and the scroll bookkeeping of finding 5 — the
// viewability callback is not reliable on the web build, so the scroll
// offset and the viewport are tracked by hand and only moved when the
// keyboard walks the selection off the edge.

export interface TableProps {
  d: DispatchQuery;
  lookups: Lookups;
  onRowPress: (number: number) => void;
}

export function Table(props: TableProps) {
  const { d, lookups, onRowPress } = props;
  const theme = useTheme();
  // Seeded from the window so the first frame already has the real columns
  // (finding 3) — the top bar shell spends no horizontal space, so the
  // window width is the table's width until `onLayout` measures the actual
  // container and refines it.
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const columns = useMemo(() => columnsFor(width), [width]);
  const height = rowHeight(theme.type.body.lineHeight ?? 0, theme.spacing.md);
  const scroll = useRef({ y: 0, height: 0 });
  const { sel } = d.query;
  // The last `sel` scrolled for (finding 2): row data alone — a hub patch, a
  // poll — must never re-scroll, only `sel` itself changing (a click, j/k).
  const scrolledSel = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (sel === scrolledSel.current) {
      return;
    }
    scrolledSel.current = sel;
    if (sel === undefined) {
      return;
    }
    const index = d.visible.findIndex((row) => row.incident.number === sel);
    if (index === -1) {
      return;
    }
    const { y, height: viewport } = scroll.current;
    const top = index * height;
    const bottom = top + height;
    if (top < y) {
      d.listRef.current?.scrollToOffset({ offset: top, animated: false });
    } else if (viewport > 0 && bottom > y + viewport) {
      d.listRef.current?.scrollToOffset({
        offset: bottom - viewport,
        animated: false,
      });
    }
  }, [sel, d.visible, d.listRef, height]);

  const onSort = (key: SortKey) => {
    const { sort } = d.query;
    d.setQuery({
      sort:
        sort.key === key
          ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: defaultDir(key) },
    });
  };

  const empty = (
    <EmptyState
      title={
        d.query.state === "open"
          ? "No open incidents"
          : d.query.state === "closed"
            ? "No closed incidents"
            : "No incidents"
      }
      message={
        isFiltered(d.query)
          ? "Nothing matches these filters."
          : "A quiet shift."
      }
      action={
        isFiltered(d.query)
          ? {
              label: "Clear filters",
              onPress: () => d.setQuery(clearFilters(d.query)),
            }
          : undefined
      }
    />
  );

  return (
    <View
      style={styles.fill}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Header columns={columns} d={d} onSort={onSort} />
      <FlatList
        ref={d.listRef}
        style={styles.fill}
        contentContainerStyle={styles.grow}
        data={d.visible}
        extraData={sel}
        keyExtractor={(row) => String(row.incident.number)}
        getItemLayout={(_, index) => ({
          length: height,
          offset: height * index,
          index,
        })}
        initialNumToRender={30}
        maxToRenderPerBatch={20}
        windowSize={5}
        onScroll={(e) => {
          scroll.current.y = e.nativeEvent.contentOffset.y;
        }}
        onLayout={(e) => {
          scroll.current.height = e.nativeEvent.layout.height;
        }}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <IncidentRow
            view={item}
            columns={columns}
            lookups={lookups}
            selected={item.incident.number === sel}
            height={height}
            onPress={onRowPress}
          />
        )}
        ListEmptyComponent={empty}
        testID="dispatch-table"
      />
    </View>
  );
}

interface HeaderProps {
  columns: Column[];
  d: DispatchQuery;
  onSort: (key: SortKey) => void;
}

function Header(props: HeaderProps) {
  const { columns, d, onSort } = props;
  const theme = useTheme();
  const { sort } = d.query;
  return (
    <View
      accessibilityRole="header"
      style={[
        styles.header,
        {
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surfaceSunken,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      {columns.map((column) => {
        const active = sort.key === column.key;
        const label = active
          ? `${column.label} ${sort.dir === "asc" ? "▲" : "▼"}`
          : column.label;
        return (
          <Pressable
            key={column.key}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${column.label}`}
            onPress={() => onSort(column.key)}
            pressRetentionOffset={pressRetentionOffset}
            style={[
              column.width === undefined
                ? styles.flexCell
                : { width: column.width },
              column.align === "right" ? styles.right : null,
            ]}
          >
            {({ pressed }) => (
              <PressFeedback pressed={pressed} style={styles.hug}>
                <Text
                  variant="label"
                  color={active ? "text" : "textMuted"}
                  numberOfLines={1}
                  style={{ paddingVertical: theme.spacing.sm }}
                >
                  {label}
                </Text>
              </PressFeedback>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flexCell: { flex: 1, minWidth: 0 },
  right: { alignItems: "flex-end" },
  hug: { alignSelf: "flex-start" },
});
