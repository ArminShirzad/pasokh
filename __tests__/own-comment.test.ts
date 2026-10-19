import {describe,it,expect} from 'vitest';
import {isOwnComment} from '@/lib/instagram/own-comment';
describe('owner comment identity',()=>{
  const account={instagramId:'scoped-id',username:'anime_pooya'};
  it('blocks a native-ID echo with the owner handle',()=>{
    expect(isOwnComment(account,{id:'native-id',username:'@ANIME_POOYA'})).toBe(true);
  });
  it('blocks a same-ID echo when no handle is supplied',()=>{
    expect(isOwnComment(account,{id:'scoped-id'})).toBe(true);
  });
  it('allows other people, similar handles and missing handles',()=>{
    for(const username of ['pooya_alii','anime_pooya_fan',undefined,''])
      expect(isOwnComment(account,{id:'fan-id',username})).toBe(false);
    expect(isOwnComment({instagramId:'owner'},{id:'fan'})).toBe(false);
  });
});
