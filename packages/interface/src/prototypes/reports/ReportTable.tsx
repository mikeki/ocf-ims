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
import { EmptyState } from "@/features/shell/EmptyState";
import { ReportRow, rowHeight } from "@/prototypes/reports/ReportRow";
import { type Column, columnsFor } from "@/prototypes/reports/reportColumns";
import {
  clearFilters,
  defaultDir,
  isFiltered,
  type SortKey,
} from "@/prototypes/reports/reportQuery";
import type { ReportQuery } from "@/prototypes/reports/useReportQuery";

// The report table, a retyped copy of src/features/dispatch/Table.tsx: fixed
// height rows with `getItemLayout`, a header that sorts with a visible
// direction, and the same scroll bookkeeping (moved only when the keyboard
// walks the selection off the edge, never by a poke or a row's own data
// changing).

export interface ReportTableProps {
  q: ReportQuery;
  onRowPress: (number: number) => void;
}

export function ReportTable(props: ReportTableProps) {
  const { q, onRowPress } = props;
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const columns = useMemo(() => columnsFor(width), [width]);
  const height = rowHeight(theme.type.body.lineHeight ?? 0, theme.spacing.md);
  const scroll = useRef({ y: 0, height: 0 });
  const { sel } = q.query;
  const scrolledSel = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (sel === scrolledSel.current) {
      return;
    }
    scrolledSel.current = sel;
    if (sel === undefined) {
      return;
    }
    const index = q.visible.findIndex((row) => row.report.number === sel);
    if (index === -1) {
      return;
    }
    const { y, height: viewport } = scroll.current;
    const top = index * height;
    const bottom = top + height;
    if (top < y) {
      q.listRef.current?.scrollToOffset({ offset: top, animated: false });
    } else if (viewport > 0 && bottom > y + viewport) {
      q.listRef.current?.scrollToOffset({
        offset: bottom - viewport,
        animated: false,
      });
    }
  }, [sel, q.visible, q.listRef, height]);

  const onSort = (key: SortKey) => {
    const { sort } = q.query;
    q.setQuery({
      sort:
        sort.key === key
          ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: defaultDir(key) },
    });
  };

  const empty = (
    <EmptyState
      title={
        q.query.link === "unlinked"
          ? "No unlinked reports"
          : q.query.link === "linked"
            ? "No linked reports"
            : "No reports"
      }
      message={
        isFiltered(q.query) ? "Nothing matches these filters." : "All quiet."
      }
      action={
        isFiltered(q.query)
          ? {
              label: "Clear filters",
              onPress: () => q.setQuery(clearFilters(q.query)),
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
      <Header columns={columns} q={q} onSort={onSort} />
      <FlatList
        ref={q.listRef}
        style={styles.fill}
        contentContainerStyle={styles.grow}
        data={q.visible}
        extraData={sel}
        keyExtractor={(row) => String(row.report.number)}
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
          <ReportRow
            view={item}
            columns={columns}
            selected={item.report.number === sel}
            height={height}
            onPress={onRowPress}
          />
        )}
        ListEmptyComponent={empty}
        testID="report-table"
      />
    </View>
  );
}

interface HeaderProps {
  columns: Column[];
  q: ReportQuery;
  onSort: (key: SortKey) => void;
}

function Header(props: HeaderProps) {
  const { columns, q, onSort } = props;
  const theme = useTheme();
  const { sort } = q.query;
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
