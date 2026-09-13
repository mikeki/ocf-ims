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
import { type Column, columnsFor } from "@/prototypes/dispatch/columns";
import {
  type Density,
  IncidentRow,
  rowHeight,
} from "@/prototypes/dispatch/IncidentRow";
import {
  clearFilters,
  defaultDir,
  isFiltered,
  type SortKey,
} from "@/prototypes/dispatch/state";
import type { Dispatch } from "@/prototypes/dispatch/useDispatch";

// The table (plan 09x): a windowed list of fixed-height rows over the
// filtered view, a header that sorts, and columns that hide by the table's
// own measured width — not the window's, since Split halves it. Whatever the
// selection does, the scroll never jumps: a poke re-renders a row in place,
// and the keyboard walk scrolls only when the selection leaves the viewport.

export interface TableProps {
  d: Dispatch;
  density: Density;
  onRowPress: (number: number) => void;
}

export function Table(props: TableProps) {
  const { d, density, onRowPress } = props;
  const theme = useTheme();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const columns = useMemo(() => columnsFor(width), [width]);
  const pad = density === "compact" ? theme.spacing.sm : theme.spacing.md;
  const height = rowHeight(theme.type.body.lineHeight ?? 0, pad);
  // The scroll position and viewport, tracked by hand: the viewability
  // callback is not reliable on the web build, and this has to be exact.
  const scroll = useRef({ y: 0, height: 0 });
  const { sel } = d.query;

  // Keep the selection in view when the keyboard walks it off the edge —
  // and only then. A click, a poke or a filter never moves the scroll.
  useEffect(() => {
    if (sel === undefined) {
      return;
    }
    const index = d.visible.findIndex((row) => row.number === sel);
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
        keyExtractor={(row) => String(row.number)}
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
            incident={item}
            columns={columns}
            lookups={d.lookups}
            selected={item.number === sel}
            height={height}
            onPress={() => onRowPress(item.number)}
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
  d: Dispatch;
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
