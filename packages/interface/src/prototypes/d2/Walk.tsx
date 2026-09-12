// SPDX-License-Identifier: Apache-2.0

import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useState } from "react";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import {
  AreaChooser,
  Composer,
  mentionedIds,
  type Picked,
  PriorityChips,
  Section,
  TypeChooser,
} from "@/prototypes/d2/ingredients";
import {
  Dock,
  FormScreen,
  MiniBoard,
  MiniIncident,
} from "@/prototypes/d2/mini";
import { type FakeIms, useFakeIms } from "@/prototypes/d2/store";

// Walk — filing is a few questions (plan 09r): what happened → where → how
// urgent and what kind → file, one question per screen, skip on the optional
// ones. Appending is the composer as a screen of its own.

type Screen =
  | { kind: "board" }
  | { kind: "what" }
  | { kind: "where" }
  | { kind: "how" }
  | { kind: "incident"; number: number }
  | { kind: "compose"; number: number };

interface Draft {
  summary: string;
  notes: string;
  picked: Picked[];
  areaSlug?: string;
  booth: string;
  priority: IncidentPriority;
  typeIds: number[];
}

const EMPTY: Draft = {
  summary: "",
  notes: "",
  picked: [],
  booth: "",
  priority: IncidentPriority.NORMAL,
  typeIds: [],
};

export function Walk() {
  const ims = useFakeIms();
  const [screen, setScreen] = useState<Screen>({ kind: "board" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const file = () => {
    const notes = draft.notes.trim();
    const number = ims.file({
      summary: draft.summary.trim(),
      priority: draft.priority,
      typeIds: draft.typeIds,
      areaSlug: draft.areaSlug,
      booth: draft.booth.trim(),
      entry: notes
        ? { text: notes, mentionIds: mentionedIds(notes, draft.picked) }
        : undefined,
    });
    setDraft(EMPTY);
    setScreen({ kind: "incident", number });
  };
  const cancel = () => {
    setDraft(EMPTY);
    setScreen({ kind: "board" });
  };

  switch (screen.kind) {
    case "what":
      return (
        <FormScreen
          title="What happened?"
          back={{ label: "Cancel", onPress: cancel }}
          right={<Step n={1} />}
          footer={
            <Dock>
              <Button
                label="Next"
                onPress={() => setScreen({ kind: "where" })}
                disabled={draft.summary.trim().length === 0}
                testID="walk-next"
              />
            </Dock>
          }
        >
          <Field
            label="In one line"
            value={draft.summary}
            onChangeText={(summary) => patch({ summary })}
            placeholder="Lost child near the main stage"
            autoFocus
            testID="summary"
          />
          <Composer
            label="Anything else"
            value={draft.notes}
            onChangeText={(notes) => patch({ notes })}
            picked={draft.picked}
            onPicked={(picked) => patch({ picked })}
            search={ims.search}
            placeholder="Optional. @ to mention."
            rows={4}
            testID="first-entry"
          />
        </FormScreen>
      );
    case "where":
      return (
        <FormScreen
          title="Where?"
          back={{ label: "Back", onPress: () => setScreen({ kind: "what" }) }}
          right={<Step n={2} />}
          footer={
            <Dock>
              <Box row gap="sm" align="center" justify="space-between">
                <TextButton
                  label="Skip"
                  onPress={() => setScreen({ kind: "how" })}
                  testID="walk-skip"
                />
                <Button
                  label="Next"
                  onPress={() => setScreen({ kind: "how" })}
                  testID="walk-next"
                />
              </Box>
            </Dock>
          }
        >
          <AreaChooser
            areas={ims.areas}
            selected={draft.areaSlug}
            onSelect={(areaSlug) => patch({ areaSlug })}
            onCreate={ims.createArea}
            canCreate
            limit={12}
          />
          <Field
            label="Booth"
            value={draft.booth}
            onChangeText={(booth) => patch({ booth })}
            placeholder="Booth number, if any"
          />
        </FormScreen>
      );
    case "how":
      return (
        <FormScreen
          title="How urgent, what kind?"
          back={{ label: "Back", onPress: () => setScreen({ kind: "where" }) }}
          right={<Step n={3} />}
          footer={
            <Dock>
              <Box row gap="sm" align="center" justify="space-between">
                <TextButton label="Skip" onPress={file} testID="walk-skip" />
                <Button
                  label="File incident"
                  onPress={file}
                  testID="file-incident"
                />
              </Box>
            </Dock>
          }
        >
          <Section title="Priority">
            <PriorityChips
              value={draft.priority}
              onChange={(priority) => patch({ priority })}
            />
          </Section>
          <Section title="Types">
            <TypeChooser
              types={ims.types}
              selected={draft.typeIds}
              onToggle={(id) =>
                patch({
                  typeIds: draft.typeIds.includes(id)
                    ? draft.typeIds.filter((x) => x !== id)
                    : [...draft.typeIds, id],
                })
              }
              onPropose={ims.proposeType}
              canPropose
            />
          </Section>
        </FormScreen>
      );
    case "incident":
    case "compose": {
      const view = ims.incidents.find(
        (v) => v.incident?.number === screen.number,
      );
      if (!view) {
        break;
      }
      if (screen.kind === "compose") {
        return (
          <ComposeStep
            ims={ims}
            number={screen.number}
            onDone={() =>
              setScreen({ kind: "incident", number: screen.number })
            }
          />
        );
      }
      return (
        <MiniIncident
          view={view}
          areas={ims.areas}
          types={ims.types}
          onBack={() => setScreen({ kind: "board" })}
          footer={
            <Dock>
              <Button
                label="Add an entry"
                onPress={() =>
                  setScreen({ kind: "compose", number: screen.number })
                }
                testID="new-entry"
              />
            </Dock>
          }
        />
      );
    }
    default:
      break;
  }
  return (
    <MiniBoard
      incidents={ims.incidents}
      areas={ims.areas}
      onOpen={(number) => setScreen({ kind: "incident", number })}
      right={
        <TextButton
          label="New"
          onPress={() => setScreen({ kind: "what" })}
          testID="new-incident"
        />
      }
    />
  );
}

function Step(props: { n: number }) {
  return (
    <Text variant="label" color="textMuted">
      {`${props.n} of 3`}
    </Text>
  );
}

function ComposeStep(props: {
  ims: FakeIms;
  number: number;
  onDone: () => void;
}) {
  const { ims, number } = props;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const add = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    ims.append(number, trimmed, mentionedIds(trimmed, picked));
    props.onDone();
  };
  return (
    <FormScreen
      title={`Add to #${number}`}
      back={{ label: "Cancel", onPress: props.onDone }}
      footer={
        <Dock>
          <Button
            label="Add entry"
            onPress={add}
            disabled={text.trim().length === 0}
            testID="add-entry"
          />
        </Dock>
      }
    >
      <Composer
        label="What's new"
        value={text}
        onChangeText={setText}
        picked={picked}
        onPicked={setPicked}
        search={ims.search}
        placeholder="@ to mention someone"
        autoFocus
        rows={6}
        testID="entry-text"
      />
    </FormScreen>
  );
}
