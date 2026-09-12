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
import { PhotoAttach } from "@/features/compose/PhotoAttach";
import { fileRequest } from "@/features/compose/payload";
import { TypeChooser } from "@/features/compose/TypeChooser";
import { usePhotoUpload } from "@/features/compose/usePhotoUpload";
import { useEventAccess, useEventName } from "@/features/events/hooks";
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
  /** "Create an incident from this report" (09t): the report's summary to start from. */
  initialSummary?: string;
  /** The report to link on file, in the same CreateIncident. */
  reportNumber?: number;
  onCancel: () => void;
  onFiled: (number: number) => void;
}

export function NewIncidentScreen(props: NewIncidentScreenProps) {
  const { eventId, onCancel, onFiled, reportNumber } = props;
  const theme = useTheme();
  const access = useEventAccess(eventId);
  const eventName = useEventName(eventId);
  const typesQuery = useIncidentTypes();
  const areasQuery = useAreas(eventId, access.readAreas);
  const proposeType = useProposeType(eventId);
  const createArea = useCreateArea(eventId);
  const mutation = useFileIncident();
  const draft = useDraft(eventId, "new", {
    summary: props.initialSummary ?? "",
    text: "",
  });

  const [priority, setPriority] = useState(IncidentPriority.NORMAL);
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [areaSlug, setAreaSlug] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [booth, setBooth] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [summaryError, setSummaryError] = useState<string | undefined>();
  const [formError, setFormError] = useState<AppError | undefined>();
  const photo = usePhotoUpload(eventId, eventName);
  // Filed, but the photo did not land: the form stays with two ways out (09s).
  const [filedWithoutPhoto, setFiledWithoutPhoto] = useState<
    number | undefined
  >();
  const [uploading, setUploading] = useState(false);

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
          reportNumbers: reportNumber ? [reportNumber] : undefined,
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
    // The templ rule (09i §8): the incident exists first, then the photo goes to its number.
    if (photo.pending) {
      setUploading(true);
      const landed = await photo.upload(number);
      setUploading(false);
      if (!landed) {
        setFiledWithoutPhoto(number);
        return;
      }
    }
    onFiled(number);
  };

  const retryPhoto = async () => {
    if (filedWithoutPhoto === undefined) {
      return;
    }
    setUploading(true);
    const landed = await photo.upload(filedWithoutPhoto);
    setUploading(false);
    if (landed) {
      onFiled(filedWithoutPhoto);
    }
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
              {access.attachFiles && access.writeIncidents && eventName ? (
                <PhotoAttach
                  pending={photo.pending}
                  onPicked={photo.pick}
                  onClear={photo.clear}
                  onRetry={() => {
                    void retryPhoto();
                  }}
                  busy={mutation.isPending || uploading}
                />
              ) : null}
            </Section>
            {filedWithoutPhoto !== undefined ? (
              <Box gap="sm" testID="filed-without-photo">
                <Text accessibilityRole="alert">
                  {`Incident #${filedWithoutPhoto} is filed; the photo did not upload.`}
                </Text>
                <Button
                  label="Continue without it"
                  variant="secondary"
                  onPress={() => onFiled(filedWithoutPhoto)}
                  testID="continue-without-photo"
                />
              </Box>
            ) : null}
            {reportNumber ? (
              <Text variant="caption" color="textMuted" testID="links-report">
                {`Report R-${reportNumber} will be attached.`}
              </Text>
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
            label={uploading ? "Uploading photo…" : "File incident"}
            loading={mutation.isPending || uploading}
            disabled={filedWithoutPhoto !== undefined}
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
