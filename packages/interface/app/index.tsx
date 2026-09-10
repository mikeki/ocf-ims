//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { useState } from "react";
import { type AppError, toAppError } from "@/api/errors";
import { Badge } from "@/design/primitives/Badge";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Field } from "@/design/primitives/Field";
import { Text } from "@/design/primitives/Text";
import { APP_NAME } from "@/lib/app";
import { useSession } from "@/session/provider";

// The one route until 3a.3: the app name and the session's state, so the
// foundations can be exercised by hand (and the Playwright smoke can see the
// bootstrap run in the exported bundle). The sign-in form here is a stand-in;
// 3a.3 replaces it with the (auth)/login route and the redirects.

export default function Index() {
  return (
    <Box flex={1} bg="background" justify="center" p="xl" gap="lg">
      <Text variant="title" align="center">
        {APP_NAME}
      </Text>
      <SessionPanel />
    </Box>
  );
}

function SessionPanel() {
  const { state, retry, signIn, signOut } = useSession();
  switch (state.status) {
    case "unknown":
      return (
        <Text align="center" color="textMuted">
          Connecting…
        </Text>
      );
    case "unreachable":
      return (
        <Box gap="md" align="center">
          <Text color="danger">{state.error.title}</Text>
          <Text align="center" color="textMuted">
            {state.error.message}
          </Text>
          <Button
            label="Retry"
            variant="secondary"
            onPress={() => {
              void retry();
            }}
          />
        </Box>
      );
    case "signedOut":
      return <SignInForm signIn={signIn} />;
    case "signedIn":
      return (
        <Box gap="md" align="center">
          <Text>{`Signed in as ${state.auth.user}`}</Text>
          <Badge
            label={state.auth.admin ? "admin" : "member"}
            tone={state.auth.admin ? "info" : "neutral"}
          />
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => {
              void signOut();
            }}
          />
        </Box>
      );
  }
}

function SignInForm(props: {
  signIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | undefined>(undefined);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await props.signIn(email, password);
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box gap="md">
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        error={
          error?.kind === "unauthenticated"
            ? "Wrong email or password."
            : error?.message
        }
      />
      <Button
        label="Sign in"
        loading={busy}
        disabled={email === "" || password === ""}
        onPress={() => {
          void submit();
        }}
      />
    </Box>
  );
}
