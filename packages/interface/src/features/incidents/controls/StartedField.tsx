// SPDX-License-Identifier: Apache-2.0

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { AppError } from "@/api/errors";
import {
  formatStarted,
  parseStarted,
  STARTED_FORMAT,
  validateStarted,
} from "@/features/incidents/controls/fields";
import { SavingField } from "@/features/incidents/SavingField";

// The started control (plan 09y decision 6): one text field with a strict
// local-time format, the same on web and native. A native picker is a
// later choice; the round only needs one control that works everywhere.

export interface StartedFieldProps {
  value: Timestamp | undefined;
  onSave: (started: Timestamp) => Promise<void>;
  saveError?: AppError;
  disabled?: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
}

export function StartedField(props: StartedFieldProps) {
  return (
    <SavingField
      label="Started"
      value={formatStarted(props.value)}
      placeholder={STARTED_FORMAT}
      validate={validateStarted}
      onSave={(text) => {
        const ts = parseStarted(text);
        return ts ? props.onSave(ts) : Promise.resolve();
      }}
      saveError={props.saveError}
      disabled={props.disabled}
      onDone={props.onDone}
      autoFocus={props.autoFocus}
      autoCapitalize="none"
      autoCorrect={false}
      testID="started-field"
    />
  );
}
