import {beforeEach,describe,expect,it,vi} from 'vitest';
const lookup=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/db/client',()=>({prisma:{mediaAsset:{findUnique:lookup}}}));
vi.mock('@/lib/env',()=>({getBaseUrl:()=> 'https://new.example'}));
import {resolveUploadedMedia,resolveUploadedUrl} from '@/lib/media/resolve-url';
const path='/media/'+ 'a'.repeat(48)+'.jpg';
beforeEach(()=>{lookup.mockReset().mockResolvedValue({extension:'jpg'});});
describe('uploaded media survives a hostname migration',()=>{
 it('rebases an old upload for the provider to fetch',async()=>{
  expect(await resolveUploadedMedia({type:'media',mediaType:'image',url:'https://retired.example'+path})).toEqual({type:'media',mediaType:'image',url:'https://new.example'+path});
 });
 it('rebases card images without changing buttons',async()=>{
  const buttons=[{type:'url' as const,title:'Visit',url:'https://retired.example/offer'}];
  expect(await resolveUploadedMedia({type:'cards',cards:[{title:'Card',imageUrl:'https://retired.example'+path,buttons}]})).toEqual({type:'cards',cards:[{title:'Card',imageUrl:'https://new.example'+path,buttons}]});
 });
 it('leaves external, unknown and mismatched uploads alone',async()=>{
  expect(await resolveUploadedUrl('https://cdn.example/photo.jpg')).toBe('https://cdn.example/photo.jpg');
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockResolvedValue(null);
  expect(await resolveUploadedUrl('https://external.example'+path)).toBe('https://external.example'+path);
  lookup.mockResolvedValue({extension:'png'});
  expect(await resolveUploadedUrl('https://external.example'+path)).toBe('https://external.example'+path);
 });
 it('does not query the database for a current upload',async()=>{
  expect(await resolveUploadedUrl('https://new.example'+path)).toBe('https://new.example'+path);
  expect(lookup).not.toHaveBeenCalled();
 });
});
