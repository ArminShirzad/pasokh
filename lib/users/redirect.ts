/** Only same-site paths: an absolute or protocol-relative URL would be an open redirect. */
export function safeCallbackUrl(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
