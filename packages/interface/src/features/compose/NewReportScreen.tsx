// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { Composer } from "@/features/compose/Composer";
import {
  useCreateReport,
  useDraft,
  useOnBehalfOf,
  useOwnReportCount,
  useReportHelp,
} from "@/features/compose/hooks";
import { mentionedIds, type Picked } from "@/features/compose/mentions";
import { PersonPicker, personPickLabel } from "@/features/compose/PersonPicker";
import { reportRequest } from "@/features/compose/payload";
import { ReportHelp } from "@/features/compose/ReportHelp";
import { useEventAccess } from "@/features/events/hooks";
import { ErrorState } from "@/features/shell/ErrorState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The report form (plan 09t, slice 3b.3b): summary, on behalf of, details,
// the incident it is about, and the instructions — open for a first report.
// One CreateReport with the first entry aboard; the report replaces the form.

const SUMMARY_MAX = 1024;

export interface NewReportScreenProps {
  eventId: number;
  /** Set when the form was reached from a request or the incident screen: read-only. */
  incident?: number;
  onCancel: () => void;
  onFiled: (number: number) => void;
}

export function NewReportScreen(props: NewReportScreenProps) {
  const { eventId, incident, onCancel, onFiled } = props;
  const theme = useTheme();
  const access = useEventAccess(eventId);
  const mutation = useCreateReport(eventId);
  const draft = useDraft(eventId, "report-new", { summary: "", text: "" });
  const sticky = useOnBehalfOf(eventId);
  const ownCount = useOwnReportCount(eventId);
  const help = useReportHelp(
    eventId,
    ownCount === undefined ? undefined : ownCount === 0,
  );

  const [picked, setPicked] = useState<Picked[]>([]);
  const [incidentText, setIncidentText] = useState("");
  const [summaryError, setSummaryError] = useState<string | undefined>();
  const [incidentError, setIncidentError] = useState<string | undefined>();
  const [formError, setFormError] = useState<AppError | undefined>();

  const summary = draft.draft.summary ?? "";
  const text = draft.draft.text;
  // A restored draft's pick wins until the person touches the picker; after
  // that the session's sticky pick is the truth (clearing it reverts to me).
  const [touched, setTouched] = useState(false);
  const onBehalfOf =
    touched || draft.draft.onBehalfOf === undefined
      ? sticky.pick
      : draft.draft.onBehalfOf;

  const linkedIncident = (): number | undefined => {
    if (incident) {
      return incident;
    }
    const trimmed = incidentText.trim();
    if (!trimmed) {
      return undefined;
    }
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 && String(n) === trimmed
      ? n
      : Number.NaN;
  };

  const file = async () => {
    setSummaryError(undefined);
    setIncidentError(undefined);
    setFormError(undefined);
    if (!summary.trim()) {
      setSummaryError("Say what it is about, in one line.");
      return;
    }
    if (summary.trim().length > SUMMARY_MAX) {
      setSummaryError(`Keep it under ${SUMMARY_MAX} characters.`);
      return;
    }
    const link = linkedIncident();
    if (link !== undefined && Number.isNaN(link)) {
      setIncidentError("An incident number, like 214.");
      return;
    }
    const entry = text.trim()
      ? {
          text,
          mentionIds: mentionedIds(text, picked),
          onBehalfOfId: onBehalfOf?.personId,
        }
      : undefined;
    let number: number;
    try {
      const res = await mutation.mutateAsync(
        reportRequest(eventId, { summary, incident: link, entry }),
      );
      number = res.reportNumber;
    } catch (e) {
      const error = toAppError(e);
      if (error.kind === "notFound" && link) {
        setIncidentError(`There's no incident #${link} in this event.`);
        return;
      }
      const violation = error.violations.find((v) =>
        v.field.endsWith("summary"),
      );
      if (error.kind === "invalid" && violation) {
        setSummaryError(violation.message);
      } else {
        setFormError(error);
      }
      return;
    }
    draft.clear();
    onFiled(number);
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Box flex={1} bg="background">
        <ScreenHeader
          title="New report"
          back={{ label: "Cancel", onPress: onCancel }}
        />
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
          <Box p="lg" gap="lg">
            {draft.restored ? (
              <Text
                variant="caption"
                color="textMuted"
                accessibilityRole="alert"
              >
                Restored an unsent draft.
              </Text>
            ) : null}
            {help.loaded ? (
              <ReportHelp open={help.open} onToggle={help.setOpen} />
            ) : null}
            <Field
              label="Summary"
              value={summary}
              onChangeText={(value) => draft.update({ summary: value })}
              onBlur={draft.flush}
              placeholder="What it is about, in one line"
              autoFocus
              error={summaryError}
              testID="report-summary"
            />
            <PersonPicker
              eventId={eventId}
              label="On behalf of"
              placeholder="Yourself, unless you name someone"
              picked={onBehalfOf}
              onPick={(person) => {
                const pick = {
                  personId: person.personId,
                  label: personPickLabel(person),
                };
                setTouched(true);
                sticky.setPick(pick);
                draft.update({ onBehalfOf: pick });
              }}
              onClear={() => {
                setTouched(true);
                sticky.setPick(undefined);
                draft.update({ onBehalfOf: undefined });
              }}
              testID="on-behalf-of"
            />
            <Composer
              eventId={eventId}
              label="Details"
              value={text}
              onChangeText={(value) => draft.update({ text: value })}
              onBlur={draft.flush}
              picked={picked}
              onPicked={setPicked}
              placeholder="What happened, in your own words. @ to mention."
              rows={6}
              testID="report-details"
            />
            {incident ? (
              <Box gap="xs">
                <Text variant="label" color="textMuted">
                  Incident
                </Text>
                <Text testID="report-incident-fixed">{`#${incident}`}</Text>
              </Box>
            ) : access.writeIncidents ? (
              <Field
                label="Incident"
                value={incidentText}
                onChangeText={setIncidentText}
                placeholder="A number, if this is about one"
                keyboardType="number-pad"
                error={incidentError}
                testID="report-incident"
              />
            ) : null}
            {formError ? <ErrorState error={formError} /> : null}
          </Box>
        </ScrollView>
        <View
          style={[
            styles.dock,
            {
              backgroundColor: theme.colors.surface,
              borderTopColor: theme.colors.border,
              padding: theme.spacing.md,
            },
          ]}
        >
          <Button
            label="File report"
            loading={mutation.isPending}
            onPress={() => {
              void file();
            }}
            testID="file-report"
          />
        </View>
      </Box>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
});
