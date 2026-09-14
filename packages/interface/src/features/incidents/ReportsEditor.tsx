// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { FieldError } from "@/features/incidents/controls/bits";
import { parseNumbers } from "@/features/incidents/controls/fields";
import type { EditIncident } from "@/features/incidents/useEditIncident";

// Attached reports (plan 09y): one row per number — it opens the report —
// and Detach; the add field takes numbers. Whole list on the wire,
// present-but-empty clears (the clear-vs-unchanged semantics the row names).
// RequestReport, which attaches-and-asks in one step, lives on the People
// rows.

export interface ReportsEditorProps {
  reports: number[];
  mayEdit: boolean;
  edit: EditIncident;
  onOpenReport: (number: number) => void;
  /** Which attached reports' entries are interleaved in the journal. */
  loaded: number[];
  /** Controlled: the add field is open. Undefined = the editor owns the add word. */
  adding?: boolean;
  onAddingChange?: (adding: boolean) => void;
  /** Ledger: the add field appears on press. */
  inPlace?: boolean;
}

export function ReportsEditor(props: ReportsEditorProps) {
  const { reports, mayEdit, edit, onOpenReport, loaded, inPlace } = props;
  const theme = useTheme();
  const [text, setText] = useState("");
  const [ownAdding, setOwnAdding] = useState(false);
  const controlled = props.adding !== undefined;
  const adding = controlled ? props.adding === true : ownAdding;
  const setAdding = (v: boolean) => {
    setOwnAdding(v);
    props.onAddingChange?.(v);
  };
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const status = edit.status("reports");

  const add = () => {
    const numbers = parseNumbers(text);
    if (!numbers) {
      setProblem("Type report numbers, like 7 or 7, 12");
      return;
    }
    setProblem(undefined);
    setText("");
    setAdding(false);
    const merged = [...reports];
    for (const n of numbers) {
      if (!merged.includes(n)) {
        merged.push(n);
      }
    }
    void edit.setReports(merged).catch(() => {});
  };

  return (
    <Box gap="sm">
      {controlled && mayEdit && adding ? (
        <Field
          label="Attach reports"
          value={text}
          onChangeText={(t) => {
            setText(t);
            setProblem(undefined);
          }}
          onSubmitEditing={add}
          onBlur={() => {
            if (text.trim() === "") {
              setAdding(false);
            }
          }}
          blurOnSubmit={false}
          autoFocus={inPlace}
          placeholder="Report numbers, then Enter"
          error={problem}
          keyboardType="numeric"
          testID="reports-add"
        />
      ) : null}
      {reports.length === 0 ? (
        <Text color="textMuted">No reports attached</Text>
      ) : (
        reports.map((n, idx) => (
          <View
            key={n}
            style={[
              styles.row,
              {
                gap: theme.spacing.sm,
                borderBottomColor: theme.colors.border,
                paddingBottom: idx < reports.length - 1 ? theme.spacing.sm : 0,
                borderBottomWidth:
                  idx < reports.length - 1 ? StyleSheet.hairlineWidth : 0,
              },
            ]}
          >
            <View style={[styles.body, { gap: theme.spacing.xs }]}>
              <TextButton
                label={`Report #${n}`}
                onPress={() => onOpenReport(n)}
                testID={`incident-report-${n}`}
              />
              <Text variant="caption" color="textMuted">
                {loaded.includes(n)
                  ? "Its entries are in the journal below"
                  : "Not readable by you — its entries are absent"}
              </Text>
            </View>
            {mayEdit ? (
              <TextButton
                label="Detach"
                onPress={() => {
                  void edit
                    .setReports(reports.filter((r) => r !== n))
                    .catch(() => {});
                }}
                testID={`detach-report-${n}`}
              />
            ) : null}
          </View>
        ))
      )}
      {!controlled && mayEdit ? (
        <View
          style={{
            paddingTop: theme.spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          {!inPlace || adding ? (
            <Field
              label="Attach reports"
              value={text}
              onChangeText={(t) => {
                setText(t);
                setProblem(undefined);
              }}
              onSubmitEditing={add}
              onBlur={() => {
                if (text.trim() === "") {
                  setAdding(false);
                }
              }}
              blurOnSubmit={false}
              autoFocus={inPlace}
              placeholder="Report numbers, then Enter"
              error={problem}
              keyboardType="numeric"
              testID="reports-add"
            />
          ) : (
            <TextButton
              label="Attach a report…"
              onPress={() => setAdding(true)}
              testID="reports-add-open"
            />
          )}
        </View>
      ) : null}
      <FieldError error={status.error} />
    </Box>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  body: { flexShrink: 1, flexGrow: 1 },
});
