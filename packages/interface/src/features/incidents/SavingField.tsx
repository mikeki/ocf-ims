// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from "react";
import type { TextInput, TextInputProps } from "react-native";
import type { AppError } from "@/api/errors";
import { Field } from "@/design/primitives/Field";
import { useTheme } from "@/design/theme";
import { saveErrorText } from "@/features/incidents/controls/bits";

// A text field that saves itself (plan 09y decision 2 and § A poke never
// overwrites an unsaved field): it holds a local value only while focused or
// mid-save, so a refetch writes the server's value into it at any other
// time; on blur and on Enter (single line) it saves if the text changed; a
// failed save keeps the typed value and puts the error at the field until
// the next attempt. Disabled renders the same shape, read-only.

export interface SavingFieldProps
  extends Omit<
    TextInputProps,
    "value" | "onChangeText" | "onBlur" | "onSubmitEditing" | "editable"
  > {
  label: string;
  /** The server's value. */
  value: string;
  onSave: (value: string) => Promise<void>;
  /** The last save's error, from the edit hook. */
  saveError?: AppError;
  /** Rejects a value before it is sent; the message sits at the field. */
  validate?: (value: string) => string | undefined;
  disabled?: boolean;
  /** After a save settles or an unchanged blur: the in-place shape returns to its value. */
  onDone?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
}

export function SavingField(props: SavingFieldProps) {
  const {
    label,
    value,
    onSave,
    saveError,
    validate,
    disabled = false,
    onDone,
    inputRef,
    multiline,
    style,
    ...input
  } = props;
  const theme = useTheme();
  const [local, setLocal] = useState<string | undefined>(undefined);
  const [invalid, setInvalid] = useState<string | undefined>(undefined);
  const saving = useRef(false);
  const shown = local ?? value;

  const commit = () => {
    if (saving.current) {
      return;
    }
    if (local === undefined || local === value) {
      setLocal(undefined);
      setInvalid(undefined);
      onDone?.();
      return;
    }
    const problem = validate?.(local);
    if (problem) {
      setInvalid(problem);
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    onSave(local)
      .then(() => {
        setLocal(undefined);
        onDone?.();
      })
      .catch(() => {
        // The typed value stays; the error is the hook's, shown below.
      })
      .finally(() => {
        saving.current = false;
      });
  };

  return (
    <Field
      ref={inputRef}
      label={label}
      value={shown}
      editable={!disabled}
      multiline={multiline}
      blurOnSubmit={!multiline}
      onChangeText={(text) => {
        setLocal(text);
        setInvalid(undefined);
      }}
      onBlur={commit}
      onSubmitEditing={multiline ? undefined : commit}
      error={invalid ?? saveErrorText(saveError)}
      placeholderTextColor={theme.colors.textMuted}
      style={[
        disabled
          ? {
              color: theme.colors.textMuted,
              backgroundColor: theme.colors.surfaceSunken,
            }
          : null,
        multiline
          ? {
              minHeight:
                3 * (theme.type.body.lineHeight ?? 20) + theme.spacing.lg,
              paddingTop: theme.spacing.sm,
              textAlignVertical: "top",
            }
          : null,
        style,
      ]}
      {...input}
    />
  );
}
