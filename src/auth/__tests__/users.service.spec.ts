import { UsersService } from '@/auth';
import type { DemoUser } from '@/auth';

/**
 * 内存用户表的行为。
 *
 * 这一层刻意很薄，用例也就少 —— 但"密码比较是常量时间的"这条属性值得钉住：
 * 它是这个类存在的主要理由（另一部分是"表里没有角色"这个事实本身）。
 */
describe('UsersService', () => {
  const users = new UsersService();

  /**
   * 取一个**一定存在**的演示用户。
   *
   * 用控制流收窄（`if (!user) throw`）而不是 `as DemoUser`：
   * 后者在 `strictNullChecks` 关掉时会被 lint 判成"多余的断言"，
   * 而开了 `strict` 又必须写 —— 两边都要满足，就只能真的检查一次。
   */
  function expectUser(username: string): DemoUser {
    const user = users.findByUsername(username);

    if (!user) {
      throw new Error(`演示用户 ${username} 不在内存表里`);
    }

    return user;
  }

  it('按用户名找到用户（用户名已由 DTO 归一化成小写）', () => {
    expect(users.findByUsername('neo')).toEqual({
      id: '1',
      username: 'neo',
      password: 'matrix',
    });
    expect(users.findByUsername('trinity')?.id).toBe('2');
  });

  it('找不到就返回 undefined（不抛错：由 AuthService 统一决定怎么回应）', () => {
    expect(users.findByUsername('nobody')).toBeUndefined();
    // 大小写敏感是**刻意的**：归一化是 DTO 的职责，"存进来的值 = 比出来的值"
    expect(users.findByUsername('NEO')).toBeUndefined();
  });

  it('用户表里**没有**角色 / 权限字段（认证只回答"你是谁"）', () => {
    const user = expectUser('neo');

    expect(Object.keys(user).sort()).toEqual(['id', 'password', 'username']);
  });

  it('密码校验：正确通过，错误不通过，且不做 trim', () => {
    const user = expectUser('neo');

    expect(users.verifyPassword(user, 'matrix')).toBe(true);
    expect(users.verifyPassword(user, 'wrong')).toBe(false);
    // 首尾空格是密码的一部分：` matrix ` 不等于 `matrix`
    expect(users.verifyPassword(user, ' matrix ')).toBe(false);
    expect(users.verifyPassword(user, '')).toBe(false);
  });
});
