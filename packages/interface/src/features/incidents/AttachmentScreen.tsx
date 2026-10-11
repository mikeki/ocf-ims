// SPDX-License-Identifier: Apache-2.0

import { Image } from "expo-image";
import type { AttachmentOwner } from "@/api/blobs";
import { Box } from "@/design/primitives/Box";
import { useTheme } from "@/design/theme";
import { useAttachmentSource } from "@/features/incidents/useAttachmentSource";
import { ScreenHeader } from "@/features/shell/ScreenHeader";

// An entry's photo at full width (plan 09s): a modal with a Close, no zoom.
// 3c's incident editor will want a real viewer; this one is deliberately small.

export interface AttachmentScreenProps {
  eventName: string;
  on: AttachmentOwner;
  entryId: number;
  onClose: () => void;
}

export function AttachmentScreen(props: AttachmentScreenProps) {
  const { eventName, on, entryId, onClose } = props;
  const theme = useTheme();
  const source = useAttachmentSource(eventName, on, entryId);
  return (
    <Box flex={1} bg="background">
      <ScreenHeader
        title={`${on.kind === "report" ? "R-" : "#"}${on.number} photo`}
        back={{ label: "Close", onPress: onClose }}
      />
      <Box flex={1} justify="center">
        <Image
          testID="attachment-full"
          source={source}
          style={{
            width: "100%",
            flex: 1,
            backgroundColor: theme.colors.background,
          }}
          contentFit="contain"
          accessibilityLabel="The photo"
        />
      </Box>
    </Box>
  );
}
