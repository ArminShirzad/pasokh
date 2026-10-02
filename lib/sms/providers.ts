/**
 * Iranian SMS panels. Formats as documented by each provider, read
 * 2026-10-03: Kavenegar REST (sms/send.json, comma-separated receptors, at
 * most 200), sms.ir v1 (POST /v1/send/bulk, X-API-KEY), Melipayamak console
 * (POST /api/send/advanced/{token}, `to` as an array).
 */

export type SmsProviderName = "KAVENEGAR" | "SMSIR" | "MELIPAYAMAK" | "TEST";
export type SmsConfig = { provider: SmsProviderName; apiKey: string; sender: string };

/** Recipients per provider call; below every provider's own limit. */
export const SMS_BATCH = 100;

/**
 * The provider answered and said no: nothing was sent. `account` marks
 * problems that stop every later batch too (credit, key, sender line).
 */
export class SmsRefusedError extends Error {
  name = "SmsRefusedError";
  constructor(message: string, readonly account: boolean) {
    super(message);
  }
}

/** No clear answer (network, timeout, 5xx, unreadable body): it may have been sent. */
export class SmsUnclearError extends Error {
  name = "SmsUnclearError";
}

export type SmsResult = { ids: (string | null)[] };

async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new SmsUnclearError(`SMS provider did not answer: ${error instanceof Error ? error.message : error}`);
  }
  const text = await response.text();
  if (response.status >= 500) throw new SmsUnclearError(`SMS provider error (HTTP ${response.status})`);
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    if (response.status === 401 || response.status === 403) throw new SmsRefusedError("The SMS API key was refused", true);
    throw new SmsUnclearError(`SMS provider answered with something unreadable (HTTP ${response.status})`);
  }
}

// Kavenegar return.status codes that concern the account rather than a number.
const KAVENEGAR_ACCOUNT = new Set([401, 402, 403, 404, 412, 413, 418, 426, 428, 432]);

export async function sendKavenegar(config: SmsConfig, phones: string[], text: string): Promise<SmsResult> {
  const form = new URLSearchParams({ receptor: phones.join(","), message: text, ...(config.sender ? { sender: config.sender } : {}) });
  const { body } = await call(`https://api.kavenegar.com/v1/${encodeURIComponent(config.apiKey)}/sms/send.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = body as { return?: { status?: number; message?: string }; entries?: { messageid?: number; receptor?: string }[] };
  const status = data.return?.status;
  if (status !== 200) {
    throw new SmsRefusedError(`Kavenegar ${status ?? "?"}: ${data.return?.message ?? "refused"}`, KAVENEGAR_ACCOUNT.has(status ?? 0));
  }
  const byPhone = new Map((data.entries ?? []).map((e) => [e.receptor ?? "", e.messageid != null ? String(e.messageid) : null]));
  return { ids: phones.map((p) => byPhone.get(p) ?? null) };
}

export async function sendSmsIr(config: SmsConfig, phones: string[], text: string): Promise<SmsResult> {
  const { status: http, body } = await call("https://api.sms.ir/v1/send/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": config.apiKey },
    body: JSON.stringify({ lineNumber: Number(config.sender) || config.sender, messageText: text, mobiles: phones, sendDateTime: null }),
  });
  const data = body as { status?: number; message?: string; data?: { messageIds?: (number | string)[] } };
  if (data.status !== 1) {
    // Errors about the key, credit or line block everything; sms.ir answers them with 4xx.
    throw new SmsRefusedError(`sms.ir ${data.status ?? http}: ${data.message ?? "refused"}`, http === 401 || http === 403 || http === 400);
  }
  const ids = data.data?.messageIds ?? [];
  return { ids: phones.map((_, i) => (ids[i] != null ? String(ids[i]) : null)) };
}

export async function sendMelipayamak(config: SmsConfig, phones: string[], text: string): Promise<SmsResult> {
  const { status: http, body } = await call(`https://console.melipayamak.com/api/send/advanced/${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.sender, to: phones, text, udh: "" }),
  });
  const data = body as { recIds?: (number | string)[]; status?: string };
  // An empty status means accepted; anything else is the panel's reason.
  if (data.status || !Array.isArray(data.recIds)) {
    throw new SmsRefusedError(`Melipayamak: ${data.status || `HTTP ${http}`}`, true);
  }
  return { ids: phones.map((_, i) => (data.recIds?.[i] != null ? String(data.recIds[i]) : null)) };
}

/** Sends one batch; the TEST provider sends nothing and reports success. */
export async function sendSms(config: SmsConfig, phones: string[], text: string): Promise<SmsResult> {
  switch (config.provider) {
    case "KAVENEGAR":
      return sendKavenegar(config, phones, text);
    case "SMSIR":
      return sendSmsIr(config, phones, text);
    case "MELIPAYAMAK":
      return sendMelipayamak(config, phones, text);
    case "TEST":
      return { ids: phones.map((_, i) => `test-${Date.now()}-${i}`) };
  }
}

/**
 * Characters and parts: a message with any Persian letter is UCS-2, 70
 * characters in one part and 67 per part once split; Latin-only is 160/153.
 */
export function smsParts(text: string): { chars: number; parts: number; unicode: boolean } {
  const chars = [...text].length;
  const unicode = /[^\x00-\x7F]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { chars, unicode, parts: chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi) };
}
