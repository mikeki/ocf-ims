// SPDX-License-Identifier: Apache-2.0

import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { useEffect, useState } from "react";
import { Image, Platform, View } from "react-native";
import { useBlobs } from "@/api/providers";
import { apiBaseUrl } from "@/config/env";
import { Text } from "@/design/primitives/Text";
import { useTheme } from "@/design/theme";

// The roster's one picture treatment (docs/plans/09aa-roster-design.md §
// Decisions the round must also take, #5): `profile_picture_url` as the
// server serves it — 32px on a card, 64px in the hovercard and the profile
// card — falling back to an initial in `surfaceSunken` when there is no
// picture or the image fails to load. An absolute or data URL is public and
// goes to a plain `Image`; a relative `/ims/api/...` path is behind the
// Bearer: native hands the Image the header, web (an <img> cannot carry one)
// fetches the bytes and shows an object URL, as `useAttachmentSource` does.

export interface AvatarProps {
  person: Person;
  size: number;
}

interface PictureSource {
  uri: string;
  headers?: Record<string, string>;
}

function isRelative(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

function absoluteUrl(path: string): string {
  let base = "";
  try {
    base = apiBaseUrl();
  } catch {
    // No base configured (a test, a same-origin web build): the path stands.
  }
  return `${base.replace(/\/$/, "")}${path}`;
}

/** The Bearer-carrying source for a relative picture path; undefined until it is ready or if it failed. */
function useServedPicture(path: string): {
  source: PictureSource | undefined;
  failed: boolean;
} {
  const blobs = useBlobs();
  const [source, setSource] = useState<PictureSource | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    const load = async () => {
      const headers = await blobs.authHeaders();
      const url = absoluteUrl(path);
      if (Platform.OS === "web") {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) {
          throw new Error(`picture ${res.status}`);
        }
        const bytes = await res.blob();
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(bytes);
        setSource({ uri: objectUrl });
        return;
      }
      if (!cancelled) {
        setSource({ uri: url, headers });
      }
    };
    setSource(undefined);
    setFailed(false);
    load().catch(() => {
      if (!cancelled) {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blobs, path]);

  return { source, failed };
}

export function Avatar(props: AvatarProps) {
  const { person, size } = props;
  const theme = useTheme();
  const url = person.profilePictureUrl;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.surfaceSunken,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {url && isRelative(url) ? (
        <ServedPicture person={person} path={url} size={size} />
      ) : url ? (
        <PublicPicture person={person} uri={url} size={size} />
      ) : (
        <Initial person={person} size={size} />
      )}
    </View>
  );
}

function PublicPicture(props: { person: Person; uri: string; size: number }) {
  const { person, uri, size } = props;
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Initial person={person} size={size} />;
  }
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
    />
  );
}

function ServedPicture(props: { person: Person; path: string; size: number }) {
  const { person, path, size } = props;
  const { source, failed } = useServedPicture(path);
  const [broken, setBroken] = useState(false);
  if (!source || failed || broken) {
    return <Initial person={person} size={size} />;
  }
  return (
    <Image
      source={source}
      accessibilityIgnoresInvertColors
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
    />
  );
}

function Initial(props: { person: Person; size: number }) {
  const { person, size } = props;
  return (
    <Text
      variant={size >= 48 ? "heading" : "caption"}
      color="textMuted"
      aria-hidden
    >
      {initialFor(person)}
    </Text>
  );
}

function initialFor(person: Person): string {
  const name = person.handle || person.name || "";
  return name.slice(0, 1).toUpperCase() || "?";
}
