import { getRedisConnection } from "@/lib/queue/client";

// A public instance is a password prompt on the open internet. Failed attempts
// are counted per email and per client address; either one tripping locks that
// key for the rest of the window. Success clears the email's counter.
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

function keys(email: string, ip: string | null) {
  return {
    email: `login_fail:email:${email.trim().toLowerCase()}`,
    ip: ip ? `login_fail:ip:${ip}` : null,
  };
}

export async function isLoginThrottled(email: string, ip: string | null): Promise<boolean> {
  const redis = getRedisConnection();
  const k = keys(email, ip);
  const [byEmail, byIp] = await Promise.all([
    redis.get(k.email),
    k.ip ? redis.get(k.ip) : Promise.resolve(null),
  ]);
  return Number(byEmail ?? 0) >= MAX_FAILURES_PER_EMAIL || Number(byIp ?? 0) >= MAX_FAILURES_PER_IP;
}

export async function recordLoginFailure(email: string, ip: string | null): Promise<void> {
  const redis = getRedisConnection();
  const k = keys(email, ip);
  const multi = redis.multi().incr(k.email).expire(k.email, WINDOW_SECONDS, "NX");
  if (k.ip) multi.incr(k.ip).expire(k.ip, WINDOW_SECONDS, "NX");
  await multi.exec();
}

export async function clearLoginFailures(email: string): Promise<void> {
  await getRedisConnection().del(keys(email, null).email);
}
