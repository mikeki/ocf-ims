// SPDX-License-Identifier: Apache-2.0

import type { Transport } from "@connectrpc/connect";
import { createRouterTransport } from "@connectrpc/connect";
import { useQuery } from "@connectrpc/connect-query";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ImsService } from "@ocf-ims/protocol-buffers/ocf/ims/service/v1/service_pb";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ApiProvider } from "@/api/providers";
import { ThemeProvider } from "@/design/theme";
import { useRoster } from "@/features/people/useRoster";
import { SessionProvider } from "@/session/provider";
import { createRuntime, type Runtime } from "@/session/runtime";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import { makePerson } from "@/test/fixtures";
import { createTestQueryClient } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// useRoster (plan 09aa): optimistic on the card, the error at the control and
// never rethrown, ListPersonnel (every mode) and ListMyCrews invalidated on
// settle.

function rosterFake(user: Partial<FakeUser> = { admin: true }): FakeIms {
  const fake = createFakeIms({ user });
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    makePerson({
      personId: 7,
      handle: "ray",
      participationType: ParticipationType.REPORTER,
    }),
    makePerson({
      personId: 8,
      handle: "wes",
      participationType: ParticipationType.WRITER,
    }),
  ];
  return fake;
}

async function runtimeOver(
  fake: FakeIms,
  wrap: (base: Transport) => Transport = (t) => t,
): Promise<Runtime> {
  const runtime = createRuntime({
    makeTransport: (interceptors) =>
      wrap(createRouterTransport(fake.routes, { transport: { interceptors } })),
    store: createMemoryRefreshTokenStore(fake.issueRefreshToken()),
    platform: "native",
    makeBlobs: () => createFakeBlobs(),
  });
  await runtime.session.bootstrap();
  return runtime;
}

function holdSetParticipation(base: Transport, gate: Promise<void>): Transport {
  return {
    ...base,
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      if (method.name === "SetPersonParticipation") {
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

function setup(runtime: Runtime) {
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider scheme="light">
      <ApiProvider transport={runtime.transport} queryClient={queryClient}>
        <SessionProvider session={runtime.session}>{children}</SessionProvider>
      </ApiProvider>
    </ThemeProvider>
  );
  return renderHook(
    () => {
      const list = useQuery(ImsService.method.listPersonnel, {
        eventId: 1,
        all: true,
      });
      const roster = useRoster(1);
      return { list, roster };
    },
    { wrapper: Wrapper },
  );
}

const rungOf = (
  result: {
    current: {
      list: {
        data?: {
          people: { personId: number; participationType: ParticipationType }[];
        };
      };
    };
  },
  id: number,
) =>
  result.current.list.data?.people.find((p) => p.personId === id)
    ?.participationType;

describe("useRoster", () => {
  it("patches the card ahead of the network, then settles on the server's answer", async () => {
    const fake = rosterFake();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = await runtimeOver(fake, (t) =>
      holdSetParticipation(t, gate),
    );
    const { result } = await setup(runtime);
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.roster.setRole(7, ParticipationType.VOLUNTEER);
    });
    await waitFor(() =>
      expect(rungOf(result, 7)).toBe(ParticipationType.VOLUNTEER),
    );
    expect(fake.setParticipationRequests).toHaveLength(0);
    expect(result.current.roster.pendingFor(7)).toBe(true);

    const before = fake.callsOf("ListPersonnel").length;
    release();
    await act(async () => {
      await pending;
    });
    expect(result.current.roster.pendingFor(7)).toBe(false);
    expect(fake.setParticipationRequests[0]?.participationType).toBe(
      ParticipationType.VOLUNTEER,
    );
    // The settle refetched the list.
    expect(fake.callsOf("ListPersonnel").length).toBeGreaterThan(before);
    expect(rungOf(result, 7)).toBe(ParticipationType.VOLUNTEER);
  });

  it("leaves the error at the card for a forbidden write and never rejects", async () => {
    const fake = rosterFake({ inviteReporters: true });
    const runtime = await runtimeOver(fake);
    const { result } = await setup(runtime);
    await waitFor(() => expect(result.current.list.data).toBeDefined());

    // A writer is above an inviter's ceiling: the server refuses.
    await act(async () => {
      await expect(
        result.current.roster.setRole(8, ParticipationType.PUBLIC),
      ).resolves.toBeUndefined();
    });
    expect(result.current.roster.errorFor(8)).toBeDefined();
    expect(result.current.roster.pendingFor(8)).toBe(false);
    // Rolled back to the server's truth.
    await waitFor(() =>
      expect(rungOf(result, 8)).toBe(ParticipationType.WRITER),
    );
  });

  it("removes with a SetPersonParticipation write, never RemovePersonFromEvent", async () => {
    const fake = rosterFake();
    const runtime = await runtimeOver(fake);
    const { result } = await setup(runtime);
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    await act(async () => {
      await result.current.roster.remove(7, ParticipationType.NOT_PRESENT);
    });
    expect(fake.setParticipationRequests[0]?.participationType).toBe(
      ParticipationType.NOT_PRESENT,
    );
    expect(fake.callsOf("RemovePersonFromEvent")).toHaveLength(0);
  });

  it("invalidates ListMyCrews and every ListPersonnel mode on settle", async () => {
    const fake = rosterFake();
    const runtime = await runtimeOver(fake);
    const { result } = await setup(runtime);
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    const queryClient = createTestQueryClient();
    expect(queryClient).toBeDefined();
    await act(async () => {
      await result.current.roster.addToCrew("sanctuary", 7);
    });
    // The crew write failed (no such crew) and still settled: the list refetched.
    expect(fake.setMyCrewMembershipRequests).toHaveLength(1);
    expect(result.current.roster.errorFor(7)).toBeDefined();
    expect(fake.callsOf("ListPersonnel").length).toBeGreaterThan(1);
  });

  it("create lands the person, and a refused create is held in createError, not thrown", async () => {
    const fake = rosterFake({ inviteReporters: true });
    const runtime = await runtimeOver(fake);
    const { result } = await setup(runtime);
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    await act(async () => {
      const created = await result.current.roster.create({
        handle: "new",
        name: "New Person",
        participationType: ParticipationType.WRITER,
      });
      expect(created?.participationType).toBe(ParticipationType.REPORTER);
    });
    fake.behaviour.createPerson = "forbidden";
    await act(async () => {
      await expect(
        result.current.roster.create({ handle: "x" }),
      ).resolves.toBeUndefined();
    });
    expect(result.current.roster.createError).toBeDefined();
  });
});
