// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { Box } from "@/design/primitives/Box";
import { Button } from "@/design/primitives/Button";
import { Text } from "@/design/primitives/Text";

// The one header for every (app) screen (plan 09n T5): the `(app)` stack runs
// with `headerShown: false` and each screen renders this instead — one look
// on iOS, Android and web, fully covered by Jest. The back button is labelled
// with the PARENT screen's name ("Events" on the incidents screen), not
// "Back", so the tracer can find it by that accessible name.

export interface ScreenHeaderBack {
  label: string;
  onPress: () => void;
}

export interface ScreenHeaderProps {
  title: string;
  back?: ScreenHeaderBack;
  right?: ReactNode;
}

export function ScreenHeader(props: ScreenHeaderProps) {
  return (
    <Box row align="center" gap="md" p="md" bg="surface">
      {props.back ? (
        <Button
          label={props.back.label}
          variant="secondary"
          onPress={props.back.onPress}
        />
      ) : null}
      <Box flex={1}>
        <Text variant="heading" numberOfLines={1}>
          {props.title}
        </Text>
      </Box>
      {props.right}
    </Box>
  );
}
