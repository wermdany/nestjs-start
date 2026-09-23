import { getJwtPayload, isJwtPayload, lifetimeSecondsOf } from '@/auth';

/**
 * 载荷的形状检查与"读寿命"这两件纯函数。
 *
 * 形状检查之所以要单独测：它是**安全边界**（`verifyAsync` 只保证签名是我们签的，
 * 不保证载荷长得像我以为的样子），而这种检查最容易写漏一个类型分支。
 */
describe('isJwtPayload', () => {
  it('接受最小合法载荷（只有 sub + username）', () => {
    expect(isJwtPayload({ sub: '1', username: 'neo' })).toBe(true);
    expect(isJwtPayload({ sub: '1', username: 'neo', iat: 1, exp: 2 })).toBe(
      true,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'sub'],
    ['数组', ['sub']],
    ['空对象', {}],
    ['sub 缺失', { username: 'neo' }],
    ['username 缺失', { sub: '1' }],
    ['sub 不是字符串', { sub: 1, username: 'neo' }],
    ['sub 是空串', { sub: '', username: 'neo' }],
    ['username 是空串', { sub: '1', username: '' }],
    ['username 不是字符串', { sub: '1', username: 42 }],
  ])('拒绝：%s', (_label, value) => {
    expect(isJwtPayload(value)).toBe(false);
  });
});

describe('getJwtPayload', () => {
  it('从请求对象上取载荷', () => {
    const payload = { sub: '1', username: 'neo' };

    expect(getJwtPayload({ user: payload })).toEqual(payload);
  });

  it('形状不对时返回 undefined（而不是把垃圾透出去）', () => {
    expect(getJwtPayload({ user: { sub: 1 } })).toBeUndefined();
    expect(getJwtPayload({})).toBeUndefined();
    expect(getJwtPayload(null)).toBeUndefined();
    expect(getJwtPayload('user')).toBeUndefined();
  });
});

describe('lifetimeSecondsOf', () => {
  it('`exp - iat` 就是有效期秒数', () => {
    expect(lifetimeSecondsOf({ iat: 1_000, exp: 4_600 })).toBe(3_600);
  });

  it.each([
    ['缺 exp', { iat: 1_000 }],
    ['缺 iat', { exp: 4_600 }],
    ['不是数字', { iat: '1000', exp: '4600' }],
    ['已过期 / 非正数', { iat: 4_600, exp: 1_000 }],
    ['null', null],
    ['字符串', 'payload'],
  ])('读不出来时返回 undefined：%s', (_label, value) => {
    expect(lifetimeSecondsOf(value)).toBeUndefined();
  });
});
