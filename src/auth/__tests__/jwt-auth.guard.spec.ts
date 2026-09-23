import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ErrorCode,
  getRequestContext,
  runWithRequestContext,
} from '@/contract';
import {
  extractBearerToken,
  JwtAuthGuard,
  UnauthenticatedException,
} from '@/auth';
import type { JwtPayload } from '@/auth';
import {
  fakeExecutionContext,
  makeRequest,
  ProtectedProbeController,
  PublicProbeController,
  TEST_SECRET,
} from './fixtures/test-doubles';

/**
 * `JwtAuthGuard` 的判定矩阵。
 *
 * 用**真的 `JwtService`**（只换测试密钥）而不是假对象：这样"无效 token"不是靠
 * stub 假装出来的，而是真的验签失败 —— 这条路径正是守卫存在的理由，值得用真货测。
 */

const PAYLOAD: JwtPayload = { sub: '1', username: 'neo' };

function createGuard(): { guard: JwtAuthGuard; jwt: JwtService } {
  const jwt = new JwtService({
    secret: TEST_SECRET,
    signOptions: { expiresIn: '1h' },
  });

  return { guard: new JwtAuthGuard(new Reflector(), jwt), jwt };
}

/** 受保护路由的上下文（打 `ProtectedProbeController` 上那条路由）。 */
function protectedContext(authorization?: string) {
  return fakeExecutionContext(
    makeRequest(authorization),
    ProtectedProbeController.prototype.protectedRoute,
    ProtectedProbeController,
  );
}

describe('extractBearerToken（RFC 6750 / 7235）', () => {
  it('取出 token；scheme 大小写不敏感、允许多个空格', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('BEARER   abc')).toBe('abc');
  });

  it('不是 Bearer / 空 / 缺 token → undefined', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('Basic abc')).toBeUndefined();
    expect(extractBearerToken('Bearer')).toBeUndefined();
    expect(extractBearerToken('Bearer   ')).toBeUndefined();
    // 带空格的凭证本身不合法：宁可当作"没带"，也不要把半个 token 送进验签
    expect(extractBearerToken('Bearer a b')).toBeUndefined();
  });

  it('重复的 Authorization 头（Express 给数组）取第一个', () => {
    expect(extractBearerToken(['Bearer first', 'Bearer second'])).toBe('first');
  });
});

describe('JwtAuthGuard · 认证', () => {
  it('@Public() 路由直接放行，**根本不验签**', async () => {
    const { guard, jwt } = createGuard();
    const verify = jest.spyOn(jwt, 'verifyAsync');
    const context = fakeExecutionContext(
      makeRequest(),
      PublicProbeController.prototype.publicRoute,
      PublicProbeController,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('没有凭证 → 401 invalid_request（且不验签）', async () => {
    const { guard, jwt } = createGuard();
    const verify = jest.spyOn(jwt, 'verifyAsync');

    await expect(guard.canActivate(protectedContext())).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      headers: {
        'WWW-Authenticate':
          'Bearer realm="nestjs-start", error="invalid_request"',
      },
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('凭证格式不对（非 Bearer）→ 同样是 invalid_request', async () => {
    const { guard } = createGuard();

    let caught: unknown;

    try {
      await guard.canActivate(protectedContext('Basic YWRtaW46YWRtaW4='));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnauthenticatedException);
    expect(
      (caught as UnauthenticatedException).headers?.['WWW-Authenticate'],
    ).toContain('invalid_request');
  });

  it('令牌无效（签名不对 / 乱码）→ 401 invalid_token', async () => {
    const { guard, jwt } = createGuard();
    const foreign = new JwtService({ secret: 'another-secret-entirely' });
    const foreignToken = foreign.sign({ sub: '1', username: 'neo' });

    for (const token of ['not-a-jwt', foreignToken, jwt.sign({ a: 1 })]) {
      await expect(
        guard.canActivate(protectedContext(`Bearer ${token}`)),
      ).rejects.toMatchObject({
        code: ErrorCode.UNAUTHENTICATED,
        headers: {
          'WWW-Authenticate':
            'Bearer realm="nestjs-start", error="invalid_token"',
        },
      });
    }
  });

  it('令牌已过期 → 401 invalid_token', async () => {
    const { guard, jwt } = createGuard();
    const expired = jwt.sign(PAYLOAD, { expiresIn: '-1s' });

    await expect(
      guard.canActivate(protectedContext(`Bearer ${expired}`)),
    ).rejects.toMatchObject({
      headers: {
        'WWW-Authenticate':
          'Bearer realm="nestjs-start", error="invalid_token"',
      },
    });
  });

  it('token 合法但载荷形状不对 → 401 invalid_token（形状检查在挂 req.user 之前）', async () => {
    const { guard, jwt } = createGuard();
    const weird = jwt.sign({ hello: 'world' });

    await expect(
      guard.canActivate(protectedContext(`Bearer ${weird}`)),
    ).rejects.toMatchObject({
      headers: {
        'WWW-Authenticate':
          'Bearer realm="nestjs-start", error="invalid_token"',
      },
    });
  });

  it('认证成功 → 放行 + 挂 req.user + 写请求级 userId', async () => {
    const { guard, jwt } = createGuard();
    const token = jwt.sign(PAYLOAD);
    const context = protectedContext(`Bearer ${token}`);
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();

    await runWithRequestContext({ requestId: 'r-1' }, async () => {
      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(request.user).toMatchObject({ sub: '1', username: 'neo' });
      // 日志 / 审计靠这条：requestId 与 userId 在同一个请求上下文里
      expect(getRequestContext()).toMatchObject({
        requestId: 'r-1',
        userId: '1',
      });
    });
  });
});
