// SPDX-License-Identifier: Apache-2.0

import type { AppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";

// The session's `unreachable` state (plan 09n T1): boot could not reach the
// server, so nothing is known about the session yet. Retry re-runs bootstrap.

export interface UnreachableProps {
  error: AppError;
  onRetry: () => void;
}

export function Unreachable(props: UnreachableProps) {
  return (
    <Box
      flex={1}
      bg="background"
      align="center"
      justify="center"
      p="xl"
      gap="md"
    >
      <Text variant="heading" align="center" color="danger">
        {props.error.title}
      </Text>
      <Text align="center" color="textMuted">
        {props.error.message}
      </Text>
      <Button label="Retry" variant="secondary" onPress={props.onRetry} />
    </Box>
  );
}
