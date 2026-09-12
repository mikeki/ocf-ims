// SPDX-License-Identifier: Apache-2.0

import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
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
import { AreaChooser } from "@/features/compose/AreaChooser";
import { PriorityChips } from "@/features/compose/Chip";
import { Composer } from "@/features/compose/Composer";
import {
  useCreateArea,
  useDraft,
  useFileIncident,
  useProposeType,
} from "@/features/compose/hooks";
import { mentionedIds, type Picked } from "@/features/compose/mentions";
import { fileRequest } from "@/features/compose/payload";
import { TypeChooser } from "@/features/compose/TypeChooser";
import { useEventAccess } from "@/features/events/hooks";
import { useAreas, useIncidentTypes } from "@/features/incidents/hooks";
import { ErrorState } from "@/features/shell/ErrorState";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// The filing form (plan 09r, the D2 pick — Intake, pulled up by a tap on the
// Board's bar): summary, priority, types, location, first entry, in the
// incident's own order; one CreateIncident with the first entry aboard. The
// summary takes focus on open. Navigation is the route's job.

/** Mirrors the proto constraint so the common case never round-trips. */
const SUMMARY_MAX = 1024;

export interface NewIncidentScreenProps {
  eventId: number;
  onCancel: () => void;
  onFiled: (number: number) => void;
}

export function NewIncidentScreen(props: NewIncidentScreenProps) {
  const { eventId, onCancel, onFiled } = props;
  const theme = useTheme();
  const access = useEventAccess(eventId);
  const typesQuery = useIncidentTypes();
  const areasQuery = useAreas(eventId, access.readAreas);
  const proposeType = useProposeType(eventId);
  const createArea = useCreateArea(eventId);
  const mutation = useFileIncident();
  const draft = useDraft(eventId, "new", { summary: "", text: "" });

  const [priority, setPriority] = useState(IncidentPriority.NORMAL);
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [areaSlug, setAreaSlug] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [booth, setBooth] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [summaryError, setSummaryError] = useState<string | undefined>();
  const [formError, setFormError] = useState<AppError | undefined>();

  const summary = draft.draft.summary ?? "";
  const text = draft.draft.text;

  const file = async () => {
    setSummaryError(undefined);
    setFormError(undefined);
    if (!summary.trim()) {
      setSummaryError("Say what it is, in one line.");
      return;
    }
    if (summary.trim().length > SUMMARY_MAX) {
      setSummaryError(`Keep it under ${SUMMARY_MAX} characters.`);
      return;
    }
    const entry = text.trim()
      ? { text, mentionIds: mentionedIds(text, picked) }
      : undefined;
    let number: number;
    try {
      const res = await mutation.mutateAsync(
        fileRequest(eventId, {
          summary,
          priority,
          typeIds,
          areaSlug,
          description,
          booth,
          entry,
        }),
      );
      number = res.incidentNumber;
    } catch (e) {
      const error = toAppError(e);
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
          title="New incident"
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
            <Field
              label="Summary"
              value={summary}
              onChangeText={(value) => draft.update({ summary: value })}
              onBlur={draft.flush}
              placeholder="What is it, in one line"
              autoFocus
              error={summaryError}
              testID="summary"
            />
            <Section title="Priority">
              <PriorityChips value={priority} onChange={setPriority} />
            </Section>
            <Section title="Types">
              <TypeChooser
                types={typesQuery.data?.incidentTypes}
                selected={typeIds}
                onToggle={(id) =>
                  setTypeIds((all) =>
                    all.includes(id)
                      ? all.filter((x) => x !== id)
                      : [...all, id],
                  )
                }
                onPropose={proposeType}
                canPropose={access.writeIncidents}
              />
            </Section>
            <Section title="Location">
              <Box gap="md">
                {access.readAreas ? (
                  <AreaChooser
                    areas={areasQuery.data?.areas}
                    selected={areaSlug}
                    onSelect={setAreaSlug}
                    onCreate={createArea}
                    canCreate={access.writeIncidents}
                  />
                ) : null}
                <Field
                  label="Description"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Near what, which side"
                  testID="description"
                />
                <Field
                  label="Booth"
                  value={booth}
                  onChangeText={setBooth}
                  placeholder="Booth number, if any"
                  testID="booth"
                />
              </Box>
            </Section>
            <Section title="First entry">
              <Composer
                eventId={eventId}
                label="Notes"
                value={text}
                onChangeText={(value) => draft.update({ text: value })}
                onBlur={draft.flush}
                picked={picked}
                onPicked={setPicked}
                placeholder="What you saw. @ to mention."
                testID="first-entry"
              />
            </Section>
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
            label="File incident"
            loading={mutation.isPending}
            onPress={() => {
              void file();
            }}
            testID="file-incident"
          />
        </View>
      </Box>
    </KeyboardAvoidingView>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <Box gap="sm">
      <Text variant="heading">{props.title}</Text>
      {props.children}
    </Box>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { borderTopWidth: StyleSheet.hairlineWidth },
});
