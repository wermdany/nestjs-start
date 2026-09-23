import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '@/app.module';
import { ErrorCode } from '@/contract';
import {
  ENVELOPE_COMPONENT_SCHEMAS,
  ERROR_DETAIL_REF,
  ERROR_DETAIL_SCHEMA,
  ERROR_ENVELOPE_REF,
  ERROR_ENVELOPE_SCHEMA,
  RESPONSE_ENVELOPE_REF,
  UNAUTHENTICATED_EXAMPLE,
} from '@/swagger/envelope.schema';
import { isSwaggerEnabled } from '@/swagger/is-swagger-enabled';
import {
  buildDocument,
  setupSwagger,
  SWAGGER_JSON_PATH,
  SWAGGER_UI_PATH,
} from '@/swagger/setup-swagger';

/**
 * Swagger / OpenAPI 的契约测试。
 *
 * 分两部分：
 *
 * 1. **文档内容** —— 直接构文档断言（不起端口），钉住"信封 schema 与运行时契约一致"；
 * 2. **启停与可访问性** —— 起真实 HTTP，验证 `/docs-json` 在开/关两种情况下的表现。
 *
 * 文档内容这一层之所以能测到"插件推导"的结果（例如 `name` 的 `minLength`），
 * 是因为 `jest-e2e.json` 里给 ts-jest 挂了 `@nestjs/swagger` 的 AST 变换
 * （见仓库根的 `jest-swagger-transformer.js`）—— 它保证测试里生成的 schema
 * 与 `pnpm build` 出来的一致。
 *
 * ⚠️ 文档**不在这里重新拼**：用的是 `src/swagger/setup-swagger.ts` 导出的
 * `buildDocument()` —— 线上入口和测试入口是同一个函数。
 * （以前这里自己写了一遍 `DocumentBuilder`，于是入口改了 title / `extraModels`
 * 而测试照样全绿 —— 那种测试等于没测。)
 *
 * ## 为什么这个文件在 `src/swagger/__tests__/` 而不是某个 demo 模块里
 *
 * 它测的是**整份文档**（全量路径清单、标签、悬空 `$ref`、信封组件、每条路由的失败响应），
 * 那是 `src/swagger/` 的职责，不是任何一个 demo 的。放在 demo 模块里会有两个具体后果：
 *
 * 1. 每加一个控制器都要去改那个 demo 的测试文件（改的还是与它无关的断言）；
 * 2. 新模块的文档知识会散落在旧模块的测试里。
 *
 * 所以：**文档级不变量归这里，每个模块的运行时行为归它自己的 `__tests__/`**
 * （例如 `src/auth/__tests__/auth.e2e-spec.ts`）。
 */

const ENVELOPE_COMPONENTS: Record<string, object> = {
  ...ENVELOPE_COMPONENT_SCHEMAS,
};

/**
 * 断言用的窄化视图：`SchemaObject.properties` 的值是 `SchemaObject | ReferenceObject`，
 * 直接点 `.enum` 会被 TS 拦住，所以统一收窄一次。
 */
interface PropertiesView {
  required?: string[];
  properties?: Record<string, Record<string, unknown>>;
}

const ERROR_DETAIL_VIEW = ERROR_DETAIL_SCHEMA as PropertiesView;
const ERROR_ENVELOPE_VIEW = ERROR_ENVELOPE_SCHEMA as PropertiesView;

/**
 * 拿一个操作的响应 schema 里**由具体路由补的那部分**（`allOf[1].properties`）。
 *
 * 为什么不是顶层的 `properties`：信封用 `allOf` 组合（`[信封壳子, { data }]`），
 * `data` 只在第二段里 —— 顶层只有 `allOf` 和 `example`。
 */
function responseSchema(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post' | 'patch',
  status: string,
): {
  allOf?: ({ $ref?: string } & { properties?: Record<string, unknown> })[];
} {
  const operation = document.paths[path][method] as {
    responses: Record<string, { content: Record<string, { schema: object }> }>;
  };

  return operation.responses[status].content['application/json'].schema;
}

/** 取信封里被包住的那个 `data` 的 schema。 */
function dataSchema(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post' | 'patch',
  status: string,
): Record<string, unknown> | undefined {
  return responseSchema(document, path, method, status).allOf?.[1]?.properties
    ?.data as Record<string, unknown> | undefined;
}

/** 文档里的一条操作（原始对象，含 `tags` / `responses`）。 */
interface OperationView {
  tags?: string[];
  responses: Record<string, unknown>;
}

/** 取某个操作的原始对象。 */
function operationAt(
  document: OpenAPIObject,
  path: string,
  method: string,
): OperationView {
  // `PathItemObject` 的方法位在类型上是 `any`：先收成 `unknown` 再断言一次，
  // 这样既不会触发 `no-unsafe-return`，也不需要多余的 `as unknown as` 双断言。
  const pathItem = document.paths[path] as Record<string, unknown>;

  return pathItem[method] as OperationView;
}

/** 文档里出现的**全部**操作（path + method）—— 用于"逐条路由"的通用断言。 */
function allOperations(
  document: OpenAPIObject,
): { path: string; method: string }[] {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  return Object.keys(document.paths).flatMap((path) =>
    methods
      .filter((method) => method in (document.paths[path] as object))
      .map((method) => ({ path, method })),
  );
}

/**
 * 递归收集文档里所有 `#/components/schemas/X` 形式的 `$ref` 指向的名字。
 *
 * 故意不依赖任何已知结构：`paths` / `components` / `webhooks` 全扫一遍，
 * 这样以后新增响应模型时不用改这条守卫。
 */
function collectRefs(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, found);
    }

    return;
  }

  if (typeof node !== 'object' || node === null) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      const name = value.replace('#/components/schemas/', '');

      if (name !== value) {
        found.add(name);
      }

      continue;
    }

    collectRefs(value, found);
  }
}

describe('OpenAPI 文档', () => {
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

  describe('路由覆盖', () => {
    it('全量路径清单：每条路由都在文档里（含路径参数写法 {id}）', () => {
      const document = buildDocument(app);

      expect(Object.keys(document.paths).sort()).toEqual([
        '/auth/login',
        '/auth/profile',
        '/validation-demo/no-content',
        '/validation-demo/pipe-order/array-message',
        '/validation-demo/pipe-order/ids',
        '/validation-demo/pipe-order/strict',
        '/validation-demo/users',
        '/validation-demo/users/{id}',
        '/validation-demo/webhooks/body',
        '/validation-demo/webhooks/plain',
        '/validation-demo/webhooks/raw-body',
      ]);
    });

    it('每条操作都有标签（v11 的自动打标签是关的，必须显式）', () => {
      const document = buildDocument(app);

      for (const { path, method } of allOperations(document)) {
        expect(operationAt(document, path, method).tags ?? []).not.toEqual([]);
      }
    });

    it('两组接口各自的标签都在（validation-demo / auth）', () => {
      const document = buildDocument(app);

      expect(
        operationAt(document, '/validation-demo/users', 'post').tags,
      ).toContain('validation-demo');
      expect(operationAt(document, '/auth/profile', 'get').tags).toContain(
        'auth',
      );
    });
  });

  describe('成功响应：{ success: true, data } 信封', () => {
    it('POST /users 的 201 = 信封 + UserDto', () => {
      const document = buildDocument(app);
      const schema = responseSchema(
        document,
        '/validation-demo/users',
        'post',
        '201',
      );

      expect(schema.allOf?.[0]?.$ref).toBe(RESPONSE_ENVELOPE_REF);
      expect(
        dataSchema(document, '/validation-demo/users', 'post', '201'),
      ).toMatchObject({ $ref: '#/components/schemas/UserDto' });
    });

    it('GET /users 的 200 = 信封 + UserDto 数组（分页数据是数组）', () => {
      const document = buildDocument(app);
      const schema = responseSchema(
        document,
        '/validation-demo/users',
        'get',
        '200',
      );
      const data = dataSchema(
        document,
        '/validation-demo/users',
        'get',
        '200',
      ) as { type?: string; items?: { $ref?: string } } | undefined;

      expect(schema.allOf?.[0]?.$ref).toBe(RESPONSE_ENVELOPE_REF);
      expect(data?.type).toBe('array');
      expect(data?.items?.$ref).toBe('#/components/schemas/UserDto');
    });

    it('POST /no-content 的 201 data 是 nullable null（与运行时 data: null 一致）', () => {
      const data = dataSchema(
        buildDocument(app),
        '/validation-demo/no-content',
        'post',
        '201',
      );

      expect(data).toMatchObject({ nullable: true });
    });
  });

  describe('失败响应：{ success: false, error, message } 信封', () => {
    it('类级失败响应覆盖到每条路由：400 / 404 / 500', () => {
      const document = buildDocument(app);
      const operations = [
        ['/validation-demo/users', 'post'],
        ['/validation-demo/users', 'get'],
        ['/validation-demo/users/{id}', 'get'],
        ['/validation-demo/webhooks/plain', 'post'],
      ] as const;

      for (const [path, method] of operations) {
        const operation = document.paths[path][method] as {
          responses: Record<string, unknown>;
        };

        expect(Object.keys(operation.responses).sort()).toEqual(
          expect.arrayContaining(['400', '404', '500']),
        );
      }
    });

    /**
     * 认证的文档契约（`@ApiEnvelopeUnauthorized()`）。
     *
     * 与 `src/auth/__tests__/auth.e2e-spec.ts` 是**两侧**：那边钉运行时
     * （真发请求，断言状态码 / 头 / 键集），这边钉文档声明。引用的是同一份示例常量，
     * 所以"文档里写的形状"和"运行时给的形状"只可能一起变。
     */
    it('需要认证的路由声明了 401', () => {
      const document = buildDocument(app);

      expect(
        Object.keys(operationAt(document, '/auth/profile', 'get').responses),
      ).toEqual(expect.arrayContaining(['401']));
    });

    it('AuthController 的**每条**路由都声明 401（对登录也是准确的）', () => {
      const document = buildDocument(app);
      const login = Object.keys(
        operationAt(document, '/auth/login', 'post').responses,
      );

      // `/auth/login` 带 `@Public()`（不要求**已有**凭证），但凭证不对时它确实返回 401 ——
      // 所以类级声明在它身上是准确描述，不是过度声明。
      expect(login).toEqual(expect.arrayContaining(['401']));
      // 通用的类级失败响应依然在
      expect(login).toEqual(expect.arrayContaining(['400', '404', '500']));
      // 本仓库只做认证、没有授权层，文档里就不该出现 403
      expect(login).not.toContain('403');
    });

    it('401 指向错误信封，且示例键集与运行时一致（没有 errors）', () => {
      const document = buildDocument(app);
      const schema = responseSchema(
        document,
        '/auth/profile',
        'get',
        '401',
      ) as {
        allOf?: { $ref?: string }[];
        example?: Record<string, unknown>;
      };

      expect(schema.allOf?.[0]?.$ref).toBe(ERROR_ENVELOPE_REF);
      // 键集精确比对：认证失败**没有**字段级明细（`errors` 只在 400 上）
      expect(Object.keys(schema.example ?? {}).sort()).toEqual(
        Object.keys(UNAUTHENTICATED_EXAMPLE).sort(),
      );
    });

    it('400 指向错误信封，且 errors[].$ref 指向 ErrorDetail 组件', () => {
      const document = buildDocument(app);
      const schema = responseSchema(
        document,
        '/validation-demo/users',
        'post',
        '400',
      );

      expect(schema.allOf?.[0]?.$ref).toBe(ERROR_ENVELOPE_REF);
      const errors = document.components.schemas.ErrorEnvelope as {
        properties: { errors: { items: { $ref: string } } };
      };

      expect(errors.properties.errors.items.$ref).toBe(ERROR_DETAIL_REF);
    });

    it('信封组件都真实存在于 components.schemas（$ref 不会解析不到）', () => {
      const schemas = buildDocument(app).components.schemas;

      expect(Object.keys(schemas)).toEqual(
        expect.arrayContaining([
          'ResponseEnvelope',
          'ErrorEnvelope',
          'ErrorDetail',
        ]),
      );
    });

    /**
     * 通用守卫：文档里出现的**每一个** `$ref` 都要能在 `components.schemas` 里找到。
     *
     * 这条测试是为一个真实踩过的坑加的：把 `@ApiResponse({ type: [UserDto] })` 换成
     * 手写 `schema` + `$ref` 之后，`@nestjs/swagger` 不再"探测到"这个模型类，
     * `components.schemas.UserDto` 就没了 —— 文档里留着一个解析不到的悬空引用，
     * 而所有按名字断言的测试**依然是绿的**（因为 `$ref` 字符串本身没变）。
     */
    it('文档里没有悬空 $ref（漏注册响应模型会在这里变红）', () => {
      const document = buildDocument(app);
      const schemaNames = new Set(Object.keys(document.components.schemas));

      const referenced = new Set<string>();
      collectRefs(document, referenced);

      expect(referenced.size).toBeGreaterThan(0);
      expect([...referenced].filter((name) => !schemaNames.has(name))).toEqual(
        [],
      );
    });

    it('成功信封的 meta 只有三个字段（没有可推导的 totalPages）', () => {
      const envelope = ENVELOPE_COMPONENTS.ResponseEnvelope as {
        properties: { meta: { properties: Record<string, unknown> } };
      };

      expect(Object.keys(envelope.properties.meta.properties).sort()).toEqual([
        'currentPage',
        'itemsPerPage',
        'totalItems',
      ]);
    });

    /**
     * `code` / `traceId` 是契约层新增的两个字段，schema 必须跟上：
     *
     * - `code` 的**枚举取值**直接来自契约层的 `ErrorCode`（不是手抄的字符串数组）；
     * - 两者都**不在** `required` 里：框架自身抛的错没有业务 code，
     *   而请求 id 中间件跑在 body 解析之后 —— body 解析失败的 400 没有 traceId。
     */
    it('失败信封声明了 code / traceId，且取值集合来自契约层', () => {
      const properties = ERROR_ENVELOPE_VIEW.properties ?? {};

      expect(Object.keys(properties).sort()).toEqual([
        'code',
        'error',
        'errors',
        'message',
        'success',
        'traceId',
      ]);
      expect(ERROR_ENVELOPE_VIEW.required).toEqual([
        'success',
        'error',
        'message',
      ]);
      expect(properties.code?.enum).toEqual(
        expect.arrayContaining(Object.values(ErrorCode)),
      );
      expect(properties.traceId).toMatchObject({ type: 'string' });
    });

    it('错误明细声明了 location / code（枚举来自契约层）', () => {
      const properties = ERROR_DETAIL_VIEW.properties ?? {};

      expect(Object.keys(properties).sort()).toEqual([
        'code',
        'field',
        'location',
        'message',
      ]);
      expect(properties.location?.enum).toEqual(['body', 'query', 'param']);
      expect(properties.code?.enum).toEqual(
        expect.arrayContaining(Object.values(ErrorCode)),
      );
    });

    /**
     * **双向守卫**：手写的 `ERROR_DETAIL_SCHEMA` 与运行时真实的 `errors[]` 必须一致。
     *
     * 契约层的 `ErrorDetail` 是纯类型（定义在 `@nest-start/api-contract`），
     * 契约层刻意零 Swagger 依赖，所以这边只能手写结构 —— 这条测试是"手写"的安全网：
     *
     * - 运行时多出一个 schema 没声明的键 ⇒ 文档在骗人；
     * - schema 的 `required` 在运行时缺席 ⇒ 文档在骗人。
     *
     * 漏改一边都会红，这就是"单一数据源"在无法共享类型时的等价物。
     */
    it('手写的错误明细 schema 与运行时 errors[] 一致（双向守卫）', async () => {
      const res = await request(app.getHttpServer())
        .post('/validation-demo/users')
        .send({
          name: 'x',
          email: 'not-an-email',
          role: 'viewer',
          address: { street: 'M', city: 'X' },
        })
        .expect(400);

      const details = (res.body as { errors?: Record<string, unknown>[] })
        .errors;

      expect(details?.length).toBeGreaterThan(0);

      const properties = ERROR_DETAIL_VIEW.properties ?? {};
      const required = ERROR_DETAIL_VIEW.required ?? [];

      for (const detail of details ?? []) {
        expect(
          Object.keys(detail).filter((key) => !(key in properties)),
        ).toEqual([]);
        expect(required.filter((key) => !(key in detail))).toEqual([]);
      }
    });
  });

  describe('与校验规则同源（CLI 插件生效的证据）', () => {
    it('CreateUserDto 的约束来自 class-validator，而不是手抄', () => {
      const schemas = buildDocument(app).components.schemas;
      const createUser = schemas.CreateUserDto as {
        properties: Record<string, Record<string, unknown>>;
      };

      expect(createUser.properties.name).toMatchObject({
        minLength: 2,
        maxLength: 20,
      });
      expect(createUser.properties.email).toMatchObject({ format: 'email' });
      expect(createUser.properties.age).toMatchObject({ maximum: 150 });
      expect(createUser.properties.role).toMatchObject({
        enum: ['admin', 'editor', 'viewer'],
      });
    });

    it('UpdateUserDto 由 PartialType 派生，字段带上了（否则 PATCH 的 body 会是空的）', () => {
      const schemas = buildDocument(app).components.schemas;
      const updateUser = schemas.UpdateUserDto as {
        properties: Record<string, unknown>;
      };

      expect(Object.keys(updateUser.properties).sort()).toEqual([
        'address',
        'age',
        'email',
        'name',
        'role',
        'tags',
      ]);
    });

    it('分页参数是显式写的（含 sortBy 白名单枚举与 limit 上限）', () => {
      const document = buildDocument(app);
      const operation = document.paths['/validation-demo/users']
        .get as unknown as {
        parameters: {
          name: string;
          schema: Record<string, unknown>;
        }[];
      };
      const byName = Object.fromEntries(
        operation.parameters.map((parameter) => [
          parameter.name,
          parameter.schema,
        ]),
      );

      expect(byName.sortBy).toMatchObject({ enum: ['id', 'name', 'email'] });
      expect(byName.limit).toMatchObject({ maximum: 50, default: 10 });
      expect(byName.page).toMatchObject({ default: 1, minimum: 1 });
    });
  });
});

describe('setupSwagger 的启停与可访问性', () => {
  const ORIGINAL_ENV = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_SWAGGER: process.env.ENABLE_SWAGGER,
  };

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
    process.env.ENABLE_SWAGGER = ORIGINAL_ENV.ENABLE_SWAGGER;
  });

  /** 启停规则是纯函数，这里逐条钉住（含"含糊真值不算数"这条）。 */
  it('isSwaggerEnabled 的四种组合', () => {
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: undefined }),
    ).toBe(false);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'development', ENABLE_SWAGGER: undefined }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: undefined, ENABLE_SWAGGER: 'false' }),
    ).toBe(false);
    // 含糊的真值**不算数**：只有恰好 'true' / 'false' 才算显式
    expect(
      isSwaggerEnabled({ NODE_ENV: 'development', ENABLE_SWAGGER: '1' }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'yes' }),
    ).toBe(false);
  });

  async function listen(enabled: boolean): Promise<{
    base: string;
    close: () => Promise<void>;
  }> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app: INestApplication<App> = moduleFixture.createNestApplication();

    // ⚠️ 顺序很重要：`setupSwagger()` 必须在 `listen()`/`init()` **之前**调用。
    // `NestApplication.init()` 会注册"未匹配路由 → 404 失败信封"的钩子，
    // 之后再往 Express 上挂 `/docs-json` 就永远轮不到它（实测 404）。
    // `main.ts` 正是这个顺序（create → setupSwagger → listen）。
    setupSwagger(app, { enabled });

    await app.listen(0);

    // `getHttpServer()` 是 `any`，在这里收窄一次，避免 unsafe-member-access
    const httpServer = app.getHttpServer() as {
      address: () => { port: number } | null;
    };
    const address = httpServer.address();

    return {
      base: `http://127.0.0.1:${address?.port ?? 0}`,
      close: async () => app.close(),
    };
  }

  it('开启时：/docs-json 返回 200，且路径是文档而不是信封', async () => {
    const server = await listen(true);

    try {
      const response = await fetch(`${server.base}/${SWAGGER_JSON_PATH}`);
      const document = (await response.json()) as OpenAPIObject;

      expect(response.status).toBe(200);
      expect(document.info.title).toBe('nestjs-start API');
      // 没有被响应信封包住：顶层是 OpenAPI 字段，不是 { success, data }
      expect(document).not.toHaveProperty('success');
    } finally {
      await server.close();
    }
  });

  it('开启时：/docs 返回 Swagger UI 的 HTML', async () => {
    const server = await listen(true);

    try {
      const response = await fetch(`${server.base}/${SWAGGER_UI_PATH}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
    } finally {
      await server.close();
    }
  });

  it('关闭时：/docs-json 不注册，落到 404 失败信封', async () => {
    const server = await listen(false);

    try {
      const response = await fetch(`${server.base}/${SWAGGER_JSON_PATH}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        error: 'Not Found',
        message: `Cannot GET /${SWAGGER_JSON_PATH}`,
      });
    } finally {
      await server.close();
    }
  });
});
