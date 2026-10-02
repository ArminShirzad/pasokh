import { describe, expect, it } from "vitest";
import { isInMessagingWindow } from "../lib/contacts/touch";

describe("Instagram's 24-hour messaging window", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("is open for 24 hours after their last message and closed after", () => {
    expect(isInMessagingWindow(new Date("2026-10-01T12:00:01Z"), now)).toBe(true);
    expect(isInMessagingWindow(new Date("2026-10-01T12:00:00Z"), now)).toBe(false);
  });
  it("is closed for someone who has only commented, never messaged", () => {
    expect(isInMessagingWindow(null, now)).toBe(false);
  });
});
