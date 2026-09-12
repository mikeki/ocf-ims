// SPDX-License-Identifier: Apache-2.0

import { IncidentPriority } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { useState } from "react";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
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

// Intake — filing is a form (plan 09r). "New" on the Board opens a full-screen
// form in the incident's own order; appending is a "New entry" button that
// opens a composer sheet over the incident.

type Screen =
  | { kind: "board" }
  | { kind: "new" }
  | { kind: "incident"; number: number }
  | { kind: "compose"; number: number };

export function Intake() {
  const ims = useFakeIms();
  const [screen, setScreen] = useState<Screen>({ kind: "board" });

  switch (screen.kind) {
    case "new":
      return (
        <NewIncidentForm
          ims={ims}
          onCancel={() => setScreen({ kind: "board" })}
          onFiled={(number) => setScreen({ kind: "incident", number })}
        />
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
          <ComposeSheet
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
          afterJournal={
            <Button
              label="New entry"
              variant="secondary"
              onPress={() =>
                setScreen({ kind: "compose", number: screen.number })
              }
              testID="new-entry"
            />
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
          onPress={() => setScreen({ kind: "new" })}
          testID="new-incident"
        />
      }
    />
  );
}

function NewIncidentForm(props: {
  ims: FakeIms;
  onCancel: () => void;
  onFiled: (number: number) => void;
}) {
  const { ims } = props;
  const [summary, setSummary] = useState("");
  const [priority, setPriority] = useState(IncidentPriority.NORMAL);
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [areaSlug, setAreaSlug] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [booth, setBooth] = useState("");
  const [entry, setEntry] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);

  const file = () => {
    const trimmed = entry.trim();
    const number = ims.file({
      summary: summary.trim(),
      priority,
      typeIds,
      areaSlug,
      description: description.trim(),
      booth: booth.trim(),
      entry: trimmed
        ? { text: trimmed, mentionIds: mentionedIds(trimmed, picked) }
        : undefined,
    });
    props.onFiled(number);
  };

  return (
    <FormScreen
      title="New incident"
      back={{ label: "Cancel", onPress: props.onCancel }}
      footer={
        <Dock>
          <Button
            label="File incident"
            onPress={file}
            disabled={summary.trim().length === 0}
            testID="file-incident"
          />
        </Dock>
      }
    >
      <Field
        label="Summary"
        value={summary}
        onChangeText={setSummary}
        placeholder="What is it, in one line"
        autoFocus
        testID="summary"
      />
      <Section title="Priority">
        <PriorityChips value={priority} onChange={setPriority} />
      </Section>
      <Section title="Types">
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
      </Section>
      <Section title="Location">
        <Box gap="md">
          <AreaChooser
            areas={ims.areas}
            selected={areaSlug}
            onSelect={setAreaSlug}
            onCreate={ims.createArea}
            canCreate
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Near what, which side"
          />
          <Field
            label="Booth"
            value={booth}
            onChangeText={setBooth}
            placeholder="Booth number, if any"
          />
        </Box>
      </Section>
      <Section title="First entry">
        <Composer
          label="Notes"
          value={entry}
          onChangeText={setEntry}
          picked={picked}
          onPicked={setPicked}
          search={ims.search}
          placeholder="What you saw. @ to mention."
          testID="first-entry"
        />
      </Section>
    </FormScreen>
  );
}

function ComposeSheet(props: {
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
      title={`New entry on #${number}`}
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
        label="Entry"
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
