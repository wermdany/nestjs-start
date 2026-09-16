import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  Redirect,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { ApiContractModule, NoEnvelope } from '@/contract';
import type { ErrorBody, PaginationMeta, ResponseBody } from '@/contract';
import { CreateUserDto } from '../dto/create-user.dto';

/**
 * 整个仓库只剩这一个测试文件，它只干一件事：**把响应契约钉死**。
 *
 * 契约（详见 `src/contract/response/response-contract.ts` 与 docs/validation.md §9）：
 *
 * - 成功：`{ success: true, data, meta? }` —— 没有 `message`，也没有数字状态码
 * - 失败：`{ success: false, error, message, errors? }`
 * - 数字状态码只活在 HTTP 状态行里（所以下面的 `.expect(201/400/404/409/302)` 就是它的断言位置）
 *
 * 断言用 `Object.keys(body).sort()` **精确**比对键集，而不是 `toMatchObject` ——
 * 契约的意义就是"字段一个不多一个不少"，多出一个字段也应该让测试红。
 */

/** 前端只需要这一个类型；`data` 的形状按接口自己收窄。 */
type Body = ResponseBody<unknown>;

interface UserBody {
  id: number;
  name: string;
  email: string;
  age?: number;
  role: string;
  tags: string[];
  address?: { street: string; city: string; zip?: string };
}

interface ReceivedBody {
  received: Record<string, unknown>;
}

interface IdsBody {
  ids: number[];
}

/** supertest 的 `res.body` 是 `any`，统一在这里收窄一次，避免满屏 unsafe-member-access。 */
function bodyAs<T>(response: { body: unknown }): T {
  return response.body as T;
}

/** 键集断言：响应体只允许这几个键。 */
function keysOf(body: unknown): string[] {
  return Object.keys(body as Record<string, unknown>).sort();
}

function detailsOf(body: unknown): { field: string; message: string }[] {
  return (
    (body as { errors?: { field: string; message: string }[] }).errors ?? []
  );
}

function fieldsOf(body: unknown): string[] {
  return detailsOf(body).map((detail) => detail.field);
}

function textsOf(body: unknown): string {
  return detailsOf(body)
    .map((detail) => `${detail.field} ${detail.message}`)
    .join(' | ');
}

describe('响应契约 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function http() {
    return request(app.getHttpServer());
  }

  describe('成功：{ success: true, data, meta? }', () => {
    it('① 创建资源 → 201，键集恰好是 data/success', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({
          name: 'Zion',
          email: 'zion@example.com',
          role: 'viewer',
          tags: ['ops'],
          address: { street: 'Main 1', city: 'Zion' },
        })
        .expect(201);
      const body = bodyAs<Body & { data: UserBody }>(res);

      expect(keysOf(body)).toEqual(['data', 'success']);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Zion');
      // 201 只在 HTTP 状态行里断言（body 里没有数字状态码）
      expect(typeof body.data.id).toBe('number');
    });

    it('② 查询单个 → 200，data 是对象（不是数组）', async () => {
      const res = await http().get('/validation-demo/users/1').expect(200);
      const body = bodyAs<Body & { data: UserBody }>(res);

      expect(keysOf(body)).toEqual(['data', 'success']);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({ id: 1, name: 'Neo' });
    });

    it('③ 分页 → data 是数组，meta 只有三个字段且提到顶层', async () => {
      const res = await http()
        .get('/validation-demo/users?limit=999&sortBy=name&page=1')
        .expect(200);
      const body = bodyAs<Body & { data: UserBody[] }>(res);

      expect(keysOf(body)).toEqual(['data', 'meta', 'success']);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);

      // meta 的键集也精确锁定：只有这三个数（没有 totalPages —— 它是可推导的）
      const meta = bodyAs<Body & { meta: PaginationMeta }>(res).meta;

      expect(Object.keys(meta).sort()).toEqual([
        'currentPage',
        'itemsPerPage',
        'totalItems',
      ]);
      // AIP-158 的 coerce down：超上限的 limit 被截断，而不是 400
      expect(meta).toMatchObject({ currentPage: 1, itemsPerPage: 50 });
      // `totalItems` 是"过滤后的总数"，不是这一页的长度 —— 它必须 ≥ data.length。
      // （不写死具体数字：`limit=999` 会截断成 50，本文件里创建过的用户都还在）
      expect(meta.totalItems).toBeGreaterThanOrEqual(body.data.length);
      expect(meta.totalItems).toBeGreaterThanOrEqual(2);

      const names = body.data.map((user) => user.name);
      expect(names).toEqual([...names].sort());
    });

    it('④ 无 return 值的 handler 也走信封（data 为 null，而不是空响应体）', async () => {
      const res = await http().post('/validation-demo/no-content').expect(201);
      const body = bodyAs<Body & { data: null }>(res);

      expect(keysOf(body)).toEqual(['data', 'success']);
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });
  });

  describe('失败：{ success: false, error, message, errors? }', () => {
    it('⑤ 缺必填字段 → 400，键集恰好是 error/errors/message/success', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ email: 'noname@example.com', role: 'viewer' })
        .expect(400);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual(['error', 'errors', 'message', 'success']);
      expect(body).toMatchObject({
        success: false,
        error: 'Bad Request',
        message: 'Request validation failed',
      });
      expect(fieldsOf(body)).toContain('name');
    });

    it('⑥ 嵌套对象非法 → errors[].field 给完整路径 address.city', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({
          name: 'Nested',
          email: 'nested@example.com',
          role: 'viewer',
          address: { street: 'Main 1', city: 'X' },
        })
        .expect(400);

      expect(fieldsOf(res.body)).toContain('address.city');
    });

    it('⑦ 自定义校验器命中保留字 → 400', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ name: 'admin', email: 'reserved@example.com', role: 'viewer' })
        .expect(400);

      expect(textsOf(res.body)).toMatch(/reserved name/);
    });

    it('⑧ 路径参数非法 → 400，field 点名 id（ParseIntPipe 给不出字段名）', async () => {
      const res = await http().get('/validation-demo/users/abc').expect(400);

      expect(fieldsOf(res.body)).toContain('id');
      expect(textsOf(res.body)).toMatch(/id/);
    });

    it('⑨ 不存在的资源 → 404，且**没有** errors 字段（无明细就不该有键）', async () => {
      const res = await http().get('/validation-demo/users/999999').expect(404);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual(['error', 'message', 'success']);
      expect(body).toMatchObject({
        success: false,
        error: 'Not Found',
        message: 'user 999999 not found',
      });
    });

    it('⑩ 业务冲突 → 409，文案可区分具体业务错误', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ name: 'Dup', email: 'neo@example.com', role: 'viewer' })
        .expect(409);

      expect(bodyAs<ErrorBody>(res)).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'email neo@example.com already exists',
      });
    });

    it('⑪ 完全没匹配上的路由 → 404 也走同一个失败形状', async () => {
      const res = await http().get('/definitely-not-a-route').expect(404);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual(['error', 'message', 'success']);
      expect(body).toMatchObject({
        success: false,
        error: 'Not Found',
        message: 'Cannot GET /definitely-not-a-route',
      });
    });
  });

  describe('边界：信封什么时候不套', () => {
    it('⑫ @RawBody() 的参数级豁免不影响响应信封（原始 payload 进 data）', async () => {
      const payload = {
        event: 'user.created',
        data: { id: 7 },
        count: 2,
        extra: '未声明字段',
      };
      const res = await http()
        .post('/validation-demo/webhooks/raw-body')
        .send(payload)
        .expect(201);
      const body = bodyAs<Body & { data: ReceivedBody }>(res);

      expect(keysOf(body)).toEqual(['data', 'success']);
      // `@RawBody()` 跳过整个管道：未声明字段原样保留
      expect(body.data.received).toEqual(payload);
    });

    it('⑬ 局部 ParseArrayPipe 的结果照常进 data', async () => {
      const res = await http()
        .post('/validation-demo/pipe-order/ids')
        .send(['1', '2'])
        .expect(201);
      const body = bodyAs<Body & { data: IdsBody }>(res);

      expect(keysOf(body)).toEqual(['data', 'success']);
      expect(body.data).toEqual({ ids: [1, 2] });
    });
  });
});

/**
 * 选项透传的探针应用。
 *
 * 为什么单独起一个根模块：`ApiContractModule.forRoot({...})` 的选项在调用时就被捕获进
 * 实例（`useValue`），所以**没法**用 `overrideProvider()` 换 —— 只能实打实跑一遍不同配置。
 *
 * 这里同时验证三件事：`forbidNonWhitelisted` 透传、`envelope: false` 真的关掉、
 * `@NoEnvelope()` 只放行它自己那条路由。
 */
@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return dto;
  }

  /** 逃生门：这条路由不套信封。 */
  @Get('bare')
  @NoEnvelope()
  bare() {
    return { bare: true };
  }

  /** `@Redirect()` 走的是另一条响应分支，信封必须不插手。 */
  @Get('moved')
  @Redirect('/probe/bare', 302)
  moved() {
    return { url: '/probe/bare', statusCode: 302 };
  }
}

@Module({
  imports: [
    ApiContractModule.forRoot({
      forbidNonWhitelisted: true,
      envelope: false,
    }),
  ],
  controllers: [ProbeController],
})
class BareProbeModule {}

describe('ApiContractModule.forRoot 的选项透传', () => {
  let probe: INestApplication<App>;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [BareProbeModule],
    }).compile();

    probe = fixture.createNestApplication();
    await probe.init();
  });

  afterAll(async () => {
    await probe.close();
  });

  it('⑭ 校验选项透传：多余字段 → 400（默认配置下是静默剥掉）', async () => {
    const res = await request(probe.getHttpServer())
      .post('/probe')
      .send({
        name: 'Neo',
        email: 'probe@example.com',
        role: 'viewer',
        extra: 'x',
      })
      .expect(400);

    expect(fieldsOf(res.body)).toContain('extra');
  });

  it('⑮ envelope: false → 成功响应是裸返回值；失败仍走 AppExceptionFilter', async () => {
    const created = await request(probe.getHttpServer())
      .post('/probe')
      .send({ name: 'Neo', email: 'probe@example.com', role: 'viewer' })
      .expect(201);

    // 裸值：既没有信封的 `data` / `success` 包装，也没有数字状态码
    expect(created.body).toMatchObject({ email: 'probe@example.com' });
    expect(keysOf(created.body)).not.toContain('success');

    const notFound = await request(probe.getHttpServer())
      .get('/nope')
      .expect(404);

    // 失败侧不受 `envelope: false` 影响：全局过滤器始终产出失败形状
    expect(bodyAs<ErrorBody>(notFound)).toMatchObject({
      success: false,
      error: 'Not Found',
    });
  });

  it('⑯ @NoEnvelope() 只放行自己那条路由；@Redirect() 不被信封破坏', async () => {
    const bare = await request(probe.getHttpServer())
      .get('/probe/bare')
      .expect(200);

    expect(bare.body).toEqual({ bare: true });

    const moved = await request(probe.getHttpServer())
      .get('/probe/moved')
      .expect(302);

    expect(moved.headers.location).toBe('/probe/bare');
  });
});
