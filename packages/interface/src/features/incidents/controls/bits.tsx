// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import type { AppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// Small shared pieces for the editor's controls (plan 09y): the card and
// section the read screen uses (copied — IncidentScreen keeps its own
// private), a label, and the one way a failed save is written at a control.

/** What a failed save says at its control: the title, then the server's word. */
export function saveErrorText(error: AppError | undefined): string | undefined {
  return error ? `Couldn't save. ${error.message}` : undefined;
}

export function FieldError(props: { error?: AppError; text?: string }) {
  const text = props.text ?? saveErrorText(props.error);
  if (!text) {
    return null;
  }
  return (
    <Text variant="caption" color="danger" accessibilityRole="alert">
      {text}
    </Text>
  );
}

export function Label(props: { children: string; nativeID?: string }) {
  return (
    <Text variant="label" color="textMuted" nativeID={props.nativeID}>
      {props.children}
    </Text>
  );
}

/** A block of related content: a surface, ruled off the page. */
export function Card(props: { children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Box
      bg="surface"
      radius="lg"
      p="lg"
      gap="sm"
      testID={props.testID}
      style={{ borderWidth: 1, borderColor: theme.colors.border }}
    >
      {props.children}
    </Box>
  );
}

export function Section(props: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Box gap="sm">
      <Box row align="center" justify="space-between" gap="md">
        <Text variant="heading">{props.title}</Text>
        {props.right}
      </Box>
      <Card>{props.children}</Card>
    </Box>
  );
}

/** A timestamp line. Captions are tabular, so a column of them aligns. */
export function Meta(props: { children: ReactNode }) {
  return (
    <Text variant="caption" color="textMuted">
      {props.children}
    </Text>
  );
}
