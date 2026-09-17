// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  Text as RNText,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { ApiProvider } from "@/api/providers";
import { useTheme } from "@/design/theme";
import { drawerShare } from "@/design/tokens";
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { Splash } from "@/features/shell/Splash";
import { AddPerson } from "@/prototypes/people/AddPerson";
import { Directory } from "@/prototypes/people/Directory";
import {
  CREWS,
  EVENT,
  identityFor,
  PEOPLE,
  userOverridesFor,
} from "@/prototypes/people/data";
import { type PeopleFake, wrapPeopleFake } from "@/prototypes/people/fake";
import { Ladder } from "@/prototypes/people/Ladder";
import { MyCrews } from "@/prototypes/people/MyCrews";
import { PeopleDrawer } from "@/prototypes/people/PeopleDrawer";
import { Picker } from "@/prototypes/people/Picker";
import {
  createSurfaceQueryClient,
  createSurfaceRuntime,
  type SurfaceRuntime,
} from "@/prototypes/people/runtime";
import { Shell } from "@/prototypes/people/Shell";
import { Table } from "@/prototypes/people/Table";
import type {
  PeopleQueryControls,
  RosterPaneProps,
  Viewer,
} from "@/prototypes/people/types";
import { usePeopleQuery } from "@/prototypes/people/usePeopleQuery";
import { useRoster } from "@/prototypes/people/useRoster";
import { SessionProvider } from "@/session/provider";
import { createFakeIms } from "@/test/fakeIms";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The 3c.4 round's harness (docs/plans/09aa-roster-design.md § The
// prototype round): the band above the stage (variant, stage width, scheme,
// the viewer, "Fail the next role change"), the real runtime +
// createFakeIms() the Jest harness uses, signed in as the fixture viewer, no
// server. The runtime is rebuilt whenever the viewer changes (a fresh fake,
// a fresh sign-in), as 09z's own harness does.
//
// The band's chrome is 09x's Harness component, inlined for the same reason
// 09z's copy gives: presentational chrome only, deliberately NOT on the
// app's tokens, so nothing here reads as part of the design being judged.

type VariantName = "Table" | "Ladder" | "Directory";

const VARIANTS: {
  name: VariantName;
  Component: ComponentType<RosterPaneProps>;
}[] = [
  { name: "Table", Component: Table },
  { name: "Ladder", Component: Ladder },
  { name: "Directory", Component: Directory },
];

interface HarnessParams {
  v?: string;
  w?: string;
  scheme?: string;
  viewer?: string;
}

export function Harness() {
  const params = useLocalSearchParams<Record<keyof HarnessParams, string>>();
  const router = useRouter();
  const window = useWindowDimensions();

  const variantIndex = clampVariant(params.v);
  const variant = VARIANTS[variantIndex] ?? VARIANTS[0];
  const scheme =
    params.scheme === "light" || params.scheme === "dark"
      ? params.scheme
      : "os";
  const viewer: Viewer =
    params.viewer === "inviter" || params.viewer === "writerInviter"
      ? params.viewer
      : "admin";
  const fixedWidth = Number.parseInt(params.w ?? "", 10);
  const width =
    Number.isFinite(fixedWidth) && fixedWidth > 0 ? fixedWidth : undefined;

  const setParam = (name: string, value: string | undefined) =>
    router.setParams({ [name]: value } as never);

  const runtime = useRosterRuntime(viewer);

  const failNextRoleChange = () => {
    if (runtime) {
      runtime.fake.forceNextRoleChangeFailure = true;
    }
  };

  const groups: BandGroup[] = [
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
      current: scheme,
      onSelect: (k) => setParam("scheme", k === "os" ? undefined : k),
    },
    {
      label: "Viewer",
      options: [
        { key: "admin", label: "Admin" },
        { key: "inviter", label: "Inviter" },
        { key: "writerInviter", label: "Writer-inviter" },
      ],
      current: viewer,
      onSelect: (k) => setParam("viewer", k === "admin" ? undefined : k),
    },
  ];

  // The route wraps this component in <ThemeProvider> (app/(dev)/people.tsx),
  // so useTheme() always resolves here.
  const theme = useTheme();

  return (
    <View
      style={[
        styles.fill,
        styles.center,
        { backgroundColor: theme.colors.surfaceSunken },
      ]}
    >
      <Band
        groups={groups}
        actions={[
          { label: "Fail the next role change", onPress: failNextRoleChange },
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
        testID="people-stage"
      >
        {!runtime ? (
          <Splash />
        ) : (
          <ApiProvider
            transport={runtime.runtime.transport}
            queryClient={runtime.queryClient}
            blobs={runtime.runtime.blobs}
          >
            <SessionProvider session={runtime.runtime.session}>
              <Stage
                key={viewer}
                viewer={viewer}
                Variant={variant.Component}
                variantName={variant.name}
              />
            </SessionProvider>
          </ApiProvider>
        )}
      </View>
      <Picker
        names={VARIANTS.map((v) => v.name)}
        current={variantIndex}
        onSelect={(i) => setParam("v", String(i + 1))}
      />
    </View>
  );
}

// --- The stage: the shell, the active variant, the drawer. ---

interface StageProps {
  viewer: Viewer;
  Variant: ComponentType<RosterPaneProps>;
  variantName: VariantName;
}

function Stage(props: StageProps) {
  const { viewer, Variant, variantName } = props;
  const listQuery = useQuery(ImsService.method.listPersonnel, {
    eventId: EVENT.id,
    all: true,
  });
  // 09y finding 1 (echoed by 09z): the query hook mounts a render after the
  // rows are in, so `setParams` (inside usePeopleQuery's own effects) must
  // never run before this screen — and the root layout beneath it — has
  // mounted.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready || listQuery.isLoading) {
    return <Splash />;
  }
  const people = listQuery.data?.people ?? [];
  return (
    <StageBody
      viewer={viewer}
      Variant={Variant}
      variantName={variantName}
      people={people}
    />
  );
}

interface StageBodyProps extends StageProps {
  people: Person[];
}

// Add person and My crews (docs/plans/09aa-roster-design.md § What to build
// 3, 4) both render in the same side-panel slot the profile drawer already
// occupies, so all three stay mutually exclusive: opening one closes the
// other two. Neither is URL state like `q.open`/`q.sel` (09x finding 1's own
// `setParams`-ordering concern doesn't apply to an ephemeral overlay), so
// it's local to this component. That leaves Esc: the keyboard map's own Esc
// path (usePeopleKeyboardMap.ts, run inside the active variant) only fires
// `close()` when `query.open` (the URL param) is set, so on its own it never
// dismisses these two overlays (09aa fix) — a capture-phase listener here,
// live only while an overlay is open, closes it first and stops the event
// before it also reaches the variant's own bubble-phase Esc handling.
type Overlay = "addPerson" | "myCrews" | undefined;

function StageBody(props: StageBodyProps) {
  const { viewer, Variant, variantName, people } = props;
  const roster = useRoster(EVENT.id);
  const q = usePeopleQuery(people);
  const myCrewsQuery = useQuery(ImsService.method.listMyCrews, {
    eventId: EVENT.id,
  });
  const crews = myCrewsQuery.data?.crews ?? [];

  const [overlay, setOverlay] = useState<Overlay>(undefined);

  const onAddPerson = () => {
    q.close();
    setOverlay("addPerson");
  };
  const onMyCrews =
    crews.length > 0
      ? () => {
          q.close();
          setOverlay("myCrews");
        }
      : undefined;
  const closeOverlay = () => setOverlay(undefined);
  const openPerson = (personId: number) => {
    setOverlay(undefined);
    q.open(personId);
  };

  useEffect(() => {
    if (!overlay || Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOverlay(undefined);
      }
    };
    // Capture phase: runs before the active variant's own bubble-phase Esc
    // handler (usePeopleKeyboardMap.ts) sees the event at all.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overlay]);

  const query: PeopleQueryControls = {
    selectedId: q.query.sel,
    openedId: q.query.open,
    onSelect: q.select,
    onSearchChange: (text) => q.setQuery({ q: text }),
    onClose: q.close,
    onAddPerson,
    searchRef: q.searchRef,
  };

  return (
    <Shell eventId={EVENT.id} onAddPerson={onAddPerson} onMyCrews={onMyCrews}>
      <Variant
        people={people}
        viewer={viewer}
        roster={roster}
        onOpen={openPerson}
        search={q.query.q}
        query={query}
      />
      {variantName === "Ladder" ? null : (
        <PeopleDrawer
          person={overlay ? undefined : q.opened}
          viewer={viewer}
          roster={roster}
          onClose={q.close}
        />
      )}
      {overlay === "addPerson" ? (
        <SidePanel title="Add person" onClose={closeOverlay}>
          <AddPerson
            eventId={EVENT.id}
            viewer={viewer}
            roster={roster}
            onClose={closeOverlay}
          />
        </SidePanel>
      ) : null}
      {overlay === "myCrews" ? (
        <SidePanel title="My crews" onClose={closeOverlay}>
          <MyCrews
            eventId={EVENT.id}
            crews={crews}
            people={people}
            roster={roster}
          />
        </SidePanel>
      ) : null}
    </Shell>
  );
}

// The same panel/scrim chrome as `PeopleDrawer.tsx` (that file is out of
// this round's edit list, so this is its own small copy rather than a
// generalized export) for the two overlays that aren't a person's profile.
function SidePanel(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityLabel={`Close ${props.title.toLowerCase()}`}
        onPress={props.onClose}
        style={[
          sidePanelStyles.scrim,
          { backgroundColor: theme.colors.overlay },
        ]}
      />
      <View
        style={[
          sidePanelStyles.panel,
          theme.elevation[2],
          {
            width: `${drawerShare * 100}%`,
            backgroundColor: theme.colors.background,
            borderLeftColor: theme.colors.borderStrong,
          },
        ]}
        testID="people-side-panel"
      >
        <ScreenHeader
          title={props.title}
          back={{ label: "People", onPress: props.onClose }}
        />
        <View style={sidePanelStyles.fill}>{props.children}</View>
      </View>
    </View>
  );
}

const sidePanelStyles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});

// --- The runtime: the same real runtime + createFakeIms() the Jest harness
// uses (src/test/harness.tsx), rebuilt whenever the viewer changes. ---

interface RosterRuntime {
  runtime: SurfaceRuntime;
  queryClient: ReturnType<typeof createSurfaceQueryClient>;
  fake: PeopleFake;
}

function useRosterRuntime(viewer: Viewer): RosterRuntime | undefined {
  const [state, setState] = useState<RosterRuntime>();
  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    const identity = identityFor(viewer);
    const fake = wrapPeopleFake(
      createFakeIms({ user: userOverridesFor(viewer) }),
      { canInvite: identity.canInvite },
    );
    fake.people = PEOPLE;
    fake.crews = CREWS;
    const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
    const runtime = createSurfaceRuntime(fake, store);
    const queryClient = createSurfaceQueryClient();
    void runtime.session.bootstrap().then(() => {
      if (!cancelled) {
        setState({ runtime, queryClient, fake });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewer]);
  return state;
}

// --- The band's chrome — 09x's Harness component (Picker.tsx's sibling),
// styled the same deliberately unthemed way; inlined, see the header note.

interface BandOption {
  key: string;
  label: string;
}
interface BandGroup {
  label: string;
  options: BandOption[];
  current: string;
  onSelect: (key: string) => void;
}
interface BandAction {
  label: string;
  onPress: () => void;
}

function Band(props: { groups: BandGroup[]; actions: BandAction[] }) {
  return (
    <View style={bandStyles.band}>
      <View accessibilityRole="toolbar" style={bandStyles.strip}>
        {props.groups.map((group) => (
          <View key={group.label} style={bandStyles.group}>
            <RNText style={bandStyles.groupLabel}>{group.label}</RNText>
            {group.options.map((option) => {
              const active = option.key === group.current;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => group.onSelect(option.key)}
                  style={({ pressed }) => [
                    bandStyles.item,
                    active ? bandStyles.active : null,
                    pressed ? { transform: [{ scale: 0.97 }] } : null,
                  ]}
                >
                  <RNText
                    style={[
                      bandStyles.label,
                      { color: active ? "#fff" : "rgba(255,255,255,0.55)" },
                    ]}
                  >
                    {option.label}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={bandStyles.divider} />
        {props.actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={action.onPress}
            style={({ pressed }) => [
              bandStyles.item,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}
          >
            <RNText
              style={[bandStyles.label, { color: "rgba(255,255,255,0.85)" }]}
            >
              {action.label}
            </RNText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function clampVariant(v: string | undefined): number {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= VARIANTS.length ? n - 1 : 0;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center" },
});

const bandStyles = StyleSheet.create({
  band: {
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "flex-start",
    width: "100%",
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 2,
    padding: 4,
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
