// SPDX-License-Identifier: Apache-2.0

import type { IncidentPerson } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { useRequestReport } from "@/features/compose/hooks";
import { PersonPicker } from "@/features/compose/PersonPicker";
import { ErrorState } from "@/features/shell/ErrorState";
import { formatShortTime, personLabel } from "@/lib/format";

// The incident's People (plan 09t): each involved person with their request
// state — nothing, "asked", or the delivered report as a row that opens it —
// and, for a writer, the ask on each row plus "Ask someone…" to attach and
// ask in one step. Rows update on the refetch the request triggers.

export interface PeopleSectionProps {
  eventId: number;
  number: number;
  people: IncidentPerson[];
  /** The caller may ask (a writer). */
  mayAsk: boolean;
  onOpenReport: (number: number) => void;
}

export function PeopleSection(props: PeopleSectionProps) {
  const { eventId, number, people, mayAsk, onOpenReport } = props;
  const theme = useTheme();
  const { request, isPending } = useRequestReport(eventId, number);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);

  const ask = async (personId: number) => {
    setError(undefined);
    try {
      await request(personId);
    } catch (e) {
      setError(toAppError(e));
      return;
    }
    setAsking(false);
  };

  return (
    <Box gap="sm">
      {people.length === 0 ? (
        <Text color="textMuted">No one attached</Text>
      ) : (
        people.map((p, idx) => (
          <View
            key={p.person?.personId ?? idx}
            testID={`person-row-${p.person?.personId ?? idx}`}
            style={[
              styles.row,
              {
                gap: theme.spacing.sm,
                borderBottomColor: theme.colors.border,
                paddingBottom: idx < people.length - 1 ? theme.spacing.sm : 0,
                borderBottomWidth:
                  idx < people.length - 1 ? StyleSheet.hairlineWidth : 0,
              },
            ]}
          >
            <View style={[styles.body, { gap: theme.spacing.xs }]}>
              <Text>
                {personLabel(p.person)}
                {p.involvement ? (
                  <Text color="textMuted">{` ${p.involvement}`}</Text>
                ) : null}
              </Text>
              {p.reportNumber ? (
                <Box row align="center" gap="sm">
                  <Badge label="Report filed" tone="success" />
                  <TextButton
                    label={`R-${p.reportNumber}`}
                    variant="figure"
                    onPress={() => onOpenReport(p.reportNumber ?? 0)}
                    testID={`person-report-${p.person?.personId ?? idx}`}
                  />
                </Box>
              ) : p.reportRequested ? (
                <Box row align="center" gap="sm">
                  <Badge label="Report requested" tone="warning" />
                  <Text variant="caption" color="textMuted">
                    {formatShortTime(p.reportRequested)}
                  </Text>
                </Box>
              ) : null}
            </View>
            {mayAsk && !p.reportNumber && p.person?.personId ? (
              <TextButton
                label={p.reportRequested ? "Ask again" : "Ask for a report"}
                onPress={() => {
                  void ask(p.person?.personId ?? 0);
                }}
                testID={`ask-report-${p.person.personId}`}
              />
            ) : null}
          </View>
        ))
      )}
      {mayAsk ? (
        asking ? (
          <PersonPicker
            eventId={eventId}
            label="Ask someone for a report"
            placeholder="Type a name"
            onPick={(person) => {
              void ask(person.personId);
            }}
            onClear={() => setAsking(false)}
            testID="ask-someone"
          />
        ) : (
          <TextButton
            label={isPending ? "Asking…" : "Ask someone…"}
            onPress={() => setAsking(true)}
            testID="ask-someone-open"
          />
        )
      ) : null}
      {error ? <ErrorState error={error} /> : null}
    </Box>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  body: { flexShrink: 1 },
});
