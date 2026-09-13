// SPDX-License-Identifier: Apache-2.0

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { Linking, Platform } from "react-native";
import type { UploadFile } from "@/api/blobs";

// Choosing and shrinking a photo (plan 09s). The picker is behind a context
// so a composer's tests supply a fake asset and never touch the native
// module. Permissions are asked at the tap, never on launch; a denial is an
// outcome the control renders inline, not a dialog.

export type PhotoSource = "camera" | "library";

export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
}

export type PickOutcome =
  | { kind: "picked"; photo: PickedPhoto }
  | { kind: "cancelled" }
  | { kind: "denied" };

export interface PhotoPicker {
  pick(source: PhotoSource): Promise<PickOutcome>;
  /** The longest edge capped, JPEG; the original when it cannot be decoded. */
  shrink(photo: PickedPhoto): Promise<PickedPhoto>;
  /** What the blob helper sends: a Blob on web, a file descriptor on native. */
  toUpload(photo: PickedPhoto): Promise<UploadFile>;
  openSettings(): void;
  /** Whether the camera is offered (never on web). */
  hasCamera: boolean;
}

/** The templ client's number: a fair photo is evidence, not art. */
export const MAX_EDGE = 1536;
export const JPEG_QUALITY = 0.85;

export const realPhotoPicker: PhotoPicker = {
  hasCamera: Platform.OS !== "web",
  async pick(source) {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return { kind: "denied" };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 1,
      exif: false,
      allowsEditing: false,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.assets?.[0];
    if (result.canceled || !asset) {
      return { kind: "cancelled" };
    }
    return {
      kind: "picked",
      photo: {
        uri: asset.uri,
        name: asset.fileName || "photo.jpg",
        type: asset.mimeType || "image/jpeg",
        width: asset.width,
        height: asset.height,
      },
    };
  },
  async shrink(photo) {
    const longest = Math.max(photo.width ?? 0, photo.height ?? 0);
    if (longest > 0 && longest <= MAX_EDGE) {
      return photo;
    }
    try {
      const resize =
        (photo.width ?? 0) >= (photo.height ?? 0)
          ? { width: MAX_EDGE }
          : { height: MAX_EDGE };
      const result = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize }],
        { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );
      return {
        uri: result.uri,
        name: jpegName(photo.name),
        type: "image/jpeg",
        width: result.width,
        height: result.height,
      };
    } catch {
      return photo;
    }
  },
  async toUpload(photo) {
    if (Platform.OS === "web") {
      const blob = await (await fetch(photo.uri)).blob();
      return { blob, name: photo.name };
    }
    return { uri: photo.uri, name: photo.name, type: photo.type };
  },
  openSettings() {
    void Linking.openSettings();
  },
};

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

const PhotoPickerContext = createContext<PhotoPicker>(realPhotoPicker);

export function PhotoPickerProvider(props: {
  picker: PhotoPicker;
  children: ReactNode;
}) {
  return (
    <PhotoPickerContext.Provider value={props.picker}>
      {props.children}
    </PhotoPickerContext.Provider>
  );
}

export function usePhotoPicker(): PhotoPicker {
  return useContext(PhotoPickerContext);
}
