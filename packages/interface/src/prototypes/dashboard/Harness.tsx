// SPDX-License-Identifier: Apache-2.0

import { useQuery } from "@connectrpc/connect-query";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import {
  Pressable,
  Text as RNText,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { ApiProvider } from "@/api/providers";
import { useTheme } from "@/design/theme";
import { EmptyState } from "@/features/shell/EmptyState";
import { Splash } from "@/features/shell/Splash";
import { eventAccess } from "@/lib/permissions";
import { Board } from "@/prototypes/dashboard/Board";
import {
  EMPTY_EVENT,
  FAIR_EVENT,
  wrapDashboardFake,
} from "@/prototypes/dashboard/fake";
import { Picker } from "@/prototypes/dashboard/Picker";
import {
  createSurfaceQueryClient,
  createSurfaceRuntime,
  type SurfaceRuntime,
} from "@/prototypes/dashboard/runtime";
import { Shell } from "@/prototypes/dashboard/Shell";
import { Shift } from "@/prototypes/dashboard/Shift";
import { Tables } from "@/prototypes/dashboard/Tables";
import { Toolbar } from "@/prototypes/dashboard/Toolbar";
import type { DashboardPaneProps } from "@/prototypes/dashboard/types";
import { useAutoRefresh } from "@/prototypes/dashboard/useAutoRefresh";
import { useMetrics } from "@/prototypes/dashboard/useMetrics";
import { SessionProvider } from "@/session/provider";
import { createFakeIms } from "@/test/fakeIms";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The 3c.5 round's harness (docs/plans/09ab-dashboard-design.md § The
// prototype round): the band above the stage (variant, stage width, scheme,
// the viewer, the event, "Next refresh changes three numbers" / "Next
// refresh fails"), the real runtime + createFakeIms() the Jest harness uses,
// signed in as the fixture viewer, no server. The runtime is rebuilt only
// when the viewer changes (a fresh fake, a fresh sign-in, as 09z/09aa's own
// harnesses do) — the event picker just changes which `eventId` the stage
// asks GetMetrics for.

type VariantName = "Board" | "Tables" | "Shift";

const VARIANTS: {
  name: VariantName;
  Component: ComponentType<DashboardPaneProps>;
}[] = [
  { name: "Board", Component: Board },
  { name: "Tables", Component: Tables },
  { name: "Shift", Component: Shift },
];

type ViewerName = "writer" | "reporter";
type EventName = "fair" | "empty";

interface HarnessParams {
  v?: string;
  w?: string;
  scheme?: string;
  viewer?: string;
  event?: string;
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
  const viewer: ViewerName =
    params.viewer === "reporter" ? "reporter" : "writer";
  const eventName: EventName = params.event === "empty" ? "empty" : "fair";
  const event = eventName === "empty" ? EMPTY_EVENT : FAIR_EVENT;
  const fixedWidth = Number.parseInt(params.w ?? "", 10);
  const width =
    Number.isFinite(fixedWidth) && fixedWidth > 0 ? fixedWidth : undefined;

  const setParam = (name: string, value: string | undefined) =>
    router.setParams({ [name]: value } as never);

  const runtime = useDashboardRuntime(viewer);

  const failNextRefresh = () => {
    if (runtime) {
      runtime.fake.nextMetricsFails = true;
    }
  };
  const changeNextRefresh = () => {
    if (runtime) {
      runtime.fake.nextMetricsChanges = true;
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
        { key: "writer", label: "Writer" },
        { key: "reporter", label: "Reporter" },
      ],
      current: viewer,
      onSelect: (k) => setParam("viewer", k === "writer" ? undefined : k),
    },
    {
      label: "Event",
      options: [
        { key: "fair", label: "Fair 2026" },
        { key: "empty", label: "Empty event" },
      ],
      current: eventName,
      onSelect: (k) => setParam("event", k === "fair" ? undefined : k),
    },
  ];

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
          {
            label: "Next refresh changes three numbers",
            onPress: changeNextRefresh,
          },
          { label: "Next refresh fails", onPress: failNextRefresh },
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
        testID="dashboard-stage"
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
                eventId={event.id}
                eventName={event.name}
                Variant={variant.Component}
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

// --- The stage: the access gate, then the shell and the toolbar+variant. ---

interface StageProps {
  eventId: number;
  eventName: string;
  Variant: ComponentType<DashboardPaneProps>;
}

function Stage(props: StageProps) {
  const { eventId, eventName, Variant } = props;
  const authQuery = useQuery(ImsService.method.getAuthStatus, { eventId });
  // 09y finding 1 (echoed by 09z/09aa): a query hook mounts a render after
  // the answer is in, so nothing here may act before this screen has mounted.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready || authQuery.isLoading) {
    return <Splash />;
  }
  const access = eventAccess(authQuery.data, eventId);

  // § Gating: without `access.writeIncidents` the Dashboard item is absent
  // and the route is the Not found state — the server's PermissionDenied is
  // never shown as a 403.
  if (!access.writeIncidents) {
    return (
      <Shell eventName={eventName} showDashboard={false}>
        <EmptyState title="Not found" />
      </Shell>
    );
  }

  return (
    <Shell eventName={eventName} showDashboard>
      {/* Keyed by event: switching Fair 2026 ⇄ Empty event is a fresh read,
          not a "refresh" — without this, useMetrics would diff the outgoing
          event's numbers against the incoming one and mark half the page
          changed. */}
      <DashboardBody key={eventId} eventId={eventId} Variant={Variant} />
    </Shell>
  );
}

function DashboardBody(props: {
  eventId: number;
  Variant: ComponentType<DashboardPaneProps>;
}) {
  const { eventId, Variant } = props;
  const auto = useAutoRefresh();
  const { metrics, isLoading, isRefreshing, lastError, changedKeys, refresh } =
    useMetrics(eventId, auto.intervalMs);

  if (isLoading && !metrics) {
    return <Splash />;
  }
  if (!metrics) {
    return (
      <EmptyState
        title="Couldn't load"
        message={lastError ?? "Try again."}
        action={{ label: "Retry", onPress: refresh }}
      />
    );
  }

  const generatedAtMs = metrics.generatedAt
    ? Number(metrics.generatedAt.seconds) * 1000
    : undefined;

  return (
    <View style={styles.fill}>
      <Toolbar
        testID="dashboard-toolbar"
        generatedAtMs={generatedAtMs}
        isRefreshing={isRefreshing}
        lastError={lastError}
        onRefresh={refresh}
        preference={auto.preference}
        onPreferenceChange={auto.setPreference}
      />
      <Variant
        metrics={metrics}
        changedKeys={changedKeys}
        // The round only judges placement (§ Decisions the round must also
        // take 4) — where a follow-up opens is still open.
        onOpenFollowUp={(incidentNumber) =>
          console.log(`open incident ${incidentNumber}`)
        }
      />
    </View>
  );
}

// --- The runtime: the real runtime + createFakeIms() the Jest harness uses,
// rebuilt whenever the viewer changes. ---

interface DashboardRuntime {
  runtime: SurfaceRuntime;
  queryClient: ReturnType<typeof createSurfaceQueryClient>;
  fake: ReturnType<typeof wrapDashboardFake>;
}

function useDashboardRuntime(viewer: ViewerName): DashboardRuntime | undefined {
  const [state, setState] = useState<DashboardRuntime>();
  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    const fake = wrapDashboardFake(
      createFakeIms({ user: { writeIncidents: viewer === "writer" } }),
    );
    fake.events = [FAIR_EVENT, EMPTY_EVENT];
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

// --- The band's chrome — 09x's Harness component, styled the same
// deliberately unthemed way; inlined, see people/Harness.tsx's own note.

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
