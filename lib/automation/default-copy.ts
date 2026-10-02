import { defaultLocale } from "@/lib/i18n";

// Fallbacks for campaign copy the owner left empty. They go to the owner's
// followers, so they follow the instance language, not the viewer's.

export function defaultFollowPrompt(): string {
  return defaultLocale() === "fa"
    ? "قبل از ارسال لینک، لطفاً پیج رو فالو کن 🙏"
    : "Please follow the page first, then I'll send your link 🙏";
}

export function defaultFollowButtonLabel(): string {
  return defaultLocale() === "fa" ? "فالو کردم ✅" : "I'm following ✅";
}
