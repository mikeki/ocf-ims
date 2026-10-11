// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { ReactNode } from "react";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { Avatar } from "@/features/people/Avatar";
import { RoleMenu } from "@/features/people/RoleMenu";
import {
  mayRemove,
  type RosterAccess,
  rungLabel,
  rungsFor,
} from "@/features/people/roles";
import type { Roster } from "@/features/people/useRoster";

// The profile card (docs/plans/09aa-roster-design.md § What is fixed):
// picture (larger here than a row's 32px), name, handle, this event's role,
// crews (a led one marked), wristband; email/phone rows ONLY when the
// server sent them, the admin shield ONLY when is_admin came — nothing
// implies a withheld field exists (§ Privacy). Ejected is offered to an
// admin only: an inviter's ceiling stops at Not present. The role menu is the
// roster's one edit; Remove from event sits behind a confirm with its two
// forms, Not present / Ejected (never a silent write, unlike a role change
// within the ceiling).

export interface ProfileCardProps {
  person: Person;
  access: RosterAccess;
  roster: Roster;
}

export function ProfileCard(props: ProfileCardProps) {
  const { person, access, roster } = props;
  const theme = useTheme();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const rungs = rungsFor(access, person);
  const removable = mayRemove(access, person);
  const pending = roster.pendingFor(person.personId);
  const error = roster.errorFor(person.personId);
  const displayName =
    person.name || person.handle || `Person #${person.personId}`;

  const doRemove = (rung: ParticipationType) => {
    setConfirmingRemove(false);
    void roster.remove(person.personId, rung);
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { padding: theme.spacing.lg, gap: theme.spacing.lg },
      ]}
      testID="profile-card"
    >
      <View style={[styles.row, { gap: theme.spacing.md }]}>
        <Avatar person={person} size={64} />
        <View style={{ gap: theme.spacing.xs, flexShrink: 1 }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Text variant="title" numberOfLines={1}>
              {displayName}
            </Text>
            {person.isAdmin ? <Badge label="Admin" tone="restricted" /> : null}
          </View>
          {person.handle && person.name ? (
            <Text variant="body" color="textMuted">
              {person.handle}
            </Text>
          ) : null}
          {!person.hasPassword ? (
            <Text variant="caption" color="textMuted">
              No login
            </Text>
          ) : null}
        </View>
      </View>

      <Field label="Role">
        <RoleMenu
          person={person}
          rungs={rungs}
          onSelect={(rung) => void roster.setRole(person.personId, rung)}
          pending={pending}
          error={error}
          testID="profile-role-menu"
        />
      </Field>

      {person.crews.length > 0 ? (
        <Field label="Crews">
          <View
            style={[styles.row, { flexWrap: "wrap", gap: theme.spacing.sm }]}
          >
            {person.crews.map((c) => (
              <Badge
                key={c.crewSlug}
                label={c.isLeader ? `${c.crewName} · leads` : c.crewName}
                tone={c.isLeader ? "info" : "neutral"}
              />
            ))}
          </View>
        </Field>
      ) : null}

      {person.wristband ? (
        <Field label="Wristband">
          <Text variant="body">{person.wristband}</Text>
        </Field>
      ) : null}

      {person.email ? (
        <Field label="Email">
          <Text variant="body">{person.email}</Text>
        </Field>
      ) : null}

      {person.phone ? (
        <Field label="Phone">
          <Text variant="body">{person.phone}</Text>
        </Field>
      ) : null}

      {removable ? (
        <View style={{ gap: theme.spacing.sm }}>
          {confirmingRemove ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="label" color="textMuted">
                Remove {displayName} from this event?
              </Text>
              <View style={[styles.row, { gap: theme.spacing.md }]}>
                <TextButton
                  label={rungLabel(ParticipationType.NOT_PRESENT)}
                  onPress={() => doRemove(ParticipationType.NOT_PRESENT)}
                  testID="profile-remove-not-present"
                />
                {access.admin ? (
                  <TextButton
                    label={rungLabel(ParticipationType.EJECTED)}
                    onPress={() => doRemove(ParticipationType.EJECTED)}
                    testID="profile-remove-ejected"
                  />
                ) : null}
                <TextButton
                  label="Cancel"
                  onPress={() => setConfirmingRemove(false)}
                />
              </View>
            </View>
          ) : (
            <TextButton
              label="Remove from event"
              onPress={() => setConfirmingRemove(true)}
              testID="profile-remove"
            />
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label" color="textMuted">
        {props.label}
      </Text>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center" },
});
