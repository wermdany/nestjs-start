import { JwtService } from '@nestjs/jwt';
import {
  AuthService,
  InvalidCredentialsException,
  lifetimeSecondsOf,
  UsersService,
} from '@/auth';
import { NEO_PASSWORD, TEST_SECRET } from './fixtures/test-doubles';

/**
 * 登录：凭证校验 + 签发。
 *
 * 用**真的 `JwtService`**（只换个测试密钥）而不是替身：这样"签发出来的 token 能被
 * 同一个密钥验回原样"是真的被验证了，而不是假设的。
 */
function createService(): {
  auth: AuthService;
  jwt: JwtService;
  users: UsersService;
} {
  const jwt = new JwtService({
    secret: TEST_SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const users = new UsersService();

  return { auth: new AuthService(users, jwt), jwt, users };
}

describe('AuthService.login', () => {
  it('正确凭证 → 签发 token，且 payload 里只有身份', async () => {
    const { auth, jwt } = createService();

    const result = await auth.login({
      username: 'neo',
      password: NEO_PASSWORD,
    });

    expect(result.tokenType).toBe('Bearer');
    expect(typeof result.accessToken).toBe('string');
    expect(result.accessToken.split('.')).toHaveLength(3);

    const payload = jwt.verify<Record<string, unknown>>(result.accessToken);

    expect(payload.sub).toBe('1');
    expect(payload.username).toBe('neo');
    // ⚠️ 关键断言：**没有**角色 / 权限 / scope —— token 里只有身份
    expect(Object.keys(payload).sort()).toEqual([
      'exp',
      'iat',
      'sub',
      'username',
    ]);
  });

  it('expiresIn 来自 token 自己（`exp - iat`），而不是另算一遍配置', async () => {
    const { auth, jwt } = createService();

    const result = await auth.login({
      username: 'neo',
      password: NEO_PASSWORD,
    });
    // `jwt.decode<T = any>` 默认返回 `any`：显式收成 `unknown` 再交给纯函数
    const decoded: unknown = jwt.decode(result.accessToken);

    expect(result.expiresIn).toBe(lifetimeSecondsOf(decoded));
    expect(result.expiresIn).toBeGreaterThan(3500);
    expect(result.expiresIn).toBeLessThanOrEqual(3600);
  });

  it('密码错 → 401 InvalidCredentialsException', async () => {
    const { auth } = createService();

    await expect(
      auth.login({ username: 'neo', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('用户不存在 → **与密码错完全相同的异常**（防用户名枚举）', async () => {
    const { auth } = createService();

    let wrongPassword: unknown;
    let unknownUser: unknown;

    try {
      await auth.login({ username: 'neo', password: 'wrong' });
    } catch (error) {
      wrongPassword = error;
    }

    try {
      await auth.login({ username: 'nobody', password: 'whatever' });
    } catch (error) {
      unknownUser = error;
    }

    expect(unknownUser).toBeInstanceOf(InvalidCredentialsException);
    // 状态码、code、message —— 三项逐字相同，响应里没有任何可区分的痕迹
    expect((unknownUser as InvalidCredentialsException).getStatus()).toBe(
      (wrongPassword as InvalidCredentialsException).getStatus(),
    );
    expect((unknownUser as InvalidCredentialsException).code).toBe(
      (wrongPassword as InvalidCredentialsException).code,
    );
    expect((unknownUser as InvalidCredentialsException).getResponse()).toEqual(
      (wrongPassword as InvalidCredentialsException).getResponse(),
    );
  });

  it('密码里的首尾空格不会被 trim（凭证是秘密，不该被静默改写）', async () => {
    const { auth } = createService();

    await expect(
      auth.login({ username: 'neo', password: ` ${NEO_PASSWORD} ` }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });
});
