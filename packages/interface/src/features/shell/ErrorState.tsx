// SPDX-License-Identifier: Apache-2.0

import type { AppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";

// A screen (or form section) body for a failure a screen never classifies
// itself (plan 09n T8) — it just renders the AppError. Retry only shows when
// the error is retryable and a retry callback was given (e.g. `forbidden`
// never offers one).

export interface ErrorStateProps {
  error: AppError;
  onRetry?: () => void;
}

export function ErrorState(props: ErrorStateProps) {
  const { error, onRetry } = props;
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
        {error.title}
      </Text>
      <Text align="center" color="textMuted">
        {error.message}
      </Text>
      {error.retryable && onRetry ? (
        <Button label="Retry" variant="secondary" onPress={onRetry} />
      ) : null}
    </Box>
  );
}
