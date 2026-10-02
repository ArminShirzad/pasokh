import { matchExact } from "@/lib/utils/keyword-matcher";

export type QuestionKind = "text" | "phone" | "email" | "number" | "choice";
export type ContactField = "phone" | "email" | "name";

export type FormQuestion = {
  id: string;
  text: string;
  kind: QuestionKind;
  choices?: string[];
  saveTo?: ContactField;
};

/** Persian and Arabic-Indic digits to ASCII: people type «۰۹۱۲…» as often as "0912…". */
export function toAsciiDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * An Iranian mobile number in the 09xxxxxxxxx form, from the ways people
 * write it (+98, 0098, 98, with or without the 0, spaces and dashes), or an
 * international number kept as +digits. null if it is not a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const compact = toAsciiDigits(raw).replace(/[\s\-().]/g, "");
  const iran = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(compact);
  if (iran) return `0${iran[1]}`;
  const intl = /^(?:\+|00)([1-9]\d{7,14})$/.exec(compact);
  return intl ? `+${intl[1]}` : null;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

export function normalizeNumber(raw: string): string | null {
  const n = toAsciiDigits(raw).replace(/[,٬،\s]/g, "").replace("٫", ".");
  return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
}

/** The choice they picked: by its text (any keyboard or case) or by its number (1, ۱). */
export function pickChoice(raw: string, choices: readonly string[]): string | null {
  const byNumber = Number(toAsciiDigits(raw.trim()));
  if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= choices.length) return choices[byNumber - 1];
  return matchExact(raw, [...choices]).matchedKeyword;
}

/** The stored value for an answer, or null when it does not fit the question. */
export function parseAnswer(question: FormQuestion, raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  switch (question.kind) {
    case "phone":
      return normalizePhone(text);
    case "email":
      return normalizeEmail(text);
    case "number":
      return normalizeNumber(text);
    case "choice":
      return pickChoice(text, question.choices ?? []);
    default:
      return text.slice(0, 1000);
  }
}

export function isCancel(raw: string, cancelWord: string): boolean {
  return Boolean(cancelWord.trim()) && matchExact(raw, [cancelWord]).matched;
}
