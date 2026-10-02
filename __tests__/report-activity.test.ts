import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { countByDay, dayKey, lastDays } from "../lib/reports/activity";

describe("report days", () => {
  it("counts a message sent at 00:30 in Tehran on that Tehran day, not the previous UTC day", () => {
    const at = new Date("2026-10-02T21:00:00Z"); // 00:30 on 3 Oct in Tehran (UTC+3:30)
    expect(dayKey(at, "Asia/Tehran")).toBe("2026-10-03");
    expect(dayKey(at, "UTC")).toBe("2026-10-02");
  });

  it("lists the last 30 days oldest first, ending today", () => {
    const days = lastDays(30, "Asia/Tehran", new Date("2026-10-03T08:00:00Z"));
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-04");
    expect(days.at(-1)).toBe("2026-10-03");
  });

  it("counts per day and ignores instants outside the window and missing ones", () => {
    const days = ["2026-10-02", "2026-10-03"];
    const dates = [new Date("2026-10-02T10:00:00Z"), new Date("2026-10-02T21:00:00Z"), new Date("2026-09-01T10:00:00Z"), null];
    expect(countByDay(dates, days, "Asia/Tehran")).toEqual([1, 1]);
  });
});
