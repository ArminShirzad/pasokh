import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { isCancel, normalizeEmail, normalizeNumber, normalizePhone, parseAnswer, pickChoice } from "../lib/forms/answers";
import { formProblems, toCsv } from "../lib/forms/api";

describe("reading form answers", () => {
  it("stores every way an Iranian mobile is written as one 09… number, so search and SMS see one format", () => {
    for (const raw of ["09123456789", "۰۹۱۲۳۴۵۶۷۸۹", "٠٩١٢٣٤٥٦٧٨٩", "+989123456789", "00989123456789", "989123456789", "9123456789", "0912 345 6789", "0912-345-6789"]) {
      expect(normalizePhone(raw), raw).toBe("09123456789");
    }
  });

  it("keeps a foreign number in international form and refuses things that are not numbers", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    for (const raw of ["سلام", "0912345", "021-12345678", "12345678901234567"]) expect(normalizePhone(raw), raw).toBeNull();
  });

  it("reads Persian digits and separators in numbers", () => {
    expect(normalizeNumber("۱۲٬۵۰۰")).toBe("12500");
    expect(normalizeNumber("۳٫۵")).toBe("3.5");
    expect(normalizeNumber("دوازده")).toBeNull();
  });

  it("accepts an email in any case and refuses one without a domain", () => {
    expect(normalizeEmail(" Ali@Example.COM ")).toBe("ali@example.com");
    expect(normalizeEmail("ali@example")).toBeNull();
  });

  it("takes a choice by its number or by its text typed on an Arabic keyboard", () => {
    const choices = ["تهران", "کرج", "شیراز"];
    expect(pickChoice("۲", choices)).toBe("کرج");
    expect(pickChoice("كرج", choices)).toBe("کرج");
    expect(pickChoice("اصفهان", choices)).toBeNull();
    expect(pickChoice("4", choices)).toBeNull();
  });

  it("does not take an empty message as an answer", () => {
    expect(parseAnswer({ id: "a", text: "?", kind: "text" }, "   ")).toBeNull();
  });

  it("cancels only on the cancel word itself, not on a sentence containing it", () => {
    expect(isCancel("لغو", "لغو")).toBe(true);
    expect(isCancel("لغو!", "لغو")).toBe(true);
    expect(isCancel("لغو نکن، ادامه بده", "لغو")).toBe(false);
  });
});

describe("saving a form", () => {
  const base = { name: "f", instagramAccountId: "a", isActive: true, cancelWord: "لغو", completionMessage: "ok", cancelMessage: "bye" };

  it("refuses options longer than Instagram's 20-character quick replies, and a choice with one option", () => {
    const problems = formProblems({ ...base, questions: [{ id: "q", text: "?", kind: "choice", choices: ["یک گزینهٔ خیلی خیلی طولانی"] }] });
    expect(problems.map((p) => p.message)).toEqual(["A choice question needs at least 2 options.", "Options can be at most 20 characters, as Instagram's quick replies."]);
  });

  it("refuses saving a free-text answer as the contact's phone, which would fill contacts with junk", () => {
    expect(formProblems({ ...base, questions: [{ id: "q", text: "?", kind: "text", saveTo: "phone" }] })[0].message).toMatch(/Only a phone question/);
  });
});

describe("CSV for Excel", () => {
  it("starts with a byte-order mark, without which Excel shows Persian as «Ø§»", () => {
    expect(toCsv(["نام"], [["علی"]]).startsWith("﻿نام\r\nعلی")).toBe(true);
  });

  it("quotes commas and quotes, and neutralises cells Excel would run as formulas", () => {
    expect(toCsv(["a"], [['x, "y"'], ["=HYPERLINK(\"http://evil\")"], ["+98912"]])).toBe('﻿a\r\n"x, ""y"""\r\n"\'=HYPERLINK(""http://evil"")"\r\n\'+98912\r\n');
  });
});
