import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '@/app.module';
import {
  ENVELOPE_COMPONENT_SCHEMAS,
  ERROR_DETAIL_REF,
  ERROR_ENVELOPE_REF,
  RESPONSE_ENVELOPE_REF,
} from '@/swagger/envelope.schema';
import { isSwaggerEnabled } from '@/swagger/is-swagger-enabled';
import {
  setupSwagger,
  SWAGGER_JSON_PATH,
  SWAGGER_UI_PATH,
  RESPONSE_MODELS,
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
 */

const ENVELOPE_COMPONENTS: Record<string, object> = {
  ...ENVELOPE_COMPONENT_SCHEMAS,
};

/** 与 `setupSwagger()` 里完全相同的文档配置（那边是运行时入口，这里是断言入口）。 */
function buildDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('nestjs-start API')
    .setVersion('1.0.0')
    .addTag('validation-demo')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: RESPONSE_MODELS,
  });
  document.components.schemas = {
    ...document.components.schemas,
    ...ENVELOPE_COMPONENTS,
  };

  return document;
}

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
  let app: INestApplication;

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
    it('8 个路径 / 12 个操作都在文档里（含路径参数写法 {id}）', () => {
      const document = buildDocument(app);

      expect(Object.keys(document.paths).sort()).toEqual([
        '/validation-demo/no-content',
        '/validation-demo/pipe-order/ids',
        '/validation-demo/pipe-order/strict',
        '/validation-demo/users',
        '/validation-demo/users/{id}',
        '/validation-demo/webhooks/body',
        '/validation-demo/webhooks/plain',
        '/validation-demo/webhooks/raw-body',
      ]);
    });

    it('两个控制器都打了 validation-demo 标签（v11 的自动打标签是关的，必须显式）', () => {
      const document = buildDocument(app);

      for (const path of Object.keys(document.paths)) {
        for (const operation of Object.values(
          document.paths[path] as Record<string, unknown>,
        )) {
          if (
            operation &&
            typeof operation === 'object' &&
            'tags' in operation
          ) {
            expect((operation as { tags: string[] }).tags).toContain(
              'validation-demo',
            );
          }
        }
      }
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
      const parameters = (
        document.paths['/validation-demo/users'].get as {
          parameters: {
            name: string;
            schema: Record<string, unknown>;
          }[];
        }
      ).parameters;
      const byName = Object.fromEntries(
        parameters.map((parameter) => [parameter.name, parameter.schema]),
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
    const app = moduleFixture.createNestApplication();

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
