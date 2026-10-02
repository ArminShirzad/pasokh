"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import CommandEditor, { type CommandDraft } from "@/components/command-editor";
import { useI18n } from "@/lib/i18n/provider";

type Account = { id: string; username: string };

export default function CommandEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<CommandDraft | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stats = await (await fetch("/api/dashboard/stats")).json();
      const list: Account[] = stats.data?.instagramAccounts ?? [];
      if (cancelled) return;
      setAccounts(list);
      if (id === "new") {
        if (!list.length) return;
        setDraft({
          name: "",
          instagramAccountId: list[0].id,
          isActive: true,
          matchMode: "EXACT",
          keywords: [],
          storyScope: "ALL",
          storyIds: [],
          onStoryMention: false,
          likeTrigger: false,
          responses: [{ type: "text", text: "" }],
        });
        return;
      }
      const response = await fetch(`/api/commands/${encodeURIComponent(id)}`);
      if (!response.ok) {
        if (!cancelled) setMissing(true);
        return;
      }
      const { command } = await response.json();
      if (!cancelled) setDraft(command);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/commands" className="text-sm text-muted hover:text-foreground"><span className="inline-block rtl:rotate-180">←</span> {t("Smart reply")}</Link>
        <h1 className="mt-2 text-xl font-semibold">{id === "new" ? t("New command") : t("Edit command")}</h1>
      </div>
      {missing ? (
        <p className="text-sm text-error">{t("Command not found.")}</p>
      ) : accounts && accounts.length === 0 ? (
        <p className="text-sm text-muted">
          {t("Connect an Instagram account first, or open the test lab to get a test account.")}{" "}
          <Link href="/simulator" className="text-accent underline">{t("Test lab")}</Link>
        </p>
      ) : !draft || !accounts ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : (
        <CommandEditor initial={draft} accounts={accounts} />
      )}
    </div>
  );
}
