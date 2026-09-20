// SPDX-License-Identifier: Apache-2.0

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@connectrpc/connect-query";
import { JournalEntrySchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/journal_entry_pb";
import { ReportSchema } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import type { ReportView } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ReportViewSchema } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { EventPokeKind } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/stream_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentType, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
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
import { ScreenHeader } from "@/features/shell/ScreenHeader";
import { Splash } from "@/features/shell/Splash";
import { Account } from "@/prototypes/reports/Account";
import { Companion } from "@/prototypes/reports/Companion";
import {
  EVENT,
  incidentsForViewer,
  PEOPLE,
  R7,
  reportsForViewer,
  userOverridesFor,
} from "@/prototypes/reports/data";
import { wrapReportsFake } from "@/prototypes/reports/fake";
import { Ledger } from "@/prototypes/reports/Ledger";
import { neighboursOf } from "@/prototypes/reports/neighbours";
import { Picker } from "@/prototypes/reports/Picker";
import { ReportDrawer } from "@/prototypes/reports/ReportDrawer";
import { ReportFilterBar } from "@/prototypes/reports/ReportFilterBar";
import { ReportPage } from "@/prototypes/reports/ReportPage";
import { ReportTable } from "@/prototypes/reports/ReportTable";
import {
  createSurfaceQueryClient,
  createSurfaceRuntime,
  type SurfaceRuntime,
} from "@/prototypes/reports/runtime";
import { Shell } from "@/prototypes/reports/Shell";
import type {
  ReportPaneHandle,
  ReportPaneProps,
  Viewer,
} from "@/prototypes/reports/types";
import { useEditReport } from "@/prototypes/reports/useEditReport";
import { useKeyboardMap } from "@/prototypes/reports/useKeyboardMap";
import { useReportQuery } from "@/prototypes/reports/useReportQuery";
import { SessionProvider } from "@/session/provider";
import { createFakeIms } from "@/test/fakeIms";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The 3c.3 round's harness (docs/plans/09z-reports-design.md § The prototype
// round): the band above the stage (pane, stage width, scheme, viewer,
// report, a poke), the real runtime + createFakeIms() the Jest harness uses
// (src/test/harness.tsx, src/test/fakeIms.ts) signed in as the fixture
// viewer, no server. The runtime is rebuilt whenever the viewer changes —
// a fresh fake, a fresh sign-in — so switching roles never carries a write
// from one identity into another's cache.
//
// The band's chrome is 09x's `Harness` component, inlined rather than
// recovered as its own file: this round's list of files does not carry a
// second one, and it is presentational chrome only (no project tokens, so
// nothing here reads as part of the design being judged).

export type Pane = "drawer" | "page" | "phone";
type VariantName = "Ledger" | "Account" | "Companion";

const VARIANTS: {
  name: VariantName;
  Component: ComponentType<ReportPaneProps>;
}[] = [
  { name: "Ledger", Component: Ledger },
  { name: "Account", Component: Account },
  { name: "Companion", Component: Companion },
];

const REPORT_NUMBERS: Record<string, number> = {
  R7: 7,
  R12: 12,
  R3: 3,
  R15: 15,
};

interface HarnessParams {
  v?: string;
  pane?: string;
  w?: string;
  scheme?: string;
  viewer?: string;
  report?: string;
}

export function Harness() {
  const params = useLocalSearchParams<Record<keyof HarnessParams, string>>();
  const router = useRouter();
  const window = useWindowDimensions();

  const variantIndex = clampVariant(params.v);
  const variant = VARIANTS[variantIndex] ?? VARIANTS[0];
  const pane: Pane =
    params.pane === "page" || params.pane === "phone" ? params.pane : "drawer";
  const scheme =
    params.scheme === "light" || params.scheme === "dark"
      ? params.scheme
      : "os";
  const viewer: Viewer =
    params.viewer === "reporter" ||
    params.viewer === "crewLeader" ||
    params.viewer === "admin"
      ? params.viewer
      : "dispatcher";
  const reportKey =
    params.report === "R12" || params.report === "R3" || params.report === "R15"
      ? params.report
      : "R7";
  const reportNumber = REPORT_NUMBERS[reportKey] ?? 7;
  const fixedWidth = Number.parseInt(params.w ?? "", 10);
  const width =
    Number.isFinite(fixedWidth) && fixedWidth > 0 ? fixedWidth : undefined;

  const setParam = (name: string, value: string | undefined) =>
    router.setParams({ [name]: value } as never);

  const runtime = useReportsRuntime(viewer);

  const pokeNow = () => runtime && pokeNewEntry(runtime);
  const pokeIn3s = () => {
    const captured = runtime;
    setTimeout(() => captured && pokeNewEntry(captured), 3000);
  };

  const groups: BandGroup[] = [
    {
      label: "Pane",
      options: [
        { key: "drawer", label: "Drawer" },
        { key: "page", label: "Page" },
        { key: "phone", label: "Phone" },
      ],
      current: pane,
      onSelect: (k) => setParam("pane", k === "drawer" ? undefined : k),
    },
    {
      label: "Width",
      options: [
        { key: "1024", label: "1024" },
        { key: "1440", label: "1440" },
        { key: "400", label: "400" },
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
        { key: "dispatcher", label: "Dispatcher" },
        { key: "reporter", label: "Reporter" },
        { key: "crewLeader", label: "Crew leader" },
        { key: "admin", label: "Admin" },
      ],
      current: viewer,
      onSelect: (k) => setParam("viewer", k === "dispatcher" ? undefined : k),
    },
    {
      label: "Report",
      options: [
        { key: "R7", label: "R-7" },
        { key: "R12", label: "R-12" },
        { key: "R3", label: "R-3" },
        { key: "R15", label: "R-15" },
      ],
      current: reportKey,
      onSelect: (k) => setParam("report", k === "R7" ? undefined : k),
    },
  ];

  // The route wraps this component in <ThemeProvider> (app/(dev)/reports.tsx),
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
          { label: "New entry on R-7 now", onPress: pokeNow },
          { label: "New entry in 3 s", onPress: pokeIn3s },
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
        testID="reports-stage"
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
                pane={pane}
                reportNumber={reportNumber}
                Variant={variant.Component}
                onFull={() => setParam("pane", "page")}
                onBackFromPage={() => setParam("pane", undefined)}
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

// --- The stage: the shell, the table, the drawer / page / phone chrome. ---

interface StageProps {
  viewer: Viewer;
  pane: Pane;
  reportNumber: number;
  Variant: ComponentType<ReportPaneProps>;
  onFull: () => void;
  onBackFromPage: () => void;
}

function Stage(props: StageProps) {
  const { viewer, pane, reportNumber, Variant, onFull, onBackFromPage } = props;
  const listQuery = useQuery(ImsService.method.listReports, {
    eventId: EVENT.id,
    excludeSystemEntries: false,
  });
  // 09y finding 1: the query hook mounts a render after the rows are in, so
  // `setParams` (inside useReportQuery's own effects) never runs before this
  // screen — and the root layout beneath it — has mounted.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (!ready || listQuery.isLoading) {
    return <Splash />;
  }
  const reports = listQuery.data?.reports ?? [];
  return (
    <StageBody
      viewer={viewer}
      pane={pane}
      reportNumber={reportNumber}
      Variant={Variant}
      reports={reports}
      onFull={onFull}
      onBackFromPage={onBackFromPage}
    />
  );
}

interface StageBodyProps extends StageProps {
  reports: ReportView[];
}

function StageBody(props: StageBodyProps) {
  const {
    viewer,
    pane,
    reportNumber,
    Variant,
    reports,
    onFull,
    onBackFromPage,
  } = props;
  const router = useRouter();
  const q = useReportQuery(reports);
  const [help, setHelp] = useState(false);
  const handleRef = useRef<ReportPaneHandle>(null);

  // The band's "report" control is the authoritative selection for the
  // drawer / page panes — it opens the same URL state a row click would.
  // Idempotent (the condition itself no-ops once open === reportNumber), so
  // q.open / q.query.open changing on every render never loops.
  useEffect(() => {
    if (q.query.open !== reportNumber) {
      q.open(reportNumber);
    }
  }, [reportNumber, q.query.open, q.open]);

  useKeyboardMap({
    query: q.query,
    visible: q.visible,
    help,
    setHelp,
    setQuery: q.setQuery,
    select: q.select,
    open: q.open,
    close: q.close,
    move: q.move,
    onFull,
    searchRef: q.searchRef,
    handle: handleRef,
  });

  const onOpenIncident = (n: number) =>
    console.info(`[3c.3 round] open incident #${n} — not built in this half`);
  const onCreateIncident = () =>
    console.info(
      "[3c.3 round] create an incident from this report — not built in this half",
    );
  const onNewReport = () =>
    console.info(
      "[3c.3 round] New report — the 3b.3 form is out of scope for this round",
    );

  if (pane === "phone") {
    return (
      <PhonePane
        eventId={EVENT.id}
        number={reportNumber}
        viewer={viewer}
        Variant={Variant}
        onOpenIncident={onOpenIncident}
        onCreateIncident={onCreateIncident}
        handle={handleRef}
      />
    );
  }

  const { prev, next } = neighboursOf(q.visible, reportNumber);

  return (
    <Shell eventId={EVENT.id} onNewReport={onNewReport}>
      {pane === "page" ? (
        <ReportPage
          eventId={EVENT.id}
          number={reportNumber}
          viewer={viewer}
          Variant={Variant}
          prev={prev}
          next={next}
          onGoTo={(n) => router.setParams({ report: reportKeyFor(n) } as never)}
          onBack={onBackFromPage}
          onOpenIncident={onOpenIncident}
          onCreateIncident={onCreateIncident}
          handle={handleRef}
        />
      ) : (
        <>
          <ReportFilterBar
            q={q}
            total={reports.length}
            onHelp={() => setHelp(true)}
          />
          <View style={styles.fill}>
            <ReportTable q={q} onRowPress={(n) => q.open(n)} />
            <ReportDrawer
              q={q}
              eventId={EVENT.id}
              viewer={viewer}
              Variant={Variant}
              onFull={onFull}
              onOpenIncident={onOpenIncident}
              onCreateIncident={onCreateIncident}
              handle={handleRef}
            />
          </View>
        </>
      )}
    </Shell>
  );
}

function reportKeyFor(number: number): string {
  return (
    Object.entries(REPORT_NUMBERS).find(([, n]) => n === number)?.[0] ?? "R7"
  );
}

interface PhonePaneProps {
  eventId: number;
  number: number;
  viewer: Viewer;
  Variant: ComponentType<ReportPaneProps>;
  onOpenIncident: (n: number) => void;
  onCreateIncident: () => void;
  handle: RefObject<ReportPaneHandle | null>;
}

/** The phone pane (decision 1's 400px pass): the variant full-width with a `ScreenHeader`, no Shell/table. */
function PhonePane(props: PhonePaneProps) {
  const {
    eventId,
    number,
    viewer,
    Variant,
    onOpenIncident,
    onCreateIncident,
    handle,
  } = props;
  const edit = useEditReport(eventId, number);
  const view = useQuery(ImsService.method.getReport, {
    eventId,
    reportNumber: number,
  });
  return (
    <View style={styles.fill}>
      <ScreenHeader
        title={`R-${number}`}
        back={{ label: "Reports", onPress: () => {} }}
      />
      {view.data?.report?.report ? (
        <Variant
          view={view.data.report}
          eventId={eventId}
          edit={edit}
          viewer={viewer}
          onOpenIncident={onOpenIncident}
          onCreateIncident={onCreateIncident}
          handle={handle}
        />
      ) : (
        <EmptyState title={view.isLoading ? "Loading…" : "Not found"} />
      )}
    </View>
  );
}

// --- The runtime: the same real runtime + createFakeIms() the Jest harness
// uses (./runtime.ts), rebuilt whenever the viewer changes. ---

interface ReportsRuntime {
  runtime: SurfaceRuntime;
  queryClient: ReturnType<typeof createSurfaceQueryClient>;
}

function useReportsRuntime(viewer: Viewer): ReportsRuntime | undefined {
  const [state, setState] = useState<ReportsRuntime>();
  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    const fake = wrapReportsFake(
      createFakeIms({ user: userOverridesFor(viewer) }),
    );
    fake.people = PEOPLE;
    fake.incidents = incidentsForViewer();
    fake.reports = reportsForViewer(viewer);
    const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
    const runtime = createSurfaceRuntime(fake, store);
    const queryClient = createSurfaceQueryClient();
    void runtime.session.bootstrap().then(() => {
      if (!cancelled) {
        setState({ runtime, queryClient });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [viewer]);
  return state;
}

/** Delivers a new entry on R-7 and pokes it live, as the running fake would. */
function pokeNewEntry(state: ReportsRuntime): void {
  const fake = state.runtime.fake;
  const view = fake.reports.find((v) => v.report?.number === R7.number);
  if (!view?.report) {
    return;
  }
  const nextId =
    Math.max(0, ...view.report.journalEntries.map((e) => e.id)) + 1;
  const now = timestampFromDate(new Date());
  const next = create(ReportSchema, {
    ...view.report,
    journalEntries: [
      ...view.report.journalEntries,
      create(JournalEntrySchema, {
        id: nextId,
        created: now,
        author: "Ranger HQ",
        text: "Additional detail radioed in from the field.",
      }),
    ],
  });
  fake.reports = fake.reports.map((v) =>
    v === view ? create(ReportViewSchema, { ...view, report: next }) : v,
  );
  fake.poke({
    eventId: EVENT.id,
    kind: EventPokeKind.REPORT_CHANGED,
    reportNumber: R7.number,
  });
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
