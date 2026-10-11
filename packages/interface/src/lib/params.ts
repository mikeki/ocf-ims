// SPDX-License-Identifier: Apache-2.0

// expo-router hands a repeated query key back as an array; every screen that
// reads the URL wants the first value of each key as a plain string map. One
// helper, so the tables and the pages agree on how a repeated key is read.

export type FlatParams = Record<string, string | undefined>;

export function flatParams(
  params: Record<string, string | string[] | undefined>,
): FlatParams {
  const out: FlatParams = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}
