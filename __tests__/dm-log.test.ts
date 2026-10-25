import {beforeEach,describe,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({upsert:vi.fn(),findUnique:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/db/client',()=>({prisma:{dmLog:db}}));
import {upsertDmLog} from '@/lib/queue/dm-log';
const create={workspaceId:'workspace',automationId:'campaign',instagramAccountId:'account',commenterId:'fan',commentText:'LINK',commentId:'comment'};
const where={automationId_commentId:{automationId:'campaign',commentId:'comment'}};
const winner={...create,status:'SENT',dmDeliveryUnconfirmed:true,attempts:1};
beforeEach(()=>vi.resetAllMocks());
describe('duplicate comment log creation',()=>{
 it('preserves the winning delivery claim when webhook and polling create the same row',async()=>{
  db.upsert.mockRejectedValue({code:'P2002'});db.findUnique.mockResolvedValue(winner);
  expect(await upsertDmLog({where,create,update:{}})).toBe(winner);
  expect(db.update).not.toHaveBeenCalled();
 });
 it('applies only the requested update after a concurrent insert',async()=>{
  db.upsert.mockRejectedValue({code:'P2002'});db.findUnique.mockResolvedValue(winner);db.update.mockResolvedValue(winner);
  await upsertDmLog({where,create,update:{publicReplyError:'Rejected'}});
  expect(db.update).toHaveBeenCalledWith({where,data:{publicReplyError:'Rejected'}});
 });
 it('propagates uniqueness errors when the requested row does not exist',async()=>{
  const error={code:'P2002'};db.upsert.mockRejectedValue(error);db.findUnique.mockResolvedValue(null);
  await expect(upsertDmLog({where,create,update:{}})).rejects.toBe(error);
  expect(db.update).not.toHaveBeenCalled();
 });
 it('does not retry database outages or validation errors',async()=>{
  const error={code:'P1001'};db.upsert.mockRejectedValue(error);
  await expect(upsertDmLog({where,create,update:{}})).rejects.toBe(error);
  expect(db.findUnique).not.toHaveBeenCalled();
 });
});
