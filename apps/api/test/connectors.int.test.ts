import { randomBytes } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  ConnectorSchema,
  DirectoryGroupSchema,
  DirectoryUserSchema,
  SyncRunSchema,
} from "@nf/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { JobWorker } from "../src/modules/jobs/job-worker.js";
import { WorkerModule } from "../src/worker.module.js";
import { ids, type MockDirectory, startMockDirectory } from "./graph-mock.js";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let graph: MockDirectory;
let workerCtx: INestApplicationContext;
let worker: JobWorker;
let acme: Fixture;
let other: Fixture;

const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

beforeAll(async () => {
  graph = await startMockDirectory();
  t = await startApp({
    NF_DATA_KEY: randomBytes(32).toString("base64"),
    NF_GRAPH_AUTHORITY_URL: graph.url,
    NF_GRAPH_API_URL: graph.url,
  });
  workerCtx = await NestFactory.createApplicationContext(WorkerModule.forRoot(t.config), {
    logger: false,
  });
  worker = workerCtx.get(JobWorker);
  // Start from an empty queue: other test files share this database.
  await t.database.system.job.deleteMany({ where: { status: { in: ["queued", "running"] } } });
  acme = await seedTenant(t, "conn");
  other = await seedTenant(t, "conn-other");
});

afterAll(async () => {
  await workerCtx?.close();
  await t?.close();
  await graph?.close();
});

async function createConnector(name: string, secret = graph.clientSecret) {
  const admin = await signIn(t, acme.tenantId, acme.admin);
  const res = await admin
    .post("/api/v1/connectors")
    .send({
      kind: "microsoft_graph",
      name,
      directoryId: graph.directoryId,
      clientId: graph.clientId,
      clientSecret: secret,
      syncIntervalMinutes: 0,
    })
    .expect(201);
  return ConnectorSchema.parse(res.body);
}

describe("connector management", () => {
  it("requires connectors.manage; the auditor can only read", async () => {
    const auditor = await signIn(t, acme.tenantId, acme.auditor);
    await auditor
      .post("/api/v1/connectors")
      .send({
        kind: "microsoft_graph",
        name: "nope",
        directoryId: graph.directoryId,
        clientId: graph.clientId,
        clientSecret: "x".repeat(12),
      })
      .expect(403);
    await auditor.get("/api/v1/connectors").expect(200);
  });

  it("validates directory and application ids", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const res = await admin
      .post("/api/v1/connectors")
      .send({
        kind: "microsoft_graph",
        name: "bad",
        directoryId: "not a tenant",
        clientId: "nope",
        clientSecret: "x".repeat(12),
      })
      .expect(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("stores the secret encrypted and never returns it", async () => {
    const c = await createConnector("Contoso secret check");
    expect(JSON.stringify(c)).not.toContain(graph.clientSecret);
    expect(c.secretHint).toBe(`••••${graph.clientSecret.slice(-4)}`);
    const row = await t.database.system.connector.findUniqueOrThrow({ where: { id: c.id } });
    expect(Buffer.from(row.secretCiphertext!).includes(Buffer.from(graph.clientSecret))).toBe(
      false,
    );
  });

  it("tests the connection without changing anything", async () => {
    const c = await createConnector("Contoso test");
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const res = await admin.post(`/api/v1/connectors/${c.id}/test`).expect(200);
    expect(res.body).toMatchObject({ ok: true });

    const bad = await createConnector("Contoso wrong secret", "definitely-wrong-secret");
    const fail = await admin.post(`/api/v1/connectors/${bad.id}/test`).expect(200);
    expect(fail.body).toMatchObject({ ok: false, message: expect.stringMatching(/secret/i) });
  });

  it("is invisible to other tenants", async () => {
    const c = await createConnector("Contoso isolation");
    const stranger = await signIn(t, other.tenantId, other.owner);
    await stranger.get(`/api/v1/connectors/${c.id}`).expect(404);
    await stranger.post(`/api/v1/connectors/${c.id}/sync`).expect(404);
    const list = await stranger.get("/api/v1/connectors").expect(200);
    expect(list.body).toEqual([]);
  });
});

describe("directory sync (Microsoft Graph delta queries)", () => {
  let connectorId: string;

  it("runs a full sync through the job queue, following paging and retrying a 429", async () => {
    const c = await createConnector("Contoso");
    connectorId = c.id;
    const admin = await signIn(t, acme.tenantId, acme.admin);

    const queued = SyncRunSchema.parse(
      (await admin.post(`/api/v1/connectors/${c.id}/sync`).expect(202)).body,
    );
    expect(queued.status).toBe("queued");
    // One sync per connector at a time.
    await admin.post(`/api/v1/connectors/${c.id}/sync`).expect(409);

    graph.throttleNext(1);
    expect(await worker.drain()).toBeGreaterThanOrEqual(1);

    const runs = Page(SyncRunSchema).parse(
      (await admin.get(`/api/v1/connectors/${c.id}/runs`).expect(200)).body,
    );
    expect(runs.items[0]).toMatchObject({
      id: queued.id,
      status: "succeeded",
      mode: "full",
      usersUpserted: 3,
      groupsUpserted: 1,
      error: null,
    });

    const users = Page(DirectoryUserSchema).parse(
      (await admin.get(`/api/v1/directory/users?connectorId=${c.id}`).expect(200)).body,
    );
    expect(users.items.map((u) => u.displayName).sort()).toEqual([
      "Ada Lovelace",
      "Alan Turing",
      "Grace Hopper",
    ]);
    expect(users.items.find((u) => u.externalId === ids.U(3))?.accountEnabled).toBe(false);

    const groups = Page(DirectoryGroupSchema).parse(
      (await admin.get(`/api/v1/directory/groups?connectorId=${c.id}`).expect(200)).body,
    );
    expect(groups.items).toHaveLength(1);
    expect(groups.items[0]).toMatchObject({ displayName: "Engineering", memberCount: 2 });

    const connector = ConnectorSchema.parse(
      (await admin.get(`/api/v1/connectors/${c.id}`).expect(200)).body,
    );
    expect(connector).toMatchObject({
      lastSyncStatus: "succeeded",
      counts: { users: 3, groups: 1 },
    });
  });

  it("applies only the changes on the next (delta) sync", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin.post(`/api/v1/connectors/${connectorId}/sync`).expect(202);
    await worker.drain();

    const runs = (await admin.get(`/api/v1/connectors/${connectorId}/runs`).expect(200)).body;
    expect(runs.items[0]).toMatchObject({
      status: "succeeded",
      mode: "delta",
      usersUpserted: 1,
      usersRemoved: 1,
    });

    const users = (await admin.get(`/api/v1/directory/users?connectorId=${connectorId}`)).body;
    const names = users.items.map((u: { displayName: string }) => u.displayName).sort();
    expect(names).toEqual(["Ada Lovelace", "Rear Admiral Grace Hopper"]);
    // A partial delta update keeps the properties Graph didn't resend.
    const grace = users.items.find((u: { externalId: string }) => u.externalId === ids.U(2));
    expect(grace).toMatchObject({ mail: "grace@contoso.example", jobTitle: "Admiral" });

    const groups = (await admin.get(`/api/v1/directory/groups?connectorId=${connectorId}`)).body;
    const members = (
      await admin.get(`/api/v1/directory/groups/${groups.items[0].id}/members`).expect(200)
    ).body;
    expect(members.items.map((m: { displayName: string | null }) => m.displayName).sort()).toEqual([
      "Ada Lovelace",
      "Rear Admiral Grace Hopper",
    ]);
  });

  it("falls back to a full sync when the delta token has expired", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    graph.expireDeltaTokens(true);
    try {
      await admin.post(`/api/v1/connectors/${connectorId}/sync`).expect(202);
      await worker.drain();
    } finally {
      graph.expireDeltaTokens(false);
    }
    const runs = (await admin.get(`/api/v1/connectors/${connectorId}/runs`)).body;
    expect(runs.items[0]).toMatchObject({ status: "succeeded", mode: "full" });
    // The full listing brings Alan back (he is in the mock's full snapshot again).
    const users = (await admin.get(`/api/v1/directory/users?connectorId=${connectorId}`)).body;
    expect(users.items).toHaveLength(3);
  });

  it("keeps other tenants out of the synced directory", async () => {
    const stranger = await signIn(t, other.tenantId, other.owner);
    const users = (await stranger.get("/api/v1/directory/users").expect(200)).body;
    expect(users.items).toEqual([]);
    const groups = (await signIn(t, acme.tenantId, acme.admin)).get(
      `/api/v1/directory/groups?connectorId=${connectorId}`,
    );
    const groupId = (await groups).body.items[0].id;
    await stranger.get(`/api/v1/directory/groups/${groupId}/members`).expect(404);
  });

  it("dead-letters a sync with a bad credential at once and records why", async () => {
    const bad = await createConnector("Contoso broken", "definitely-wrong-secret");
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin.post(`/api/v1/connectors/${bad.id}/sync`).expect(202);
    await worker.drain();

    const runs = (await admin.get(`/api/v1/connectors/${bad.id}/runs`)).body;
    expect(runs.items[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      error: expect.stringMatching(/secret/i),
    });
    const audit = await admin.get("/api/v1/audit-events?action=connector.sync_failed").expect(200);
    expect(audit.body.items[0]).toMatchObject({ target: { id: bad.id }, outcome: "failure" });
    // The failed job released its key: a new sync can be requested.
    await admin.post(`/api/v1/connectors/${bad.id}/sync`).expect(202);
    await worker.drain();
  });

  it("refuses to sync a disabled connector", async () => {
    const c = await createConnector("Contoso disabled");
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .patch(`/api/v1/connectors/${c.id}`)
      .send({ version: c.version, status: "disabled" })
      .expect(200);
    await admin.post(`/api/v1/connectors/${c.id}/sync`).expect(409);
  });

  it("deleting a connector removes its directory data and is audited", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner
      .delete(`/api/v1/connectors/${connectorId}`)
      .send({ reason: "migrating to a new app registration" })
      .expect(204);
    const left = await t.database.system.directoryUser.count({ where: { connectorId } });
    expect(left).toBe(0);
    const audit = await owner.get("/api/v1/audit-events?action=connector.deleted").expect(200);
    expect(audit.body.items[0]).toMatchObject({
      target: { id: connectorId },
      metadata: { reason: "migrating to a new app registration" },
    });
  });
});
