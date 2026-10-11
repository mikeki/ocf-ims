// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import type { Person } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { ParticipationType } from "@ocf-ims/protocol-buffers/ocf/ims/resources/v1/person_pb";
import { createFakeIms, type FakeIms, type FakeUser } from "@/test/fakeIms";
import { makePerson } from "@/test/fixtures";
import { createTestRuntime } from "@/test/harness";
import { createMemoryRefreshTokenStore } from "@/test/storage";

// The fake's roster handlers (plan 09aa criterion 4): every ListPersonnel
// mode with the wire's field gating, SetPersonParticipation's ceiling,
// CreatePerson's reporter rule, and inviteReporters on GetAuthStatus.

function fixtureFake(user: Partial<FakeUser>): FakeIms {
  const fake = createFakeIms({ user: { personId: 42, ...user } });
  fake.events = [{ id: 1, name: "2026" }];
  fake.people = [
    makePerson({
      personId: 42,
      handle: "dee",
      email: "dee@example.org",
      phone: "555-0042",
      participationType: ParticipationType.REPORTER,
    }),
    makePerson({
      personId: 7,
      handle: "ash",
      name: "Ash Delacroix",
      email: "ash@example.org",
      phone: "555-0007",
      isAdmin: true,
      wristband: "WB-7",
      participationType: ParticipationType.WRITER,
    }),
    makePerson({
      personId: 8,
      handle: "rue",
      name: "Rue Park",
      email: "rue@example.org",
      participationType: ParticipationType.VOLUNTEER,
    }),
  ];
  return fake;
}

async function clientFor(fake: FakeIms) {
  const store = createMemoryRefreshTokenStore(fake.issueRefreshToken());
  const runtime = createTestRuntime({ fake, store, platform: "native" });
  await runtime.session.bootstrap();
  return runtime.client;
}

const byId = (people: Person[], id: number) =>
  people.find((p) => p.personId === id);

describe("fakeIms — ListPersonnel modes and field gating", () => {
  it("gives an admin email, phone and is_admin on the event roster", async () => {
    const client = await clientFor(fixtureFake({ admin: true }));
    const { people } = await client.listPersonnel({ eventId: 1, all: true });
    const ash = byId(people, 7);
    expect(ash?.email).toBe("ash@example.org");
    expect(ash?.isAdmin).toBe(true);
    expect(ash?.wristband).toBe("WB-7");
  });

  it("opens the event roster to an inviter but withholds contact fields and is_admin", async () => {
    const client = await clientFor(fixtureFake({ inviteReporters: true }));
    const { people } = await client.listPersonnel({ eventId: 1, all: true });
    const ash = byId(people, 7);
    expect(ash?.email).toBeUndefined();
    expect(ash?.phone).toBeUndefined();
    expect(ash?.isAdmin).toBe(false);
    expect(ash?.participationType).toBe(ParticipationType.WRITER);
    // The caller's own row keeps its contact fields.
    expect(byId(people, 42)?.email).toBe("dee@example.org");
  });

  it("keeps the global listing and show_all admin-only", async () => {
    const client = await clientFor(fixtureFake({ inviteReporters: true }));
    await expect(client.listPersonnel({ all: true })).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
    await expect(
      client.listPersonnel({ eventId: 1, all: true, showAll: true }),
    ).rejects.toBeInstanceOf(ConnectError);
  });

  it("refuses the roster to a plain viewer", async () => {
    const client = await clientFor(fixtureFake({}));
    await expect(
      client.listPersonnel({ eventId: 1, all: true }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it("answers person_ids for any viewer, with identity only", async () => {
    const client = await clientFor(fixtureFake({}));
    const { people } = await client.listPersonnel({ personIds: [7, 8] });
    expect(people.map((p) => p.personId)).toEqual([7, 8]);
    expect(people[0]?.email).toBeUndefined();
  });

  it("keeps the typeahead: nothing under two characters", async () => {
    const client = await clientFor(fixtureFake({}));
    expect(
      (await client.listPersonnel({ eventId: 1, query: "a" })).people,
    ).toEqual([]);
    expect(
      (await client.listPersonnel({ eventId: 1, query: "ash" })).people,
    ).toHaveLength(1);
  });

  it("answers the login directory when nothing is set", async () => {
    const client = await clientFor(fixtureFake({}));
    const { people } = await client.listPersonnel({});
    expect(people).toHaveLength(3);
    expect(people[0]?.email).toBeUndefined();
  });
});

describe("fakeIms — SetPersonParticipation's ceiling", () => {
  it("lets an admin set any rung", async () => {
    const fake = fixtureFake({ admin: true });
    const client = await clientFor(fake);
    await client.setPersonParticipation({
      personId: 8,
      eventId: 1,
      participationType: ParticipationType.WRITER,
    });
    expect(byId(fake.people, 8)?.participationType).toBe(
      ParticipationType.WRITER,
    );
  });

  it("lets an inviter send reporter / volunteer / public / not_present", async () => {
    const fake = fixtureFake({ inviteReporters: true });
    const client = await clientFor(fake);
    for (const type of [
      ParticipationType.REPORTER,
      ParticipationType.PUBLIC,
      ParticipationType.NOT_PRESENT,
    ]) {
      await client.setPersonParticipation({
        personId: 8,
        eventId: 1,
        participationType: type,
      });
    }
    expect(fake.setParticipationRequests).toHaveLength(3);
  });

  it("refuses an inviter a writer rung, and a target above the ceiling", async () => {
    const fake = fixtureFake({ inviteReporters: true });
    const client = await clientFor(fake);
    await expect(
      client.setPersonParticipation({
        personId: 8,
        eventId: 1,
        participationType: ParticipationType.WRITER,
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
    await expect(
      client.setPersonParticipation({
        personId: 7,
        eventId: 1,
        participationType: ParticipationType.PUBLIC,
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(byId(fake.people, 7)?.participationType).toBe(
      ParticipationType.WRITER,
    );
  });

  it("refuses a viewer who may not invite", async () => {
    const client = await clientFor(fixtureFake({}));
    await expect(
      client.setPersonParticipation({
        personId: 8,
        eventId: 1,
        participationType: ParticipationType.PUBLIC,
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it("honours the setParticipation behaviour", async () => {
    const fake = fixtureFake({ admin: true });
    fake.behaviour.setParticipation = "forbidden";
    const client = await clientFor(fake);
    await expect(
      client.setPersonParticipation({
        personId: 8,
        eventId: 1,
        participationType: ParticipationType.PUBLIC,
      }),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });
});

describe("fakeIms — CreatePerson, crews and access", () => {
  it("lands an inviter's create as a reporter", async () => {
    const client = await clientFor(fixtureFake({ inviteReporters: true }));
    const res = await client.createPerson({
      handle: "new",
      eventId: 1,
      participationType: ParticipationType.WRITER,
    });
    expect(res.person?.participationType).toBe(ParticipationType.REPORTER);
  });

  it("lands an admin's create at the rung asked", async () => {
    const client = await clientFor(fixtureFake({ admin: true }));
    const res = await client.createPerson({
      handle: "new",
      eventId: 1,
      participationType: ParticipationType.WRITER,
    });
    expect(res.person?.participationType).toBe(ParticipationType.WRITER);
  });

  it("reports invite_reporters on GetAuthStatus", async () => {
    const client = await clientFor(fixtureFake({ inviteReporters: true }));
    const auth = await client.getAuthStatus({ eventId: 1 });
    expect(auth.eventAccess[1]?.inviteReporters).toBe(true);
    const plain = await clientFor(fixtureFake({}));
    expect(
      (await plain.getAuthStatus({ eventId: 1 })).eventAccess[1]
        ?.inviteReporters,
    ).toBe(false);
  });

  it("answers ListMyCrews with the crews the caller leads", async () => {
    const fake = fixtureFake({});
    const client = await clientFor(fake);
    expect((await client.listMyCrews({ eventId: 1 })).crews).toEqual([]);
  });
});
