// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import type {
  Crew,
  CrewMember,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/crew_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import {
  ParticipationType,
  PersonSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Badge } from "@/design/primitives/Badge";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { PersonPicker } from "@/features/compose/PersonPicker";
import { EmptyState } from "@/features/shell/EmptyState";
import { Avatar } from "@/prototypes/people/Avatar";
import type { Roster } from "@/prototypes/people/useRoster";

// My crews (docs/plans/09aa-roster-design.md § What is fixed, § What to
// build 4): `crews` arrives already filtered to what this viewer leads
// (`fake.ts`'s `ListMyCrews` mirrors the server, "crews the caller leads" —
// see that file's header note), so this component never re-derives
// leadership; an empty list is simply nobody led, and the caller (Harness)
// is expected to keep the nav word itself absent in that case (the brief's
// "the word is absent"), not this component returning null, so the panel
// still explains itself if it's ever opened anyway. "Add member" reuses
// `PersonPicker` (features/compose) exactly as built — its `picked` prop is
// never set here, so a pick fires `roster.addToCrew` and the field resets
// to a fresh search, ready for the next member, rather than settling into
// PersonPicker's own "on behalf of"-style picked state.

export interface MyCrewsProps {
  eventId: number;
  crews: Crew[];
  people: Person[];
  roster: Roster;
}

export function MyCrews(props: MyCrewsProps) {
  const { eventId, crews, people, roster } = props;
  const theme = useTheme();
  const byId = useMemo(() => {
    const map = new Map<number, Person>();
    for (const p of people) {
      map.set(p.personId, p);
    }
    return map;
  }, [people]);

  if (crews.length === 0) {
    return (
      <EmptyState
        title="No crews"
        message="You do not lead a crew for this event."
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { padding: theme.spacing.lg, gap: theme.spacing.xl },
      ]}
      testID="my-crews"
    >
      {crews.map((crew) => (
        <CrewSection
          key={crew.slug ?? crew.name}
          eventId={eventId}
          crew={crew}
          byId={byId}
          roster={roster}
        />
      ))}
    </ScrollView>
  );
}

function CrewSection(props: {
  eventId: number;
  crew: Crew;
  byId: Map<number, Person>;
  roster: Roster;
}) {
  const { eventId, crew, byId, roster } = props;
  const theme = useTheme();
  const slug = crew.slug ?? "";

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="heading">{crew.name || slug}</Text>
      <Text variant="caption" color="textMuted">
        Crew leaders are assigned by an admin.
      </Text>
      <View style={{ gap: theme.spacing.xs }}>
        {crew.members.map((member, index) => (
          <MemberRow
            key={member.person?.personId ?? `unknown-${index}`}
            member={member}
            crewSlug={slug}
            person={
              member.person ? byId.get(member.person.personId) : undefined
            }
            roster={roster}
          />
        ))}
      </View>
      <PersonPicker
        eventId={eventId}
        label="Add member"
        placeholder="Name or handle"
        onPick={(person) => void roster.addToCrew(slug, person.personId)}
        onClear={() => undefined}
        testID={`my-crews-${slug}-add`}
      />
    </View>
  );
}

function MemberRow(props: {
  member: CrewMember;
  crewSlug: string;
  person: Person | undefined;
  roster: Roster;
}) {
  const { member, crewSlug, person, roster } = props;
  const theme = useTheme();
  const personId = member.person?.personId;
  const label =
    person?.name ||
    person?.handle ||
    member.person?.name ||
    member.person?.handle ||
    (personId !== undefined ? `Person #${personId}` : "Unknown");
  const avatarPerson =
    person ??
    create(PersonSchema, {
      personId: personId ?? -1,
      handle: member.person?.handle,
      name: member.person?.name,
      hasPassword: false,
      isAdmin: false,
      participationType: ParticipationType.UNSPECIFIED,
      crews: [],
    });
  const pending = personId !== undefined && roster.pendingFor(personId);
  const error = personId !== undefined ? roster.errorFor(personId) : undefined;

  return (
    <View
      style={[
        styles.row,
        {
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Avatar person={avatarPerson} size={32} />
      <Text style={styles.fill} numberOfLines={1}>
        {label}
      </Text>
      {member.isLeader ? (
        <Badge label="Leader" tone="info" />
      ) : personId === undefined ? null : (
        <TextButton
          label={pending ? "Removing…" : "Remove"}
          onPress={() => {
            if (!pending) {
              void roster.removeFromCrew(crewSlug, personId);
            }
          }}
          testID={`my-crews-${crewSlug}-remove-${personId}`}
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

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
});
