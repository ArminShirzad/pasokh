import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { toAsciiDigits } from "@/lib/forms/answers";

export type ContactFilter = { workspaceId: string; accountId?: string | null; q?: string | null; tag?: string | null; hasPhone?: boolean };

export function contactWhere({ workspaceId, accountId, q, tag, hasPhone }: ContactFilter): Prisma.ContactWhereInput {
  const query = q?.trim();
  return {
    instagramAccount: { workspaceId },
    ...(accountId ? { instagramAccountId: accountId } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(hasPhone ? { phone: { not: null } } : {}),
    ...(query
      ? {
          OR: [
            { username: { contains: query.replace(/^@/, ""), mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            // Phones are stored with ASCII digits; people search with either.
            { phone: { contains: toAsciiDigits(query) } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listContacts(filter: ContactFilter, { page = 1, pageSize = 50 }: { page?: number; pageSize?: number } = {}) {
  const where = contactWhere(filter);
  const [total, rows, tagRows] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ lastInboundAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contact.findMany({
      where: contactWhere({ workspaceId: filter.workspaceId, accountId: filter.accountId }),
      select: { tags: true },
      take: 5000,
    }),
  ]);
  const tags = [...new Set(tagRows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "fa"));
  return { total, rows, tags };
}

/** Tags trimmed, without repeats or empties, at most 20 of 40 characters. */
export function cleanTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean).map((t) => t.slice(0, 40)))].slice(0, 20);
}
