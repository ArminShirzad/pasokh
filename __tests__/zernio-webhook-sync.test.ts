import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  update: vi.fn(),
  event: vi.fn(),
  listWebhooks: vi.fn(),
  ensureWebhook: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    zernioConnection: { findMany: async () => mocks.connections, update: mocks.update },
    operationalEvent: { create: mocks.event },
  },
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (v: string) => `plain:${v}` }));
vi.mock("@/lib/zernio/manage-remote", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/zernio/manage-remote")>();
  return { webhookUrl: real.webhookUrl, listWebhooks: mocks.listWebhooks, ensureWebhook: mocks.ensureWebhook };
});

import { syncZernioWebhooks } from "../lib/zernio/sync-webhooks";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.event.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.connections = [{ workspaceId: "ws1", apiKey: "k", webhookSecret: "s", webhookId: "wh1", profileId: "p1" }];
});

describe("Zernio webhook sync on worker start", () => {
  it("re-points a webhook still aimed at the previous tunnel URL", async () => {
    mocks.listWebhooks.mockResolvedValue([{ _id: "wh1", url: "https://old-name.trycloudflare.com/api/zernio/webhook/ws1" }]);
    mocks.ensureWebhook.mockResolvedValue("wh1");

    const result = await syncZernioWebhooks("https://new-name.trycloudflare.com");

    expect(mocks.ensureWebhook).toHaveBeenCalledWith({
      apiKey: "plain:k",
      workspaceId: "ws1",
      secret: "plain:s",
      baseUrl: "https://new-name.trycloudflare.com",
      webhookId: "wh1",
    });
    expect(result).toEqual({ checked: 1, updated: 1, failed: 0 });
  });

  it("makes no write call when the webhook already points at the current URL", async () => {
    mocks.listWebhooks.mockResolvedValue([{ _id: "wh1", url: "https://shop.example/api/zernio/webhook/ws1" }]);

    const result = await syncZernioWebhooks("https://shop.example");

    expect(mocks.ensureWebhook).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, updated: 0, failed: 0 });
  });

  it("recreates a webhook that was deleted in Zernio", async () => {
    mocks.listWebhooks.mockResolvedValue([]);
    mocks.ensureWebhook.mockResolvedValue("wh2");

    await syncZernioWebhooks("https://shop.example");

    expect(mocks.update).toHaveBeenCalledWith({ where: { workspaceId: "ws1" }, data: { webhookId: "wh2" } });
  });

  it("keeps going past a workspace whose Zernio key fails, and records it", async () => {
    mocks.connections.push({ workspaceId: "ws2", apiKey: "k2", webhookSecret: "s2", webhookId: "wh9", profileId: "p2" });
    mocks.listWebhooks.mockRejectedValueOnce(new Error("401 invalid key")).mockResolvedValueOnce([]);
    mocks.ensureWebhook.mockResolvedValue("wh10");

    const result = await syncZernioWebhooks("https://shop.example");

    expect(result).toEqual({ checked: 2, updated: 1, failed: 1 });
    expect(mocks.event).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: "ws1", level: "ERROR" }) })
    );
  });
});
