// SPDX-License-Identifier: Apache-2.0

import { toJson } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { createConnectQueryKey } from "@connectrpc/connect-query";
import {
  type Report,
  ReportSchema,
} from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/report_pb";
import type { GetReportResponse } from "@ocf-ims/protocol-buffers/ocf/ims/service/rpc/v1/report_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { useReport } from "@/features/board/hooks";
import { useEditReport } from "@/features/reports/useEditReport";
import { SessionProvider } from "@/session/provider";
import { createRuntime, type Runtime } from "@/session/runtime";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms, type FakeIms } from "@/test/fakeIms";
import {
  makeIncident,
  makeIncidentView,
  makeJournalEntry,
  makeReport,
  makeReportView,
} from "@/test/fixtures";
import { createTestQueryClient } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

async function runtimeOver(
  fake: FakeIms,
  wrap: (base: Transport) => Transport = (t) => t,
): Promise<Runtime> {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createRuntime({
    makeTransport: (interceptors) =>
      wrap(createRouterTransport(fake.routes, { transport: { interceptors } })),
    store,
    platform: "native",
    makeBlobs: () => createFakeBlobs(),
  });
  await runtime.session.bootstrap();
  return runtime;
}

/** Holds every call to `methodName` open until `gate` resolves. */
function delayMethod(
  base: Transport,
  methodName: string,
  gate: Promise<void>,
): Transport {
  return {
    ...base,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === methodName) {
        await gate;
      }
      return base.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
    },
  };
}

/** Rejects every call to `methodName` whose input matches, before it reaches the fake. */
function failMethod(
  base: Transport,
  methodName: string,
  matches: (input: { report?: Report }) => boolean,
): Transport {
  return {
    ...base,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === methodName && matches(input as { report?: Report })) {
        throw new ConnectError("redeploying", Code.Unavailable);
      }
      return base.unary(
        method,
        signal,
        timeoutMs,
        header,
        input,
        contextValues,
      );
    },
  };
}

function wrapperFor(
  runtime: Runtime,
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider scheme="light">
        <ApiProvider transport={runtime.transport} queryClient={queryClient}>
          <SessionProvider session={runtime.session}>
            {children}
          </SessionProvider>
        </ApiProvider>
      </ThemeProvider>
    );
  };
}

function reporterFake(): FakeIms {
  const fake = createFakeIms({ user: { writeReports: true } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.incidents = [
    makeIncidentView({ incident: makeIncident({ eventId: 1, number: 12 }) }),
    makeIncidentView({ incident: makeIncident({ eventId: 1, number: 13 }) }),
  ];
  fake.reports = [
    makeReportView({
      mayEditSummary: true,
      mayAddJournalEntry: true,
      report: makeReport({
        number: 5,
        summary: "Original",
        createdBy: { personId: 42, handle: "Dee" },
        incident: 12,
        journalEntries: [
          makeJournalEntry({ id: 50, author: "Dee", text: "Mine" }),
        ],
      }),
    }),
  ];
  return fake;
}

function useProbe(eventId: number, number: number) {
  const reportQuery = useReport(eventId, number);
  const edit = useEditReport(eventId, number);
  return { reportQuery, edit };
}

async function mountProbe(
  runtime: Runtime,
  queryClient: ReturnType<typeof createTestQueryClient>,
) {
  const { result } = await renderHook(() => useProbe(1, 5), {
    wrapper: wrapperFor(runtime, queryClient),
  });
  await waitFor(() => expect(result.current.reportQuery.data).toBeDefined());
  return result;
}

const reportKeys = (runtime: Runtime, eventId = 1, number = 5) => ({
  get: createConnectQueryKey({
    schema: ImsService.method.getReport,
    transport: runtime.transport,
    input: { eventId, reportNumber: number },
    cardinality: "finite",
  }),
  list: createConnectQueryKey({
    schema: ImsService.method.listReports,
    transport: runtime.transport,
    cardinality: "finite",
  }),
});

const incidentKeys = (runtime: Runtime, incidentNumber: number) => [
  createConnectQueryKey({
    schema: ImsService.method.getIncident,
    transport: runtime.transport,
    input: { eventId: 1, incidentNumber },
    cardinality: "finite",
  }),
  createConnectQueryKey({
    schema: ImsService.method.listIncidents,
    transport: runtime.transport,
    cardinality: "finite",
  }),
];

function keysOf(report: Report | undefined): string[] {
  return report ? Object.keys(toJson(ReportSchema, report)).sort() : [];
}

describe("useEditReport", () => {
  it("sends each field as its own plain Report", async () => {
    const fake = reporterFake();
    const runtime = await runtimeOver(fake);
    const result = await mountProbe(runtime, createTestQueryClient());

    await act(async () => {
      await result.current.edit.setSummary("Edited");
      await result.current.edit.setIncident(13);
      await result.current.edit.strike(50, true);
    });

    expect(fake.updateReportRequests).toHaveLength(2);
    expect(keysOf(fake.updateReportRequests[0]?.report)).toEqual(["summary"]);
    expect(fake.updateReportRequests[0]?.report?.summary).toBe("Edited");
    expect(keysOf(fake.updateReportRequests[1]?.report)).toEqual(["incident"]);
    expect(fake.updateReportRequests[1]?.report?.incident).toBe(13);
    // The strike is its own RPC, carrying only the entry's id and stricken.
    expect(
      fake.reports[0]?.report?.journalEntries.find((e) => e.id === 50)
        ?.stricken,
    ).toBe(true);
  });

  it("setIncident(0) detaches", async () => {
    const fake = reporterFake();
    const runtime = await runtimeOver(fake);
    const result = await mountProbe(runtime, createTestQueryClient());
    await act(async () => {
      await result.current.edit.setIncident(0);
    });
    expect(fake.updateReportRequests[0]?.report?.incident).toBe(0);
    expect(fake.reports[0]?.report?.incident).toBeUndefined();
    await waitFor(() =>
      expect(
        result.current.reportQuery.data?.report?.report?.incident,
      ).toBeUndefined(),
    );
  });

  it("the cache shows the optimistic value before the fake answers", async () => {
    const fake = reporterFake();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await runtimeOver(fake, (t) =>
      delayMethod(t, "UpdateReport", gate),
    );
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);
    const key = reportKeys(runtime).get;

    let saved: Promise<void> = Promise.resolve();
    await act(async () => {
      saved = result.current.edit.setSummary("Edited");
      await waitFor(() =>
        expect(
          queryClient.getQueryData<GetReportResponse>(key)?.report?.report
            ?.summary,
        ).toBe("Edited"),
      );
    });
    expect(fake.updateReportRequests).toHaveLength(0);
    await act(async () => {
      release();
      await saved;
    });
    expect(fake.updateReportRequests).toHaveLength(1);
  });

  it("a failing summary save restores it and surfaces the error at the control", async () => {
    const fake = reporterFake();
    const runtime = await runtimeOver(fake, (t) =>
      failMethod(
        t,
        "UpdateReport",
        (input) => input.report?.summary !== undefined,
      ),
    );
    const result = await mountProbe(runtime, createTestQueryClient());

    await act(async () => {
      await expect(result.current.edit.setSummary("Edited")).rejects.toThrow();
    });

    await waitFor(() =>
      expect(result.current.edit.status("summary").error).toBeDefined(),
    );
    expect(result.current.edit.status("incident").error).toBeUndefined();
    expect(result.current.reportQuery.data?.report?.report?.summary).toBe(
      "Original",
    );
  });

  it("a summary save invalidates the report and the list, not the incident", async () => {
    const fake = reporterFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);
    const spy = jest.spyOn(queryClient, "invalidateQueries");
    spy.mockClear();

    await act(async () => {
      await result.current.edit.setSummary("Edited");
    });

    const keys = reportKeys(runtime);
    const called = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(called).toEqual([keys.get, keys.list]);
  });

  it("a link change also invalidates the old and the new incident", async () => {
    const fake = reporterFake();
    const runtime = await runtimeOver(fake);
    const queryClient = createTestQueryClient();
    const result = await mountProbe(runtime, queryClient);
    const spy = jest.spyOn(queryClient, "invalidateQueries");
    spy.mockClear();

    await act(async () => {
      await result.current.edit.setIncident(13);
    });

    const called = spy.mock.calls.map((c) => c[0]?.queryKey);
    const keys = reportKeys(runtime);
    expect(called).toEqual(
      expect.arrayContaining([
        keys.get,
        keys.list,
        ...incidentKeys(runtime, 12),
        ...incidentKeys(runtime, 13),
      ]),
    );
  });
});
