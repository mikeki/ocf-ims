// SPDX-License-Identifier: Apache-2.0

import type {
  PhotoPicker,
  PickedPhoto,
  PickOutcome,
} from "@/features/compose/photo";

// A PhotoPicker for the composer tests (plan 09s): answers a scripted outcome
// and never touches expo-image-picker.

export interface FakePhotoPicker extends PhotoPicker {
  next: PickOutcome;
  picks: string[];
  shrunk: PickedPhoto[];
  settingsOpened: number;
}

export const SAMPLE_PHOTO: PickedPhoto = {
  uri: "file:///tmp/photo.heic",
  name: "IMG_0001.HEIC",
  type: "image/heic",
  width: 4032,
  height: 3024,
};

export function createFakePhotoPicker(hasCamera = true): FakePhotoPicker {
  const fake: FakePhotoPicker = {
    hasCamera,
    next: { kind: "picked", photo: SAMPLE_PHOTO },
    picks: [],
    shrunk: [],
    settingsOpened: 0,
    async pick(source) {
      fake.picks.push(source);
      return fake.next;
    },
    async shrink(photo) {
      const small = {
        ...photo,
        name: "IMG_0001.jpg",
        type: "image/jpeg",
        width: 1536,
        height: 1152,
      };
      fake.shrunk.push(small);
      return small;
    },
    async toUpload(photo) {
      return { uri: photo.uri, name: photo.name, type: photo.type };
    },
    openSettings() {
      fake.settingsOpened += 1;
    },
  };
  return fake;
}
