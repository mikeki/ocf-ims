// SPDX-License-Identifier: Apache-2.0

import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PressFeedback } from "@/design/motion";
import { Text } from "@/design/primitives/Text";
import { TextButton } from "@/design/primitives/TextButton";
import { useTheme } from "@/design/theme";
import { pressRetentionOffset, touchTarget } from "@/design/tokens";
import {
  type PhotoSource,
  type PickedPhoto,
  usePhotoPicker,
} from "@/features/compose/photo";

// The attach control and the chip (plan 09s): "Add photo" offers the camera
// and the library on a phone (the library alone on web); a chosen photo is a
// 64 pt thumbnail with an ✕, a determinate bar across its foot while it
// uploads, and Retry when the upload failed. Nothing here animates: the chip
// and the bar appear as they are, and the bar's fill is an absolutely
// positioned childless view whose width follows the progress events.

export interface PendingPhoto {
  photo: PickedPhoto;
  /** 0..1 while uploading; undefined before and after. */
  progress?: number;
  /** The last upload's failure, kept with the chip. */
  error?: string;
}

export interface PhotoAttachProps {
  pending: PendingPhoto | undefined;
  onPicked: (photo: PickedPhoto) => void;
  onClear: () => void;
  onRetry?: () => void;
  /** The control is disabled while a send is in flight. */
  busy?: boolean;
}

export function PhotoAttach(props: PhotoAttachProps) {
  const { pending, onPicked, onClear, onRetry, busy } = props;
  const theme = useTheme();
  const picker = usePhotoPicker();
  const [choosing, setChoosing] = useState(false);
  const [denied, setDenied] = useState(false);

  const choose = async (source: PhotoSource) => {
    setChoosing(false);
    setDenied(false);
    const outcome = await picker.pick(source);
    if (outcome.kind === "denied") {
      setDenied(true);
      return;
    }
    if (outcome.kind === "picked") {
      onPicked(await picker.shrink(outcome.photo));
    }
  };

  if (pending) {
    const uploading = pending.progress !== undefined && !pending.error;
    return (
      <View style={[styles.chipRow, { gap: theme.spacing.md }]}>
        <View
          testID="photo-chip"
          style={{
            width: CHIP,
            height: CHIP,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.textMuted,
            overflow: "hidden",
          }}
        >
          <Image
            source={{ uri: pending.photo.uri }}
            style={styles.fill}
            contentFit="cover"
            accessibilityLabel="The photo to attach"
          />
          {uploading ? (
            <View
              style={[styles.track, { backgroundColor: theme.colors.border }]}
            >
              <View
                testID="photo-progress"
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round((pending.progress ?? 0) * 100),
                }}
                style={[
                  styles.bar,
                  {
                    backgroundColor: theme.colors.primary,
                    width: `${Math.round((pending.progress ?? 0) * 100)}%`,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
        <View style={[styles.chipText, { gap: theme.spacing.xs }]}>
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {pending.error
              ? pending.error
              : uploading
                ? "Uploading photo…"
                : "Photo ready to send"}
          </Text>
          <View style={[styles.actions, { gap: theme.spacing.md }]}>
            {pending.error && onRetry ? (
              <TextButton
                label="Retry"
                onPress={onRetry}
                testID="photo-retry"
              />
            ) : null}
            {!uploading ? (
              <TextButton
                label="Remove"
                onPress={onClear}
                testID="photo-remove"
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {choosing && picker.hasCamera ? (
        <View style={[styles.actions, { gap: theme.spacing.lg }]}>
          <TextButton
            label="Take photo"
            onPress={() => {
              void choose("camera");
            }}
            testID="photo-camera"
          />
          <TextButton
            label="Choose from library"
            onPress={() => {
              void choose("library");
            }}
            testID="photo-library"
          />
          <TextButton
            label="Cancel"
            onPress={() => setChoosing(false)}
            testID="photo-cancel"
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            if (picker.hasCamera) {
              setChoosing(true);
            } else {
              void choose("library");
            }
          }}
          pressRetentionOffset={pressRetentionOffset}
          hitSlop={{ top: theme.spacing.sm, bottom: theme.spacing.sm }}
          style={styles.hug}
          testID="photo-add"
        >
          {({ pressed }) => (
            <PressFeedback pressed={pressed} style={styles.addRow}>
              <Text variant="label" color="primary">
                {"\u{1F4F7}  Add photo"}
              </Text>
            </PressFeedback>
          )}
        </Pressable>
      )}
      {denied ? (
        <View style={[styles.actions, { gap: theme.spacing.md }]}>
          <Text variant="caption" color="textMuted" testID="photo-denied">
            OCF IMS isn't allowed to use that yet.
          </Text>
          <TextButton
            label="Open settings"
            onPress={picker.openSettings}
            testID="photo-settings"
          />
        </View>
      ) : null}
    </View>
  );
}

const CHIP = 64;

const styles = StyleSheet.create({
  chipRow: { flexDirection: "row", alignItems: "center" },
  chipText: { flexShrink: 1 },
  fill: { width: "100%", height: "100%" },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
  },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  addRow: { minHeight: touchTarget / 1.5, justifyContent: "center" },
  hug: { alignSelf: "flex-start" },
});
