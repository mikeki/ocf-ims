// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useState } from "react";
import { Image, View } from "react-native";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// The roster's one picture treatment (docs/plans/09aa-roster-design.md §
// Decisions the round must also take, #5): `profile_picture_url` at whatever
// size the caller asks for — 32px on a row, larger on the card — falling
// back to an initial (this round's pick, not a nothing) when there is no
// picture, or the `<Image>` itself fails to load a fixture's data: URI or
// relative path.

export interface AvatarProps {
  person: Person;
  size: number;
}

export function Avatar(props: AvatarProps) {
  const { person, size } = props;
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(person.profilePictureUrl) && !failed;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.surfaceRaised,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showImage ? (
        <Image
          source={{ uri: person.profilePictureUrl }}
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
          style={{ width: size, height: size }}
        />
      ) : (
        <Text
          variant={size >= 48 ? "heading" : "caption"}
          color="textMuted"
          aria-hidden
        >
          {initialFor(person)}
        </Text>
      )}
    </View>
  );
}

function initialFor(person: Person): string {
  const name = person.handle || person.name || "";
  return name.slice(0, 1).toUpperCase() || "?";
}
