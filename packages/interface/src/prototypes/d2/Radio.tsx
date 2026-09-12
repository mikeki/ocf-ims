// SPDX-License-Identifier: Apache-2.0

import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useState } from "react";
import { View } from "react-native";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import {
  AreaChooser,
  Chip,
  Composer,
  mentionedIds,
  type Picked,
  PriorityChips,
  TypeChooser,
} from "@/prototypes/d2/ingredients";
import { Dock, MiniBoard, MiniIncident } from "@/prototypes/d2/mini";
import { type FakeIms, useFakeIms } from "@/prototypes/d2/store";

// Radio — filing is sending a message (plan 09r). The Board carries a docked
// "What's happening?" bar; the first line is the summary, the whole text the
// first entry, and priority / type / area are chips you can tap and never
// must. On an incident the same bar is the composer.

type Screen = { kind: "board" } | { kind: "incident"; number: number };

export function Radio() {
  const ims = useFakeIms();
  const [screen, setScreen] = useState<Screen>({ kind: "board" });

  if (screen.kind === "incident") {
    const view = ims.incidents.find(
      (v) => v.incident?.number === screen.number,
    );
    if (view) {
      return (
        <MiniIncident
          view={view}
          areas={ims.areas}
          types={ims.types}
          onBack={() => setScreen({ kind: "board" })}
          footer={<AppendBar ims={ims} number={screen.number} />}
        />
      );
    }
  }
  return (
    <MiniBoard
      incidents={ims.incidents}
      areas={ims.areas}
      onOpen={(number) => setScreen({ kind: "incident", number })}
      footer={
        <QuickFile
          ims={ims}
          onFiled={(number) => setScreen({ kind: "incident", number })}
        />
      }
    />
  );
}

type Detail = "priority" | "type" | "area" | null;

function QuickFile(props: { ims: FakeIms; onFiled: (number: number) => void }) {
  const { ims } = props;
  const theme = useTheme();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [priority, setPriority] = useState(IncidentPriority.NORMAL);
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [areaSlug, setAreaSlug] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<Detail>(null);

  const area = areaSlug ? ims.areas.find((a) => a.slug === areaSlug) : null;
  const typeLabel =
    typeIds.length === 0
      ? "Type"
      : typeIds.length === 1
        ? (ims.types.find((t) => t.id === typeIds[0])?.name ?? "Type")
        : `${typeIds.length} types`;
  const priorityLabel =
    priority === IncidentPriority.HIGH
      ? "High"
      : priority === IncidentPriority.LOW
        ? "Low"
        : "Priority";

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const [firstLine] = trimmed.split("\n");
    const number = ims.file({
      summary: (firstLine ?? "").slice(0, 1024),
      priority,
      typeIds,
      areaSlug,
      entry: { text: trimmed, mentionIds: mentionedIds(trimmed, picked) },
    });
    setText("");
    setPicked([]);
    setPriority(IncidentPriority.NORMAL);
    setTypeIds([]);
    setAreaSlug(undefined);
    setOpen(null);
    props.onFiled(number);
  };

  return (
    <Dock testID="quick-file">
      <Composer
        label="What's happening?"
        value={text}
        onChangeText={setText}
        picked={picked}
        onPicked={setPicked}
        search={ims.search}
        placeholder="First line is the summary. @ to mention."
        rows={2}
        testID="quick-file-text"
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: theme.spacing.sm,
        }}
      >
        <Chip
          label={priorityLabel}
          tone={priority === IncidentPriority.HIGH ? "danger" : "neutral"}
          selected={priority !== IncidentPriority.NORMAL || open === "priority"}
          onPress={() => setOpen(open === "priority" ? null : "priority")}
          testID="quick-priority"
        />
        <Chip
          label={typeLabel}
          selected={typeIds.length > 0 || open === "type"}
          onPress={() => setOpen(open === "type" ? null : "type")}
          testID="quick-type"
        />
        <Chip
          label={area?.name ?? "Area"}
          selected={Boolean(area) || open === "area"}
          onPress={() => setOpen(open === "area" ? null : "area")}
          testID="quick-area"
        />
        <View style={{ flex: 1 }} />
        <Button
          label="Send"
          onPress={send}
          disabled={text.trim().length === 0}
          testID="quick-send"
        />
      </View>
      {open === "priority" ? (
        <PriorityChips
          value={priority}
          onChange={(p) => {
            setPriority(p);
            setOpen(null);
          }}
        />
      ) : null}
      {open === "type" ? (
        <TypeChooser
          types={ims.types}
          selected={typeIds}
          onToggle={(id) =>
            setTypeIds((all) =>
              all.includes(id) ? all.filter((x) => x !== id) : [...all, id],
            )
          }
          onPropose={ims.proposeType}
          canPropose
        />
      ) : null}
      {open === "area" ? (
        <AreaChooser
          areas={ims.areas}
          selected={areaSlug}
          onSelect={(slug) => {
            setAreaSlug(slug);
            if (slug) {
              setOpen(null);
            }
          }}
          onCreate={ims.createArea}
          canCreate
          limit={4}
        />
      ) : null}
    </Dock>
  );
}

function AppendBar(props: { ims: FakeIms; number: number }) {
  const { ims, number } = props;
  const theme = useTheme();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    ims.append(number, trimmed, mentionedIds(trimmed, picked));
    setText("");
    setPicked([]);
  };
  return (
    <Dock testID="append-bar">
      <Composer
        label="Add to the journal"
        value={text}
        onChangeText={setText}
        picked={picked}
        onPicked={setPicked}
        search={ims.search}
        placeholder="@ to mention someone"
        rows={2}
        testID="append-text"
      />
      <Box row align="center" justify="space-between" gap="sm">
        <Text variant="caption" color="textMuted">
          {`Posting as ${ims.people[0]?.handle ?? "you"}`}
        </Text>
        <View style={{ minWidth: theme.spacing.xxl * 3 }}>
          <Button
            label="Send"
            onPress={send}
            disabled={text.trim().length === 0}
            testID="append-send"
          />
        </View>
      </Box>
    </Dock>
  );
}
