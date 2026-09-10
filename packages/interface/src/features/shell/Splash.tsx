// SPDX-License-Identifier: Apache-2.0

import { Box } from "@/design/primitives/Box";
import { Text } from "@/design/primitives/Text";

// The session's `unknown` state (plan 09n T1): booting, restoring whatever
// session the device holds. Shown by both route-group layouts until the
// session settles into unreachable / signedOut / signedIn.

export function Splash() {
  return (
    <Box flex={1} bg="background" align="center" justify="center">
      <Text color="textMuted">Connecting…</Text>
    </Box>
  );
}
