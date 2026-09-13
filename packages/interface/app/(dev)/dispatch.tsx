// SPDX-License-Identifier: Apache-2.0

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { ThemeProvider, useTheme } from "@/design/theme";
import type { ColorScheme } from "@/design/tokens";
import { Drawer } from "@/prototypes/dispatch/Drawer";
import { Harness, type HarnessGroup } from "@/prototypes/dispatch/Harness";
import type { Density } from "@/prototypes/dispatch/IncidentRow";
import { Page } from "@/prototypes/dispatch/Page";
import { Picker } from "@/prototypes/dispatch/Picker";
import { Shell, type ShellMode } from "@/prototypes/dispatch/Shell";
import { Split } from "@/prototypes/dispatch/Split";
import { useDispatch, type Variant } from "@/prototypes/dispatch/useDispatch";

// The D2 prototype surface (plan 09x): dev-only, outside the session gates,
// no server, deleted after the pick. `?v=1..3` picks the variant; the
// harness keys (`shell`, `w`, `scheme`, `density`) set the shape-independent
// decisions the round also has to take. Everything else in the URL is the
// table's own state, shared by all three variants — switching keeps the
// filters, the selection and the pokes, so the comparison is about shape.

const VARIANTS: { name: string; key: Variant }[] = [
  { name: "Split", key: "split" },
  { name: "Drawer", key: "drawer" },
  { name: "Page", key: "page" },
];

interface HarnessParams {
  v?: string;
  shell?: string;
  w?: string;
  scheme?: string;
  density?: string;
}

export default function DispatchRoute() {
  const params = useLocalSearchParams<Record<keyof HarnessParams, string>>();
  const parsed = Number.parseInt(params.v ?? "1", 10);
  const current =
    Number.isFinite(parsed) && parsed >= 1 && parsed <= VARIANTS.length
      ? parsed - 1
      : 0;
  const scheme: ColorScheme | undefined =
    params.scheme === "light" || params.scheme === "dark"
      ? params.scheme
      : undefined;
  return (
    <ThemeProvider scheme={scheme}>
      <Stage params={params} current={current} />
    </ThemeProvider>
  );
}

function Stage(props: { params: HarnessParams; current: number }) {
  const { params, current } = props;
  const theme = useTheme();
  const router = useRouter();
  const window = useWindowDimensions();
  const variant = VARIANTS[current] ?? VARIANTS[0];
  const key = variant?.key ?? "split";
  const d = useDispatch(key);
  const shell: ShellMode = params.shell === "topbar" ? "topbar" : "sidebar";
  const density: Density =
    params.density === "comfortable" ? "comfortable" : "compact";
  const fixed = Number.parseInt(params.w ?? "", 10);
  const width = Number.isFinite(fixed) && fixed > 0 ? fixed : undefined;

  const setParam = useCallback(
    (name: string, value: string | undefined) =>
      router.setParams({ [name]: value } as never),
    [router],
  );
  const select = useCallback(
    (index: number) => setParam("v", String(index + 1)),
    [setParam],
  );

  const harnessGroups: HarnessGroup[] = [
    {
      label: "Shell",
      options: [
        { key: "sidebar", label: "Sidebar" },
        { key: "topbar", label: "Top bar" },
      ],
      current: shell,
      onSelect: (k) => setParam("shell", k === "sidebar" ? undefined : k),
    },
    {
      label: "Width",
      options: [
        { key: "1024", label: "1024" },
        { key: "1440", label: "1440" },
        { key: "fit", label: "Fit" },
      ],
      current: width ? String(width) : "fit",
      onSelect: (k) => setParam("w", k === "fit" ? undefined : k),
    },
    {
      label: "Scheme",
      options: [
        { key: "light", label: "Light" },
        { key: "dark", label: "Dark" },
        { key: "os", label: "OS" },
      ],
      current: scheme(params.scheme),
      onSelect: (k) => setParam("scheme", k === "os" ? undefined : k),
    },
    {
      label: "Rows",
      options: [
        { key: "compact", label: "Compact" },
        { key: "comfortable", label: "Comfortable" },
      ],
      current: density,
      onSelect: (k) => setParam("density", k === "compact" ? undefined : k),
    },
  ];

  const body =
    key === "split" ? (
      <Split d={d} density={density} />
    ) : key === "drawer" ? (
      <Drawer d={d} density={density} />
    ) : (
      <Page d={d} density={density} />
    );

  return (
    <View
      style={[
        styles.fill,
        styles.center,
        { backgroundColor: theme.colors.surfaceSunken },
      ]}
    >
      <Harness
        groups={harnessGroups}
        actions={[
          { label: "Poke other  p", onPress: () => d.poke("other") },
          { label: "Poke selected  P", onPress: () => d.poke("selected") },
        ]}
      />
      <View
        style={[
          styles.fill,
          {
            width: width ?? window.width,
            maxWidth: "100%",
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.borderStrong,
            borderLeftWidth: width ? StyleSheet.hairlineWidth : 0,
            borderRightWidth: width ? StyleSheet.hairlineWidth : 0,
          },
        ]}
        testID="dispatch-stage"
      >
        <Shell mode={shell} onNotice={d.notify}>
          <View key={key} style={styles.fill}>
            {body}
          </View>
        </Shell>
      </View>
      <Picker
        names={VARIANTS.map((x) => x.name)}
        current={current}
        onSelect={select}
      />
    </View>
  );
}

function scheme(value: string | undefined): string {
  return value === "light" || value === "dark" ? value : "os";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center" },
});
