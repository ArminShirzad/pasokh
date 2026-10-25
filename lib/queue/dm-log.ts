import { prisma } from '@/lib/db/client';
import type { Prisma } from '@/app/generated/prisma/client';

type Upsert = Pick<Prisma.DmLogUpsertArgs, 'where' | 'create' | 'update'>;

/** Compound-key upserts can race when Prisma performs the initial read and
 * create separately. Another webhook/poll job may create the same log first.
 * Apply only the requested update to that row; delivery claims remain intact.
 */
export async function upsertDmLog(args: Upsert) {
  try {
    return await prisma.dmLog.upsert(args);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') throw error;
    // Verify the requested row exists. An unrelated uniqueness failure (for
    // example an explicitly supplied primary key) must remain an error.
    const existing = await prisma.dmLog.findUnique({ where: args.where });
    if (!existing) throw error;
    if (Object.keys(args.update).length === 0) return existing;
    return prisma.dmLog.update({ where: args.where, data: args.update });
  }
}
