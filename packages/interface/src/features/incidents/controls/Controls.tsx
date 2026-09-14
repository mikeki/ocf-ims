// SPDX-License-Identifier: Apache-2.0

import {
  createConnectQueryKey,
  useMutation,
  useTransport,
} from "@connectrpc/connect-query";
import {
  IncidentPriority,
  IncidentState,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/incident_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";
import { AreaChooser } from "@/features/compose/AreaChooser";
import { useCreateArea, useProposeType } from "@/features/compose/hooks";
import { TypeChooser } from "@/features/compose/TypeChooser";
import { FieldError, Label } from "@/features/incidents/controls/bits";
import { OutcomeChooser } from "@/features/incidents/controls/OutcomeChooser";
import { PrivateToggle } from "@/features/incidents/controls/PrivateToggle";
import { Segmented } from "@/features/incidents/controls/Segmented";
import { StartedField } from "@/features/incidents/controls/StartedField";
import { SavingField } from "@/features/incidents/SavingField";
import type { EditIncident } from "@/features/incidents/useEditIncident";
import type { EditorData } from "@/features/incidents/useEditorData";

// The field controls, one per wire field (plan 09y), bound to the edit hook:
// each is the same control in every variant — the variants decide only
// where it sits and whether the value is pressed first to reach it. Every
// one takes `disabled` (a reader sees the same shape, not a missing one).

export interface ControlProps {
  data: EditorData;
  edit: EditIncident;
  eventId: number;
  disabled?: boolean;
  /** In-place shapes: the control hands back when its save settles. */
  onDone?: () => void;
  autoFocus?: boolean;
  /** Field label shown above (the Form and the rail); off where the value's context labels it. */
  labelled?: boolean;
}

function incidentOf(props: ControlProps) {
  return props.data.view?.incident;
}

export function StateControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <Labelled label="State" show={props.labelled}>
      <Segmented
        accessibilityLabel="State"
        options={[
          { key: IncidentState.OPEN, label: "Open", tone: "info" },
          { key: IncidentState.CLOSED, label: "Closed", tone: "neutral" },
        ]}
        value={incident?.state ?? IncidentState.OPEN}
        onChange={(state) => {
          if (state !== incident?.state) {
            void props.edit.setState(state).catch(() => {});
          }
          props.onDone?.();
        }}
        disabled={props.disabled}
        error={props.edit.status("state").error}
        testID="state-control"
      />
    </Labelled>
  );
}

export function PriorityControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <Labelled label="Priority" show={props.labelled}>
      <Segmented
        accessibilityLabel="Priority"
        options={[
          { key: IncidentPriority.LOW, label: "Low", tone: "neutral" },
          { key: IncidentPriority.NORMAL, label: "Normal" },
          { key: IncidentPriority.HIGH, label: "High", tone: "danger" },
        ]}
        value={
          incident?.priority === IncidentPriority.UNSPECIFIED
            ? IncidentPriority.NORMAL
            : (incident?.priority ?? IncidentPriority.NORMAL)
        }
        onChange={(priority) => {
          if (priority !== incident?.priority) {
            void props.edit.setPriority(priority).catch(() => {});
          }
          props.onDone?.();
        }}
        disabled={props.disabled}
        error={props.edit.status("priority").error}
        testID="priority-control"
      />
    </Labelled>
  );
}

export function PrivateControl(props: ControlProps & { copy?: boolean }) {
  const incident = incidentOf(props);
  return (
    <Labelled label="Private" show={props.labelled}>
      <PrivateToggle
        value={incident?.private === true}
        onChange={(value) => {
          void props.edit.setPrivate(value).catch(() => {});
        }}
        enabled={!props.disabled && props.data.gates.mayTogglePrivate}
        error={props.edit.status("private").error}
        copy={props.copy}
      />
    </Labelled>
  );
}

export function SummaryControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <SavingField
      label="Summary"
      value={incident?.summary ?? ""}
      placeholder="One line: what and where"
      maxLength={1024}
      onSave={props.edit.setSummary}
      saveError={props.edit.status("summary").error}
      disabled={props.disabled}
      onDone={props.onDone}
      autoFocus={props.autoFocus}
      testID="summary-field"
    />
  );
}

export function StartedControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <StartedField
      value={incident?.started}
      onSave={props.edit.setStarted}
      saveError={props.edit.status("started").error}
      disabled={props.disabled}
      onDone={props.onDone}
      autoFocus={props.autoFocus}
    />
  );
}

export function DetailsControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <SavingField
      label="Location details"
      value={incident?.location?.description ?? ""}
      placeholder="Where exactly"
      multiline
      onSave={props.edit.setDescription}
      saveError={props.edit.status("description").error}
      disabled={props.disabled}
      onDone={props.onDone}
      autoFocus={props.autoFocus}
      testID="details-field"
    />
  );
}

export function BoothControl(props: ControlProps) {
  const incident = incidentOf(props);
  return (
    <SavingField
      label="Booth"
      value={incident?.location?.booth ?? ""}
      placeholder="Booth number"
      maxLength={32}
      onSave={props.edit.setBooth}
      saveError={props.edit.status("booth").error}
      disabled={props.disabled}
      onDone={props.onDone}
      autoFocus={props.autoFocus}
      testID="booth-field"
    />
  );
}

export function AreaControl(props: ControlProps) {
  const incident = incidentOf(props);
  const createArea = useCreateArea(props.eventId);
  const status = props.edit.status("area");
  if (props.disabled) {
    return (
      <Labelled label="Area" show={props.labelled}>
        <Text color="textMuted">{areaLabel(props) ?? "No area"}</Text>
      </Labelled>
    );
  }
  return (
    <View>
      <AreaChooser
        areas={props.data.lookups.areas}
        selected={incident?.location?.areaSlug || undefined}
        onSelect={(slug) => {
          void props.edit.setArea(slug).catch(() => {});
          if (slug !== undefined) {
            props.onDone?.();
          }
        }}
        onCreate={createArea}
        canCreate={props.data.gates.writeIncidents}
      />
      <FieldError error={status.error} />
    </View>
  );
}

export function areaLabel(
  props: Pick<ControlProps, "data">,
): string | undefined {
  const slug = props.data.view?.incident?.location?.areaSlug;
  if (!slug) {
    return undefined;
  }
  return props.data.lookups.areas?.find((a) => a.slug === slug)?.name || slug;
}

export function TypesControl(props: ControlProps) {
  const incident = incidentOf(props);
  const propose = useProposeType(props.eventId);
  const selected = incident?.incidentTypeIds ?? [];
  const status = props.edit.status("types");
  if (props.disabled) {
    return (
      <Labelled label="Types" show={props.labelled}>
        <Text color="textMuted">{typeNames(props) || "None"}</Text>
      </Labelled>
    );
  }
  return (
    <View>
      <TypeChooser
        types={props.data.lookups.types}
        selected={selected}
        onToggle={(id) => {
          const next = selected.includes(id)
            ? selected.filter((t) => t !== id)
            : [...selected, id];
          void props.edit.setTypes(next).catch(() => {});
        }}
        onPropose={propose}
        canPropose={props.data.gates.writeIncidents}
      />
      <FieldError error={status.error} />
    </View>
  );
}

export function typeNames(props: Pick<ControlProps, "data">): string {
  const ids = props.data.view?.incident?.incidentTypeIds ?? [];
  return ids
    .map(
      (id) =>
        props.data.lookups.types?.find((t) => t.id === id)?.name ??
        `Type #${id}`,
    )
    .join(", ");
}

export function OutcomeControl(props: ControlProps) {
  const incident = incidentOf(props);
  const transport = useTransport();
  const queryClient = useQueryClient();
  const mutation = useMutation(ImsService.method.proposeOutcome, {
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: ImsService.method.listOutcomes,
          transport,
          cardinality: "finite",
        }),
      });
    },
  });
  const propose = useCallback(
    async (name: string) => {
      const res = await mutation.mutateAsync({
        eventId: props.eventId,
        outcome: { name },
      });
      return res.outcomeId;
    },
    [mutation.mutateAsync, props.eventId],
  );
  return (
    <Labelled label="Outcome" show={props.labelled}>
      <OutcomeChooser
        outcomes={props.data.lookups.outcomes}
        selected={incident?.outcomeId}
        onSelect={(id) => {
          void props.edit.setOutcome(id).catch(() => {});
          props.onDone?.();
        }}
        onPropose={propose}
        canPropose={props.data.gates.writeIncidents}
        disabled={props.disabled}
        error={props.edit.status("outcome").error}
      />
    </Labelled>
  );
}

export function outcomeName(
  props: Pick<ControlProps, "data">,
): string | undefined {
  const id = props.data.view?.incident?.outcomeId;
  if (!id) {
    return undefined;
  }
  return (
    props.data.lookups.outcomes?.find((o) => o.id === id)?.name ??
    `Outcome #${id}`
  );
}

function Labelled(props: {
  label: string;
  show: boolean | undefined;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  if (!props.show) {
    return <>{props.children}</>;
  }
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Label>{props.label}</Label>
      {props.children}
    </View>
  );
}
