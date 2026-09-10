// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";
import { Platform } from "react-native";
import { type AppError, toAppError } from "@/api/errors";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { PasswordField } from "@/features/auth/PasswordField";
import { APP_NAME } from "@/lib/app";
import { useCountdown } from "@/lib/useCountdown";
import { useSession } from "@/session/provider";

// The sign-in screen (plan 09n T9). It never navigates on success: the
// (auth) layout's redirect (T1) fires once the session state flips to
// signedIn, so this component only renders the form and whatever the last
// attempt's AppError was.

export function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);

  const throttledSeconds =
    error?.kind === "throttled" ? error.retryAfterSeconds : undefined;
  // Keyed on the error object too: a second throttle with the same
  // Retry-After must restart the countdown.
  const secondsLeft = useCountdown(throttledSeconds, error);
  const counting = error?.kind === "throttled" && secondsLeft > 0;

  const submit = async () => {
    setLoading(true);
    setError(undefined);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setLoading(false);
    }
  };

  let passwordError: string | undefined;
  if (error?.kind === "unauthenticated") {
    passwordError = "Wrong email or password.";
  } else if (error?.kind === "throttled") {
    passwordError = counting
      ? `Too many attempts. Try again in ${secondsLeft} s.`
      : "Too many attempts. You can try again now.";
  } else if (error) {
    passwordError = error.message;
  }

  return (
    <Box flex={1} bg="background" justify="center" p="xl" gap="lg">
      <Text variant="title" align="center">
        {APP_NAME}
      </Text>
      <Text align="center" color="textMuted">
        Sign in with your email and password
      </Text>
      <Box gap="md">
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          autoFocus={Platform.OS === "web"}
        />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          shown={shown}
          onToggleShown={() => setShown((s) => !s)}
          textContentType="password"
          onSubmitEditing={() => {
            void submit();
          }}
          error={passwordError}
        />
        <Button
          label="Sign in"
          loading={loading}
          disabled={email.trim() === "" || password === "" || counting}
          onPress={() => {
            void submit();
          }}
        />
      </Box>
    </Box>
  );
}
