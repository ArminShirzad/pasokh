import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsRefusedError, SmsUnclearError, sendSms, smsParts } from "../lib/sms/providers";

const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  });
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const phones = ["09120000001", "09120000002"];

describe("Kavenegar", () => {
  const config = { provider: "KAVENEGAR" as const, apiKey: "KEY/1", sender: "10004346" };

  it("sends one request with the receptors comma-separated and the key in the path", async () => {
    respond(200, { return: { status: 200, message: "تایید شد" }, entries: [{ messageid: 11, receptor: "09120000001" }, { messageid: 12, receptor: "09120000002" }] });
    expect(await sendSms(config, phones, "سلام")).toEqual({ ids: ["11", "12"] });
    expect(calls[0].url).toBe("https://api.kavenegar.com/v1/KEY%2F1/sms/send.json");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ receptor: "09120000001,09120000002", message: "سلام", sender: "10004346" });
  });

  it("stops everything on no credit, but treats a bad number as that batch's problem only", async () => {
    respond(418, { return: { status: 418, message: "اعتبار کافی نیست" } });
    await expect(sendSms(config, phones, "x")).rejects.toMatchObject({ name: "SmsRefusedError", account: true });
    respond(411, { return: { status: 411, message: "گیرنده نامعتبر" } });
    await expect(sendSms(config, phones, "x")).rejects.toMatchObject({ name: "SmsRefusedError", account: false });
  });
});

describe("sms.ir", () => {
  it("posts the line, text and mobiles with the key in X-API-KEY", async () => {
    respond(200, { status: 1, message: "موفق", data: { packId: "p", messageIds: [91, 92], cost: 2 } });
    expect(await sendSms({ provider: "SMSIR", apiKey: "k", sender: "30007732" }, phones, "سلام")).toEqual({ ids: ["91", "92"] });
    expect(calls[0].url).toBe("https://api.sms.ir/v1/send/bulk");
    expect(calls[0].headers["X-API-KEY"]).toBe("k");
    expect(JSON.parse(calls[0].body)).toEqual({ lineNumber: 30007732, messageText: "سلام", mobiles: phones, sendDateTime: null });
  });

  it("treats any status other than 1 as refused", async () => {
    respond(400, { status: 0, message: "خط نامعتبر" });
    await expect(sendSms({ provider: "SMSIR", apiKey: "k", sender: "1" }, phones, "x")).rejects.toBeInstanceOf(SmsRefusedError);
  });
});

describe("Melipayamak", () => {
  it("posts to the console's advanced send with the token in the path and the numbers as an array", async () => {
    respond(200, { recIds: [5001, 5002], status: "" });
    expect(await sendSms({ provider: "MELIPAYAMAK", apiKey: "tok", sender: "5000" }, phones, "سلام")).toEqual({ ids: ["5001", "5002"] });
    expect(calls[0].url).toBe("https://console.melipayamak.com/api/send/advanced/tok");
    expect(JSON.parse(calls[0].body)).toEqual({ from: "5000", to: phones, text: "سلام", udh: "" });
  });

  it("treats a status text as the panel refusing", async () => {
    respond(200, { recIds: [], status: "اعتبار کافی نمی باشد" });
    await expect(sendSms({ provider: "MELIPAYAMAK", apiKey: "tok", sender: "5000" }, phones, "x")).rejects.toBeInstanceOf(SmsRefusedError);
  });
});

describe("answers that do not say whether it was sent", () => {
  it("calls a network failure, a 5xx and an unreadable body unclear rather than refused, so they are never resent", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(sendSms({ provider: "SMSIR", apiKey: "k", sender: "1" }, phones, "x")).rejects.toBeInstanceOf(SmsUnclearError);
    respond(502, "Bad gateway");
    await expect(sendSms({ provider: "SMSIR", apiKey: "k", sender: "1" }, phones, "x")).rejects.toBeInstanceOf(SmsUnclearError);
    respond(200, "<html>maintenance</html>");
    await expect(sendSms({ provider: "KAVENEGAR", apiKey: "k", sender: "" }, phones, "x")).rejects.toBeInstanceOf(SmsUnclearError);
  });
});

describe("message length", () => {
  it("counts Persian at 70 characters for one SMS and 67 per part once split, Latin at 160 and 153", () => {
    expect(smsParts("س".repeat(70))).toMatchObject({ parts: 1, unicode: true });
    expect(smsParts("س".repeat(71))).toMatchObject({ parts: 2 });
    expect(smsParts("س".repeat(135))).toMatchObject({ parts: 3 });
    expect(smsParts("a".repeat(160))).toMatchObject({ parts: 1, unicode: false });
    expect(smsParts("a".repeat(161))).toMatchObject({ parts: 2 });
    expect(smsParts("")).toMatchObject({ parts: 0 });
  });
});
