// SPDX-License-Identifier: Apache-2.0

import { useMutation } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useState } from "react";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";
import { PasswordField } from "@/features/auth/PasswordField";
import { ErrorState } from "@/features/shell/ErrorState";
import { useSession } from "@/session/provider";

// The forced password-change gate (plan 09n T2): the `(app)` layout renders
// this INSTEAD of its stack while `usingDefaultPassword` is true, so there is
// no route that could be navigated around it. Success re-fetches auth status
// (the flag flips) rather than navigating anywhere itself.

/** Mirrors go/internal/person/password.go so the common case never round-trips to the server. */
const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordScreen() {
  const { signOut, refreshAuthStatus } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<AppError | undefined>(undefined);
  const mutation = useMutation(ImsService.method.changeOwnPassword);

  const submit = async () => {
    setFieldError(undefined);
    setFormError(undefined);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFieldError("The passwords don't match.");
      return;
    }
    try {
      await mutation.mutateAsync({ password });
    } catch (e) {
      const error = toAppError(e);
      if (error.kind === "invalid") {
        setFieldError(error.violations[0]?.message ?? error.message);
      } else {
        setFormError(error);
      }
      return;
    }
    // The gate reads state.auth.usingDefaultPassword; refreshing it is what lifts the gate.
    await refreshAuthStatus();
  };

  return (
    <Box flex={1} bg="background" justify="center" p="xl" gap="lg">
      <Text variant="heading" align="center">
        Set your own password
      </Text>
      <Text align="center" color="textMuted">
        You're signed in with the shared default password. Choose a new one
        before continuing.
      </Text>
      <Box gap="md">
        <PasswordField
          label="New password"
          value={password}
          onChangeText={setPassword}
          shown={shown}
          onToggleShown={() => setShown((s) => !s)}
          textContentType="newPassword"
          error={fieldError}
        />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          shown={shown}
          onToggleShown={() => setShown((s) => !s)}
          textContentType="newPassword"
        />
        {formError ? <ErrorState error={formError} /> : null}
        <Button
          label="Save password"
          loading={mutation.isPending}
          onPress={() => {
            void submit();
          }}
        />
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => {
            void signOut();
          }}
        />
      </Box>
    </Box>
  );
}
