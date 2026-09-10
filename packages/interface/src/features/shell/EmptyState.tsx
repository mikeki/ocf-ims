// SPDX-License-Identifier: Apache-2.0

import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";

// A screen body with nothing to show — not an error (plan 09n T8): "no
// events yet", "no incidents yet", a private/missing incident, and so on.

export interface EmptyStateAction {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  title: string;
  message?: string;
  action?: EmptyStateAction;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <Box
      flex={1}
      bg="background"
      align="center"
      justify="center"
      p="xl"
      gap="md"
    >
      <Text variant="heading" align="center">
        {props.title}
      </Text>
      {props.message ? (
        <Text align="center" color="textMuted">
          {props.message}
        </Text>
      ) : null}
      {props.action ? (
        <Button
          label={props.action.label}
          variant="secondary"
          onPress={props.action.onPress}
        />
      ) : null}
    </Box>
  );
}
