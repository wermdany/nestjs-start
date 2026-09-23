import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { ErrorCode } from '@/contract';
import type { ErrorBody, ErrorDetail } from '@/contract';

/**
 * 认证的**运行时契约测试**：登录 → 拿 token → 访问受保护路由。
 *
 * 这一组属于「认证自己的模块」（`src/auth/__tests__/`），不进任何别的模块的测试文件。
 *
 * 它负责的是**只有真应用才能验证的东西**：
 *
 * - 全局守卫真的挂上了（`AuthModule` 的 `APP_GUARD`）而不是只在单测里成立；
 * - 状态码与失败信封（键集、`code`、`traceId`、`WWW-Authenticate`）；
 * - 全局管道在登录 DTO 上真的生效（400 的字段级明细）；
 * - `@Public()` 白名单真的让既有路由保持公开。
 *
 * 判定逻辑的细枝末节（验签矩阵、载荷形状、凭证比较）在 `src/auth/__tests__/*.spec.ts`，
 * 这里只覆盖"装配起来之后还对不对"。
 */

const BASE = '/auth';
const LOGIN = `${BASE}/login`;
const PROFILE = `${BASE}/profile`;

/** 内存用户表里的演示账号（`UsersService`）。 */
const ACCOUNT = { username: 'neo', password: 'matrix' };

/** 认证失败的信封键集：**没有** `errors`（那种粒度只属于校验失败）。 */
const AUTH_ERROR_KEYS = ['code', 'error', 'message', 'success', 'traceId'];
/** 成功信封的键集。 */
const OK_KEYS = ['data', 'success'];

interface LoginBody {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}

interface ProfileBody {
  sub: string;
  username: string;
}

/** supertest 的 `res.body` 是 `any`，统一收窄一次。 */
function bodyAs<T>(response: { body: unknown }): T {
  return response.body as T;
}

/** 成功响应要**先脱一层信封**：字段在 `body.data` 里，不在 `body` 上。 */
function dataAs<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function keysOf(body: unknown): string[] {
  return Object.keys(body as Record<string, unknown>).sort();
}

/**
 * 去掉 `traceId` 之后的失败信封。
 *
 * `traceId` 是**每个请求各不相同**的排障标识（不是可用来区分用户的信息），
 * 所以比较"两次失败是不是同形"时把它排除掉。
 */
function withoutTraceId(body: ErrorBody): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...body };

  delete copy.traceId;

  return copy;
}

function bearer(token: string): [string, string] {
  return ['authorization', `Bearer ${token}`];
}

describe('auth（登录 + JWT 校验的运行时契约）', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // 应用里那个 `JwtService`（密钥来自配置的开发默认值）：
    // 用它来**独立验签**，证明"服务端签出来的 token 真的能被同一个密钥验回原样"。
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** 走一次真实登录，返回 accessToken。 */
  async function login(credentials = ACCOUNT): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(LOGIN)
      .send(credentials)
      .expect(200);

    return dataAs<LoginBody>(response).accessToken;
  }

  describe('POST /auth/login', () => {
    it('正确凭证 → 200，`data` 是令牌三件套', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .send(ACCOUNT)
        .expect(200);

      expect(keysOf(response.body)).toEqual(OK_KEYS);

      const data = dataAs<LoginBody>(response);

      expect(Object.keys(data).sort()).toEqual([
        'accessToken',
        'expiresIn',
        'tokenType',
      ]);
      expect(data.tokenType).toBe('Bearer');
      expect(data.accessToken.split('.')).toHaveLength(3);
      // 默认有效期 1h（配置 `JWT_EXPIRES_IN`）
      expect(data.expiresIn).toBeGreaterThan(3_500);
      expect(data.expiresIn).toBeLessThanOrEqual(3_600);
    });

    it('token 里**只有身份**：验签解出来的载荷没有角色 / 权限', async () => {
      const token = await login();
      const payload = jwt.verify<Record<string, unknown>>(token);

      expect(payload.sub).toBe('1');
      expect(payload.username).toBe('neo');
      expect(Object.keys(payload).sort()).toEqual([
        'exp',
        'iat',
        'sub',
        'username',
      ]);
    });

    it('用户名去空格 + 大小写不敏感（DTO 的 @Transform 生效）', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ username: '  NEO  ', password: ACCOUNT.password })
        .expect(200);

      expect(
        jwt.verify<{ username: string }>(
          dataAs<LoginBody>(response).accessToken,
        ).username,
      ).toBe('neo');
    });

    it('密码**不做** trim：多一个空格就是凭证不对', async () => {
      await request(app.getHttpServer())
        .post(LOGIN)
        .send({ username: 'neo', password: ` ${ACCOUNT.password} ` })
        .expect(401);
    });

    it('密码错与用户不存在 → 401，且两者响应**逐字相同**（防用户名枚举）', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ username: 'neo', password: 'wrong' })
        .expect(401);
      const unknownUser = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ username: 'nobody', password: 'whatever' })
        .expect(401);

      expect(keysOf(wrongPassword.body)).toEqual(AUTH_ERROR_KEYS);
      // 除 traceId（每个请求都不同）之外，两者**逐字相同**
      expect(withoutTraceId(bodyAs<ErrorBody>(unknownUser))).toEqual(
        withoutTraceId(bodyAs<ErrorBody>(wrongPassword)),
      );
      expect(bodyAs<ErrorBody>(wrongPassword).traceId).toBeDefined();
      expect(bodyAs<ErrorBody>(wrongPassword).code).toBe(
        ErrorCode.UNAUTHENTICATED,
      );
      // 登录失败刻意**不带** `WWW-Authenticate`（那是"访问受保护资源"的语义）
      expect(wrongPassword.headers['www-authenticate']).toBeUndefined();
    });

    it('缺字段 / 类型不对 → 400 VALIDATION_FAILED（全局管道生效，明细带 location）', async () => {
      const response = await request(app.getHttpServer())
        .post(LOGIN)
        .send({ username: 'neo' })
        .expect(400);

      const body = bodyAs<ErrorBody>(response);

      expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);

      const details: ErrorDetail[] = body.errors ?? [];

      expect(details.map((detail) => detail.field)).toContain('password');
      expect(details.every((detail) => detail.location === 'body')).toBe(true);
    });
  });

  describe('GET /auth/profile（受保护）', () => {
    it('有效 token → 200，回显 token 里的身份', async () => {
      const token = await login();
      const response = await request(app.getHttpServer())
        .get(PROFILE)
        .set(...bearer(token))
        .expect(200);

      expect(keysOf(response.body)).toEqual(OK_KEYS);
      expect(dataAs<ProfileBody>(response)).toEqual({
        sub: '1',
        username: 'neo',
      });
    });

    it('没有 token → 401 invalid_request + WWW-Authenticate + traceId', async () => {
      const response = await request(app.getHttpServer())
        .get(PROFILE)
        .expect(401);

      expect(keysOf(response.body)).toEqual(AUTH_ERROR_KEYS);

      const body = bodyAs<ErrorBody>(response);

      expect(body.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(response.headers['www-authenticate']).toBe(
        'Bearer realm="nestjs-start", error="invalid_request"',
      );
      // traceId 与响应头是同一个值：排障时能直接把两者对上
      expect(response.headers['x-request-id']).toBe(body.traceId);
    });

    it('令牌无效（乱码 / 别的密钥签的）→ 401 invalid_token', async () => {
      const foreign = new JwtService({
        secret: 'a-completely-different-secret',
      });

      for (const token of [
        'not-a-jwt',
        foreign.sign({ sub: '1', username: 'neo' }),
      ]) {
        const response = await request(app.getHttpServer())
          .get(PROFILE)
          .set(...bearer(token))
          .expect(401);

        expect(response.headers['www-authenticate']).toContain(
          'error="invalid_token"',
        );
      }
    });

    it('令牌已过期 → 401 invalid_token', async () => {
      const expired = jwt.sign(
        { sub: '1', username: 'neo' },
        { expiresIn: '-1s' },
      );
      const response = await request(app.getHttpServer())
        .get(PROFILE)
        .set(...bearer(expired))
        .expect(401);

      expect(response.headers['www-authenticate']).toContain(
        'error="invalid_token"',
      );
    });
  });

  describe('@Public() 白名单：既有路由不受影响', () => {
    it('validation-demo 仍然免凭证可访问（它的 e2e 也依赖这一点）', async () => {
      await request(app.getHttpServer())
        .get('/validation-demo/users/1')
        .expect(200);
    });
  });
});
