// SPDX-License-Identifier: Apache-2.0

import { ActivityIndicator } from "react-native";
import { Box } from "@/design/primitives/Box";
import { useTheme } from "@/design/theme";

// A screen body while its data is still loading (plan 09n).

export function LoadingState() {
  const theme = useTheme();
  return (
    <Box flex={1} bg="background" align="center" justify="center" p="xl">
      <ActivityIndicator
        accessibilityLabel="Loading"
        color={theme.colors.primary}
      />
    </Box>
  );
}
