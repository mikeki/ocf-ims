// SPDX-License-Identifier: Apache-2.0

import type { Area } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/area_pb";
import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import type { IncidentType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_type_pb";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Box } from "@/design/primitives/Box";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, type Tone, touchTarget } from "@/design/tokens";

// The ingredients every D2 variant shares (plan 09r): the composer with its
// `@` typeahead, and the priority / type / area choosers. Identical across
// variants so the round compares flows, not three composer designs.

// --- mentions (the rules from 09r § Mentions) ---------------------------

export interface Picked {
  personId: number;
  token: string;
}

/** The `@word` the caret is inside, or null. */
export function mentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) {
    return null;
  }
  if (at > 0 && !/\s/.test(upto.charAt(at - 1))) {
    return null;
  }
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) {
    return null;
  }
  return { start: at, query };
}

/** One bare word: the handle, else the name. */
export function tokenFor(p: Person): string {
  return `@${p.handle?.trim() || p.name || ""}`;
}

/** Only the mentions whose token is still in the text are sent. */
export function mentionedIds(text: string, picked: Picked[]): number[] {
  const ids = new Set<number>();
  for (const m of picked) {
    if (text.includes(m.token)) {
      ids.add(m.personId);
    }
  }
  return [...ids];
}

// --- the composer -----------------------------------------------------

export interface ComposerProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  picked: Picked[];
  onPicked: (picked: Picked[]) => void;
  search: (query: string) => Person[];
  placeholder?: string;
  autoFocus?: boolean;
  /** Lines the box shows at rest. */
  rows?: number;
  testID?: string;
}

export function Composer(props: ComposerProps) {
  const { value, onChangeText, picked, onPicked, search } = props;
  const theme = useTheme();
  const [caret, setCaret] = useState(0);
  const query = mentionQuery(value, caret);
  const matches = query ? search(query.query) : [];

  const pick = (person: Person) => {
    if (!query) {
      return;
    }
    const token = tokenFor(person);
    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const next = `${before}${token} ${after}`;
    onChangeText(next);
    onPicked([...picked, { personId: person.personId, token }]);
    setCaret(before.length + token.length + 1);
  };

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Field
        label={props.label}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        multiline
        testID={props.testID}
        style={{
          minHeight:
            (props.rows ?? 3) * (theme.type.body.lineHeight ?? 20) + 16,
          paddingTop: theme.spacing.sm,
          textAlignVertical: "top",
        }}
      />
      {matches.length > 0 ? (
        <View
          accessibilityRole="list"
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderStrong,
            borderWidth: 1,
            borderRadius: theme.radii.md,
            overflow: "hidden",
          }}
        >
          {matches.slice(0, 5).map((p) => (
            <Pressable
              key={p.personId}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${p.handle || p.name}`}
              onPress={() => pick(p)}
              pressRetentionOffset={pressRetentionOffset}
              testID={`mention-${p.personId}`}
            >
              {({ pressed }) => (
                <PressFeedback
                  pressed={pressed}
                  style={[
                    styles.mentionRow,
                    {
                      paddingHorizontal: theme.spacing.md,
                      gap: theme.spacing.sm,
                      borderBottomColor: theme.colors.border,
                    },
                  ]}
                >
                  <Text variant="label">{p.handle || p.name}</Text>
                  {p.handle && p.name ? (
                    <Text variant="caption" color="textMuted">
                      {p.name}
                    </Text>
                  ) : null}
                </PressFeedback>
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// --- chips ------------------------------------------------------------

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: Tone;
  testID?: string;
}

/** A selectable chip: the badge's tint when on, an outlined control when off. */
export function Chip(props: ChipProps) {
  const { label, selected, onPress, tone = "info" } = props;
  const theme = useTheme();
  const { ink, tint } = theme.tones[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      pressRetentionOffset={pressRetentionOffset}
      hitSlop={{ top: theme.spacing.sm, bottom: theme.spacing.sm }}
      testID={props.testID}
    >
      {({ pressed }) => (
        <PressFeedback
          pressed={pressed}
          style={[
            styles.chip,
            {
              backgroundColor: selected ? tint : theme.colors.surface,
              borderColor: selected ? tint : theme.colors.borderStrong,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            },
          ]}
        >
          <Text
            variant="label"
            style={{ color: selected ? ink : theme.colors.textMuted }}
          >
            {label}
          </Text>
        </PressFeedback>
      )}
    </Pressable>
  );
}

export interface PriorityChipsProps {
  value: IncidentPriority;
  onChange: (priority: IncidentPriority) => void;
}

export function PriorityChips(props: PriorityChipsProps) {
  const theme = useTheme();
  const options: [IncidentPriority, string, Tone][] = [
    [IncidentPriority.LOW, "Low", "neutral"],
    [IncidentPriority.NORMAL, "Normal", "info"],
    [IncidentPriority.HIGH, "High", "danger"],
  ];
  return (
    <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
      {options.map(([priority, label, tone]) => (
        <Chip
          key={priority}
          label={label}
          tone={tone}
          selected={props.value === priority}
          onPress={() => props.onChange(priority)}
          testID={`priority-${label.toLowerCase()}`}
        />
      ))}
    </View>
  );
}

// --- types ------------------------------------------------------------

export interface TypeChooserProps {
  types: IncidentType[];
  selected: number[];
  onToggle: (id: number) => void;
  /** ProposeIncidentType; returns the id to attach. */
  onPropose: (name: string) => number;
  canPropose: boolean;
}

const OTHER = "Other";

export function TypeChooser(props: TypeChooserProps) {
  const { types, selected, onToggle, onPropose, canPropose } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [prompting, setPrompting] = useState(false);
  const q = query.trim().toLowerCase();
  const visible = types.filter(
    (t) =>
      !t.hidden &&
      (selected.includes(t.id) || (t.name ?? "").toLowerCase().includes(q)),
  );
  const exact = types.some(
    (t) => !t.hidden && (t.name ?? "").trim().toLowerCase() === q,
  );
  const offer = canPropose && q.length >= 2 && !exact;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Field
        label="Type"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPrompting(false);
        }}
        placeholder={prompting ? "Type a new type name" : "Search types"}
        autoFocus={prompting}
        testID="type-search"
      />
      <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
        {visible.map((t) => (
          <Chip
            key={t.id}
            label={t.name ?? `Type #${t.id}`}
            selected={selected.includes(t.id)}
            onPress={() => onToggle(t.id)}
            testID={`type-${t.id}`}
          />
        ))}
        {!q || OTHER.toLowerCase().includes(q) ? (
          <Chip
            label={OTHER}
            tone="neutral"
            selected={false}
            onPress={() => {
              setQuery("");
              setPrompting(true);
            }}
            testID="type-other"
          />
        ) : null}
      </View>
      {offer ? (
        <Offer
          label={`Propose “${query.trim()}” as a new type`}
          onPress={() => {
            const id = onPropose(query.trim());
            if (!selected.includes(id)) {
              onToggle(id);
            }
            setQuery("");
          }}
          testID="type-propose"
        />
      ) : null}
    </View>
  );
}

// --- areas ------------------------------------------------------------

export interface AreaChooserProps {
  areas: Area[];
  selected: string | undefined;
  onSelect: (slug: string | undefined) => void;
  /** CreateArea; returns the slug to set. */
  onCreate: (name: string) => string;
  canCreate: boolean;
  /** Rows shown before the list is cut. */
  limit?: number;
}

export function AreaChooser(props: AreaChooserProps) {
  const { areas, selected, onSelect, onCreate, canCreate } = props;
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const current = selected ? areas.find((a) => a.slug === selected) : null;

  if (current) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="label" color="textMuted">
          Area
        </Text>
        <View style={[styles.wrap, { gap: theme.spacing.sm }]}>
          <Chip
            label={current.name ?? current.slug}
            selected
            onPress={() => onSelect(undefined)}
            testID="area-selected"
          />
          <TextButton label="Change" onPress={() => onSelect(undefined)} />
        </View>
      </View>
    );
  }

  const matches = areas
    .filter((a) => !q || (a.name ?? a.slug).toLowerCase().includes(q))
    .slice(0, props.limit ?? 6);
  const exact = areas.some(
    (a) => (a.name ?? "").trim().toLowerCase() === q && q.length > 0,
  );
  const offer = canCreate && q.length >= 2 && !exact;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Field
        label="Area"
        value={query}
        onChangeText={setQuery}
        placeholder="Search areas"
        testID="area-search"
      />
      <View
        style={{
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: theme.radii.md,
          overflow: "hidden",
        }}
      >
        {matches.map((a) => (
          <Pressable
            key={a.slug}
            accessibilityRole="button"
            accessibilityLabel={a.name ?? a.slug}
            onPress={() => {
              onSelect(a.slug);
              setQuery("");
            }}
            pressRetentionOffset={pressRetentionOffset}
            testID={`area-${a.slug}`}
          >
            {({ pressed }) => (
              <PressFeedback
                pressed={pressed}
                style={[
                  styles.areaRow,
                  {
                    paddingHorizontal: theme.spacing.md,
                    backgroundColor: theme.colors.surface,
                    borderBottomColor: theme.colors.border,
                  },
                ]}
              >
                <Text>{a.name ?? a.slug}</Text>
                {a.approved === false ? (
                  <Text variant="caption" color="textMuted">
                    proposed
                  </Text>
                ) : null}
              </PressFeedback>
            )}
          </Pressable>
        ))}
        {matches.length === 0 && !offer ? (
          <View
            style={[styles.areaRow, { paddingHorizontal: theme.spacing.md }]}
          >
            <Text color="textMuted">No area matches</Text>
          </View>
        ) : null}
      </View>
      {offer ? (
        <Offer
          label={`Create “${query.trim()}” for this event`}
          onPress={() => {
            onSelect(onCreate(query.trim()));
            setQuery("");
          }}
          testID="area-create"
        />
      ) : null}
    </View>
  );
}

// --- small shared pieces ---------------------------------------------

function Offer(props: { label: string; onPress: () => void; testID: string }) {
  return (
    <Box row align="center" gap="sm">
      <TextButton
        label={props.label}
        onPress={props.onPress}
        testID={props.testID}
      />
    </Box>
  );
}

/** A form section: a heading over its content. */
export function Section(props: { title: string; children: ReactNode }) {
  return (
    <Box gap="sm">
      <Text variant="heading">{props.title}</Text>
      {props.children}
    </Box>
  );
}

const styles = StyleSheet.create({
  mentionRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  areaRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
