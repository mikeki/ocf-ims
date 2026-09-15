// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { PressFeedback } from "@/design/motion";
import { Badge } from "@/design/primitives/Badge";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import { PasswordField } from "@/features/auth/PasswordField";
import { useMentionSearch } from "@/features/compose/hooks";
import { Avatar } from "@/prototypes/people/Avatar";
import { identityFor } from "@/prototypes/people/data";
import { rungLabel } from "@/prototypes/people/roles";
import type { Viewer } from "@/prototypes/people/types";
import {
  type CreatePersonForm,
  type Roster,
  rungsFor,
} from "@/prototypes/people/useRoster";

// Add person (docs/plans/09aa-roster-design.md § What is fixed, § What to
// build 3): search-first over `ListPersonnel(query)` — reusing
// `useMentionSearch` (features/compose/hooks.ts), the same ≥2-character
// typeahead the composer's @mention already runs, rather than a second copy
// of that query. A hit enrols as a Reporter (`roster.enrol`, one
// `SetPersonParticipation`, no rung choice — the brief's plain reading of
// "## What is fixed"); no hit offers Create, which is name-only unless "They
// sign in" is on. The admin's rung choice is `rungsFor` fed a probe person
// carrying only the toggle's `has_password` — the exact ceiling
// `SetPersonParticipation` would enforce on a freshly created row — so an
// inviter's create, which never reaches that branch, gets the note instead.

export interface AddPersonProps {
  eventId: number;
  viewer: Viewer;
  roster: Roster;
  onClose: () => void;
}

type Stage =
  | { kind: "search" }
  | { kind: "create"; seed: string }
  | { kind: "created"; person: Person };

export function AddPerson(props: AddPersonProps) {
  const { eventId, viewer, roster, onClose } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "search" });
  const [enrolledIds, setEnrolledIds] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const trimmed = query.trim();
  const hits = useMentionSearch(eventId, trimmed);

  if (stage.kind === "created") {
    return (
      <CreatedNotice
        person={stage.person}
        onDone={onClose}
        onAddAnother={() => {
          setStage({ kind: "search" });
          setQuery("");
        }}
      />
    );
  }

  if (stage.kind === "create") {
    return (
      <CreateForm
        viewer={viewer}
        seed={stage.seed}
        onCancel={() => setStage({ kind: "search" })}
        onCreate={async (form) => {
          const created = await roster.create(form);
          if (created) {
            setStage({ kind: "created", person: created });
          }
        }}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { padding: theme.spacing.lg, gap: theme.spacing.lg },
      ]}
      testID="add-person-search-panel"
    >
      <Field
        label="Search"
        placeholder="Name or handle, at least two letters"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        testID="add-person-search"
      />
      {trimmed.length < 2 ? (
        <Text variant="caption" color="textMuted">
          Type at least two letters to search the roster.
        </Text>
      ) : hits.length === 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="body" color="textMuted">
            {`No one named “${trimmed}”.`}
          </Text>
          <Button
            label="Create a new person"
            variant="secondary"
            onPress={() => setStage({ kind: "create", seed: trimmed })}
            testID="add-person-create"
          />
        </View>
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {hits.map((person) => (
            <Hit
              key={person.personId}
              person={person}
              roster={roster}
              enrolled={enrolledIds.has(person.personId)}
              onEnrolled={() =>
                setEnrolledIds((prev) => {
                  const next = new Set(prev);
                  next.add(person.personId);
                  return next;
                })
              }
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Hit(props: {
  person: Person;
  roster: Roster;
  enrolled: boolean;
  onEnrolled: () => void;
}) {
  const { person, roster, enrolled, onEnrolled } = props;
  const theme = useTheme();
  const label = person.name || person.handle || `Person #${person.personId}`;
  const pending = roster.pendingFor(person.personId);
  const error = roster.errorFor(person.personId);

  return (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Avatar person={person} size={32} />
      <View style={styles.fill}>
        <Text variant="body" numberOfLines={1}>
          {label}
        </Text>
        {person.handle && person.name ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {person.handle}
          </Text>
        ) : null}
      </View>
      {enrolled ? (
        <Text variant="label" color="success">
          Enrolled as Reporter
        </Text>
      ) : (
        <TextButton
          label={pending ? "Enrolling…" : "Enrol"}
          onPress={() => {
            if (pending) {
              return;
            }
            void roster
              .enrol(person.personId)
              .then(onEnrolled)
              .catch(() => undefined);
          }}
          testID={`add-person-enrol-${person.personId}`}
        />
      )}
      {error ? (
        <Text variant="caption" color="danger">
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

interface CreateFormProps {
  viewer: Viewer;
  seed: string;
  onCancel: () => void;
  onCreate: (form: CreatePersonForm) => Promise<void>;
}

type PasswordMode = "default" | "explicit";

function CreateForm(props: CreateFormProps) {
  const { viewer, seed, onCancel, onCreate } = props;
  const theme = useTheme();
  const admin = identityFor(viewer).admin;

  const [fairName, setFairName] = useState(seed);
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("default");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rung, setRung] = useState<ParticipationType>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<AppError>();
  const [submitting, setSubmitting] = useState(false);

  // The exact ceiling `SetPersonParticipation` would enforce on this row
  // once created (§ Gating and the ceiling): a probe person carrying only
  // the toggle's `has_password`, fed to the same `rungsFor` every other
  // control in this round reads.
  const rungOptions = useMemo(
    () =>
      admin
        ? rungsFor(
            viewer,
            create(PersonSchema, {
              personId: -1,
              hasPassword: signIn,
              isAdmin: false,
              participationType: ParticipationType.UNSPECIFIED,
              crews: [],
            }),
          )
        : [],
    [admin, viewer, signIn],
  );

  useEffect(() => {
    setRung((current) => {
      if (rungOptions.length === 0) {
        return undefined;
      }
      return current !== undefined && rungOptions.includes(current)
        ? current
        : rungOptions[0];
    });
  }, [rungOptions]);

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!fairName.trim()) {
      errors.fairName = "A fair name is required.";
    }
    if (signIn) {
      if (!email.trim()) {
        errors.email = "An email is required to sign in.";
      }
      if (passwordMode === "explicit" && !password) {
        errors.password = "Set a password, or use the shared default.";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setSubmitError(undefined);
    setSubmitting(true);
    try {
      await onCreate({
        handle: fairName.trim(),
        name: legalName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password: signIn && passwordMode === "explicit" ? password : undefined,
        useDefaultPassword: signIn && passwordMode === "default",
        participationType: admin ? rung : undefined,
      });
    } catch (e) {
      setSubmitError(toAppError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { padding: theme.spacing.lg, gap: theme.spacing.lg },
      ]}
      testID="add-person-create-form"
    >
      <Field
        label="Fair name"
        value={fairName}
        onChangeText={setFairName}
        error={fieldErrors.fairName}
        testID="add-person-fair-name"
      />
      <Field
        label="Legal name"
        value={legalName}
        onChangeText={setLegalName}
        testID="add-person-legal-name"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        error={fieldErrors.email}
        testID="add-person-email"
      />
      <Field
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        testID="add-person-phone"
      />

      <View style={{ gap: theme.spacing.sm }}>
        <View style={[styles.row, { gap: theme.spacing.md }]}>
          <Switch
            accessibilityLabel="They sign in"
            value={signIn}
            onValueChange={setSignIn}
            trackColor={{
              true: theme.colors.primary,
              false: theme.colors.borderStrong,
            }}
            thumbColor={theme.colors.surface}
            testID="add-person-sign-in"
          />
          <Text variant="label">{signIn ? "They sign in" : "No login"}</Text>
        </View>
        {signIn ? (
          <View style={{ gap: theme.spacing.sm }}>
            <View style={[styles.row, { gap: theme.spacing.sm }]}>
              <Chip
                label="Use the shared default"
                selected={passwordMode === "default"}
                onPress={() => setPasswordMode("default")}
                testID="add-person-password-default"
              />
              <Chip
                label="Set a password"
                selected={passwordMode === "explicit"}
                onPress={() => setPasswordMode("explicit")}
                testID="add-person-password-explicit"
              />
            </View>
            {passwordMode === "explicit" ? (
              <PasswordField
                label="Password"
                value={password}
                onChangeText={setPassword}
                shown={showPassword}
                onToggleShown={() => setShowPassword((s) => !s)}
                error={fieldErrors.password}
                testID="add-person-password"
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {admin ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="textMuted">
            Role
          </Text>
          <View
            style={[styles.row, { flexWrap: "wrap", gap: theme.spacing.sm }]}
          >
            {rungOptions.map((option) => (
              <Chip
                key={option}
                label={rungLabel(option)}
                selected={option === rung}
                onPress={() => setRung(option)}
                testID={`add-person-rung-${option}`}
              />
            ))}
          </View>
        </View>
      ) : (
        <Text variant="caption" color="textMuted">
          They'll be added as a reporter.
        </Text>
      )}

      {submitError ? (
        <Text variant="caption" color="danger" testID="add-person-error">
          {submitError.message}
        </Text>
      ) : null}

      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Button
          label="Create"
          loading={submitting}
          onPress={() => void submit()}
          testID="add-person-submit"
        />
        <TextButton
          label="Back to search"
          onPress={onCancel}
          testID="add-person-cancel"
        />
      </View>
    </ScrollView>
  );
}

function Chip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      pressRetentionOffset={pressRetentionOffset}
      testID={props.testID}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.chip,
            {
              backgroundColor: props.selected
                ? theme.colors.surfaceRaised
                : theme.colors.surface,
              borderColor: theme.colors.borderStrong,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.md,
            },
          ]}
        >
          <Text variant="label" color={props.selected ? "primary" : "text"}>
            {props.label}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

function CreatedNotice(props: {
  person: Person;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  const { person, onDone, onAddAnother } = props;
  const theme = useTheme();
  const label = person.name || person.handle || `Person #${person.personId}`;
  return (
    <View
      style={[
        styles.fill,
        { padding: theme.spacing.lg, gap: theme.spacing.lg },
      ]}
      testID="add-person-created"
    >
      <Text variant="heading">Added</Text>
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Avatar person={person} size={48} />
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="body">{label}</Text>
          <Badge label={rungLabel(person.participationType)} tone="neutral" />
        </View>
      </View>
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Button label="Done" onPress={onDone} testID="add-person-done" />
        <TextButton
          label="Add another person"
          onPress={onAddAnother}
          testID="add-person-again"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  chip: {
    minHeight: touchTarget - 12,
    justifyContent: "center",
    borderWidth: 1,
  },
});
