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
import {
  API_CONTRACT_OPTIONS,
  ApiContractModule,
  NoEnvelope,
} from '@/contract';
import type {
  ErrorBody,
  ErrorDetail,
  PaginationMeta,
  ResponseBody,
} from '@/contract';
import { CreateUserDto } from '../dto/create-user.dto';

/**
 * 整个仓库只剩这一个测试文件，它只干一件事：**把响应契约钉死**。
 *
 * 契约（详见 `src/contract/response/response-contract.ts` 与 docs/validation.md §9）：
 *
 * - 成功：`{ success: true, data, meta? }` —— 没有 `message`，也没有数字状态码
 * - 失败：`{ success: false, error, message, code?, traceId?, errors? }`
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

function detailsOf(body: unknown): ErrorDetail[] {
  return (body as { errors?: ErrorDetail[] }).errors ?? [];
}

function fieldsOf(body: unknown): string[] {
  return detailsOf(body).map((detail) => detail.field);
}

function codesOf(body: unknown): (string | undefined)[] {
  return detailsOf(body).map((detail) => detail.code);
}

function textsOf(body: unknown): string {
  return detailsOf(body)
    .map((detail) => `${detail.field} ${detail.message}`)
    .join(' | ');
}

/** 失败信封里的固定键（`code` / `errors` 视错误来源有无）。 */
const ERROR_KEYS = ['error', 'message', 'success', 'traceId'];

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

  describe('失败：{ success: false, error, message, code?, traceId?, errors? }', () => {
    it('⑤ 缺必填字段 → 400，键集恰好是 error/errors/message/success/code/traceId', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ email: 'noname@example.com', role: 'viewer' })
        .expect(400);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual([
        'code',
        'error',
        'errors',
        'message',
        'success',
        'traceId',
      ]);
      expect(body).toMatchObject({
        success: false,
        error: 'Bad Request',
        message: 'Request validation failed',
        // 顶层 code 是机器判据：前端不必去猜"这个 400 是校验还是别的"
        code: 'VALIDATION_FAILED',
      });
      expect(fieldsOf(body)).toContain('name');
    });

    it('⑥ 嵌套对象非法 → errors[].field 给完整路径 address.city，location 是 body', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({
          name: 'Nested',
          email: 'nested@example.com',
          role: 'viewer',
          address: { street: 'Main 1', city: 'X' },
        })
        .expect(400);

      const detail = detailsOf(res.body).find(
        (item) => item.field === 'address.city',
      );

      expect(detail).toBeDefined();
      expect(detail).toMatchObject({
        location: 'body',
        code: 'INVALID_LENGTH',
      });
    });

    it('⑦ 自定义校验器命中保留字 → 400，code 是 RESERVED_NAME（不是约束名）', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ name: 'admin', email: 'reserved@example.com', role: 'viewer' })
        .expect(400);

      expect(textsOf(res.body)).toMatch(/reserved name/);
      expect(codesOf(res.body)).toContain('RESERVED_NAME');
    });

    it('⑧ 路径参数非法 → 400，field 点名 id 且 location 是 param', async () => {
      const res = await http().get('/validation-demo/users/abc').expect(400);
      // `@IsInt()` 与 `@Min(1)` 都会失败（NaN 两个都不满足），所以这里断言"包含"而不是"第一个是"
      const details = detailsOf(res.body).filter((item) => item.field === 'id');

      expect(details.length).toBeGreaterThan(0);
      expect(details.every((item) => item.location === 'param')).toBe(true);
      expect(details.map((item) => item.code)).toEqual(
        expect.arrayContaining(['INVALID_TYPE', 'OUT_OF_RANGE']),
      );
    });

    it('⑨ 不存在的资源 → 404，有业务 code、**没有** errors 字段', async () => {
      const res = await http().get('/validation-demo/users/999999').expect(404);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual([
        'code',
        'error',
        'message',
        'success',
        'traceId',
      ]);
      expect(body).toMatchObject({
        success: false,
        error: 'Not Found',
        message: 'user 999999 not found',
        code: 'USER_NOT_FOUND',
      });
    });

    it('⑩ 业务冲突 → 409，code 让前端不必 parse 文案', async () => {
      const res = await http()
        .post('/validation-demo/users')
        .send({ name: 'Dup', email: 'neo@example.com', role: 'viewer' })
        .expect(409);

      expect(bodyAs<ErrorBody>(res)).toMatchObject({
        success: false,
        error: 'Conflict',
        message: 'email neo@example.com already exists',
        code: 'EMAIL_ALREADY_EXISTS',
      });
    });

    it('⑪ 完全没匹配上的路由 → 404 也走同一个失败形状（框架错误没有业务 code）', async () => {
      const res = await http().get('/definitely-not-a-route').expect(404);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual(ERROR_KEYS);
      expect(body.code).toBeUndefined();
      expect(body).toMatchObject({
        success: false,
        error: 'Not Found',
        message: 'Cannot GET /definitely-not-a-route',
      });
    });
  });

  describe('P0：契约在边界上依然成立', () => {
    /**
     * P0-1：`ApiContractModule` 被 import 多次时，成功响应**不能**套两层信封。
     *
     * 这件事只靠文档约束不住（下一层模块的作者看不到），所以拦截器是幂等的：
     * 返回值带 `ENVELOPED` 标记就放行。
     */
    it('⑰ 重复 forRoot() ⇒ 信封只有一层（幂等）', async () => {
      const fixture = await Test.createTestingModule({
        imports: [NestedContractProbeModule],
      }).compile();
      const nested: INestApplication<App> = fixture.createNestApplication();

      await nested.init();

      try {
        const res = await request(nested.getHttpServer())
          .post('/nested-probe')
          .send({ anything: true })
          .expect(201);
        const body = bodyAs<Record<string, unknown>>(res);

        // 键集在**顶层**就锁死：多一层必然多出 data.data 这种嵌套
        expect(keysOf(body)).toEqual(['data', 'success']);
        expect(body.data).toEqual({ anything: true });
        expect((body.data as Record<string, unknown>).success).toBeUndefined();
      } finally {
        await nested.close();
      }
    });

    /**
     * P0-2：显式传 `null` 不能击穿 DTO 类型 / OpenAPI schema。
     *
     * `@IsOptional()` 的语义是"null 也跳过校验"，所以 `{"tags":null}` 会写出
     * `tags: null`，与 `UserDto.tags: string[]`（required 的 array）矛盾。
     * 换成 `@IsOptionalNotNull()` 之后是 400。
     */
    it('⑱ tags/age 显式传 null → 400（不是静默写入 null）', async () => {
      const created = await http()
        .post('/validation-demo/users')
        .send({
          name: 'NullProbe',
          email: 'null-probe@example.com',
          role: 'viewer',
          tags: null,
          age: null,
        })
        .expect(400);
      const body = bodyAs<ErrorBody>(created);

      expect(fieldsOf(body)).toEqual(expect.arrayContaining(['tags', 'age']));
      expect(codesOf(body)).toEqual(
        expect.arrayContaining(['INVALID_TYPE', 'INVALID_TYPE']),
      );
    });

    it('⑲ PATCH 显式传 null 同样 400（PartialType 的 skipNullProperties 已关掉 null 豁免）', async () => {
      const res = await http()
        .patch('/validation-demo/users/1')
        .send({ tags: null })
        .expect(400);

      expect(fieldsOf(res.body)).toContain('tags');
    });

    it('⑳ PATCH 空 body 仍是合法的"什么都不改"', async () => {
      const res = await http()
        .patch('/validation-demo/users/1')
        .send({})
        .expect(200);
      const body = bodyAs<Body & { data: UserBody }>(res);

      expect(body.data).toMatchObject({ id: 1, name: 'Neo' });
      expect(Array.isArray(body.data.tags)).toBe(true);
    });

    /**
     * P0-3：Nest 内建 / 第三方管道抛的**数组型 message** 不能把明细丢掉。
     *
     * 传统载荷是 `{ statusCode, message: string[], error }`；只认字符串的话会退化成
     * `message: 'Bad Request'` 且 `errors` 全丢 —— 前端拿不到任何可读信息。
     */
    it('㉑ 数组型 message 的异常被规范化进 errors[]，且 message 兜底为第一条', async () => {
      const res = await http()
        .get('/validation-demo/pipe-order/array-message')
        .expect(400);
      const body = bodyAs<ErrorBody>(res);

      expect(keysOf(body)).toEqual([
        'error',
        'errors',
        'message',
        'success',
        'traceId',
      ]);
      expect(fieldsOf(body)).toEqual(['(request)', '(request)']);
      expect(textsOf(body)).toMatch(/title must be a string/);
      expect(body.message).toBe('title must be a string');
    });

    /** P0-4：邮箱与用户名在**校验/入库之前**归一化，唯一性不能被大小写绕过。 */
    it('㉒ 大写邮箱撞已有邮箱 → 409（大小写不敏感）；首尾空格入库前被去掉', async () => {
      await http()
        .post('/validation-demo/users')
        .send({ name: 'Case', email: 'NEO@EXAMPLE.COM', role: 'viewer' })
        .expect(409);

      const res = await http()
        .post('/validation-demo/users')
        .send({
          name: '  Trimmed  ',
          email: '  Trimmed@Example.COM ',
          role: 'viewer',
        })
        .expect(201);
      const body = bodyAs<Body & { data: UserBody }>(res);

      expect(body.data.name).toBe('Trimmed');
      expect(body.data.email).toBe('trimmed@example.com');
    });
  });

  describe('P1：可观测与机器判据', () => {
    it('㉓ 失败响应带 traceId，并与 x-request-id 响应头一致', async () => {
      const res = await http().get('/validation-demo/users/999999').expect(404);
      const header = res.headers['x-request-id'];
      const body = bodyAs<ErrorBody>(res);

      expect(header).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.traceId).toBe(header);
    });

    it('㉔ 客户端带来的合法 x-request-id 被沿用（跨服务链路才连得上）', async () => {
      const res = await http()
        .get('/validation-demo/users/1')
        .set('x-request-id', 'trace-from-gateway-0001')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('trace-from-gateway-0001');
    });

    it('㉕ 不合法的客户端 x-request-id 被替换，不会原样进日志 / 响应头', async () => {
      const res = await http()
        .get('/validation-demo/users/1')
        .set('x-request-id', 'bad id with spaces')
        .expect(200);

      expect(res.headers['x-request-id']).not.toBe('bad id with spaces');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('㉖ query 上的校验失败 location 是 query；body 上是 body', async () => {
      const queryFailure = await http()
        .get('/validation-demo/users?page=abc')
        .expect(400);
      const queryDetails = detailsOf(queryFailure.body).filter(
        (item) => item.field === 'page',
      );

      expect(queryDetails.length).toBeGreaterThan(0);
      expect(queryDetails.every((item) => item.location === 'query')).toBe(
        true,
      );
      expect(queryDetails.map((item) => item.code)).toContain('INVALID_TYPE');

      const bodyFailure = await http()
        .post('/validation-demo/users')
        .send({ name: 123, email: 'x@example.com', role: 'viewer' })
        .expect(400);
      const bodyDetail = detailsOf(bodyFailure.body).find(
        (item) => item.field === 'name',
      );

      expect(bodyDetail?.location).toBe('body');
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
 * 选项透传 / 覆盖的探针应用。
 *
 * 以前选项是在 `forRoot()` 调用时被 `useValue` 捕获的，测试**没法**换配置；
 * 现在选项走 `API_CONTRACT_OPTIONS` 这个 token，于是：
 *
 * - `forRoot({...})` / `forRootAsync({...})` 都能提供它；
 * - 测试里可以 `overrideProvider(API_CONTRACT_OPTIONS)` 直接换掉（见下面第三条）。
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

/** 同一个契约模块注册两次（模拟"某个共享模块顺手又 import 了一次"）。 */
@Controller('nested-probe')
class NestedProbeController {
  @Post()
  create(@Body() body: Record<string, unknown>) {
    return body;
  }
}

@Module({
  imports: [ApiContractModule.forRoot()],
  controllers: [NestedProbeController],
})
class InnerContractModule {}

@Module({
  imports: [ApiContractModule.forRoot(), InnerContractModule],
})
class NestedContractProbeModule {}

/** 选项来自"异步工厂"（真实场景是从 `ConfigService` 读）。 */
@Module({
  imports: [
    ApiContractModule.forRootAsync({
      useFactory: () => ({ forbidNonWhitelisted: true }),
    }),
  ],
  controllers: [ProbeController],
})
class AsyncProbeModule {}

describe('ApiContractModule 的选项提供方式', () => {
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
    // `forbidNonWhitelisted` 报出来的约束也翻译成了语义 code
    expect(codesOf(res.body)).toContain('UNKNOWN_FIELD');
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

  it('㉗ forRootAsync() 的工厂结果同样生效', async () => {
    const fixture = await Test.createTestingModule({
      imports: [AsyncProbeModule],
    }).compile();
    const asyncApp: INestApplication<App> = fixture.createNestApplication();

    await asyncApp.init();

    try {
      await request(asyncApp.getHttpServer())
        .post('/probe')
        .send({
          name: 'Neo',
          email: 'async@example.com',
          role: 'viewer',
          extra: 'x',
        })
        .expect(400);
    } finally {
      await asyncApp.close();
    }
  });

  it('㉘ overrideProvider(API_CONTRACT_OPTIONS) 可以换掉整套契约开关', async () => {
    const fixture = await Test.createTestingModule({
      imports: [BareProbeModule],
    })
      // 覆盖掉 `forRoot({ forbidNonWhitelisted: true, envelope: false })`
      .overrideProvider(API_CONTRACT_OPTIONS)
      .useValue({ forbidNonWhitelisted: false, envelope: true })
      .compile();
    const overridden: INestApplication<App> = fixture.createNestApplication();

    await overridden.init();

    try {
      const res = await request(overridden.getHttpServer())
        .post('/probe')
        .send({
          name: 'Neo',
          email: 'override@example.com',
          role: 'viewer',
          extra: 'x',
        })
        .expect(201);
      const body = bodyAs<Body & { data: Record<string, unknown> }>(res);

      // envelope 又回来了（说明选项真的走了 token，而不是 `useValue` 死值）
      expect(keysOf(body)).toEqual(['data', 'success']);
      // 多余字段被静默剥掉（forbidNonWhitelisted 关掉了）
      expect(body.data.extra).toBeUndefined();
    } finally {
      await overridden.close();
    }
  });
});
