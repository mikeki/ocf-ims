// SPDX-License-Identifier: Apache-2.0

import { Pressable, StyleSheet, Text, View } from "react-native";

// The round's shape-independent controls (plan 09x § Decisions the round
// must also take), as harness chrome in a band above the stage: the shell, a fixed
// stage width, the scheme, the row density, and the poke buttons. Styled
// like the picker — dark glass, no project tokens — so nothing here reads
// as part of the design being judged.

export interface HarnessGroup {
  label: string;
  options: { key: string; label: string }[];
  current: string;
  onSelect: (key: string) => void;
}

export interface HarnessAction {
  label: string;
  onPress: () => void;
}

export interface HarnessProps {
  groups: HarnessGroup[];
  actions: HarnessAction[];
}

export function Harness(props: HarnessProps) {
  return (
    <View style={styles.band}>
      <View accessibilityRole="toolbar" style={styles.strip}>
        {props.groups.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.options.map((option) => {
              const active = option.key === group.current;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => group.onSelect(option.key)}
                  style={({ pressed }) => [
                    styles.item,
                    active ? styles.active : null,
                    pressed ? { transform: [{ scale: 0.97 }] } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.label,
                      { color: active ? "#fff" : "rgba(255,255,255,0.55)" },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={styles.divider} />
        {props.actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.item,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}
          >
            <Text style={[styles.label, { color: "rgba(255,255,255,0.85)" }]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "flex-start",
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 2,
    padding: 4,
    userSelect: "none",
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: 8,
  },
  groupLabel: {
    fontSize: 11,
    lineHeight: 11,
    color: "rgba(255,255,255,0.4)",
    paddingRight: 4,
  },
  item: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 999,
    justifyContent: "center",
  },
  active: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  label: {
    fontSize: 12,
    lineHeight: 12,
  },
  divider: {
    width: 1,
    height: 16,
    marginHorizontal: 4,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
});
