import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  IdsDto,
  ReceivedCheckedBodyDto,
  ReceivedPlainBodyDto,
  ReceivedRawBodyDto,
  StrictProbeResultDto,
} from '@/modules/validation-demo/dto/webhook-response.dto';
import { UserDto } from '@/modules/validation-demo/user.dto';
import { ENVELOPE_COMPONENT_SCHEMAS } from './envelope.schema';
import { isSwaggerEnabled } from './is-swagger-enabled';

/** `/docs`（UI）与 `/docs-json`（原始文档）的路径。 */
export const SWAGGER_UI_PATH = 'docs';
export const SWAGGER_JSON_PATH = 'docs-json';

/**
 * 只作为**响应**出现、需要显式注册的模型。
 *
 * 为什么需要这张表：`@nestjs/swagger` 只为**它探测到的模型类**生成 `components.schemas`。
 * 入参 DTO（`@Body()` / `@Query()` 的类型）会被自动发现，但响应模型只以 `$ref` **字符串**
 * 的形式出现在 schema 里 —— 框架不会逆向为字符串创建组件。少注册就是 Swagger UI 上的
 * 悬空引用（实测踩过：`data: { $ref: UserDto }` 而 `components.schemas.UserDto` 不存在）。
 *
 * ⚠️ 新增"响应模型"（不是请求 DTO）时要往这里加一条。
 * `swagger.e2e-spec.ts` 里有一条**通用守卫**：文档里出现的每个 `$ref` 都必须在
 * `components.schemas` 里能找到，漏加会直接让测试红。
 */
export const RESPONSE_MODELS = [
  UserDto,
  IdsDto,
  StrictProbeResultDto,
  ReceivedCheckedBodyDto,
  ReceivedRawBodyDto,
  ReceivedPlainBodyDto,
];

export interface SetupSwaggerOptions {
  /** 服务地址，只影响文档里的 `servers` 展示。 */
  serverUrl?: string;
  /** 强制覆盖启停判断（测试用；不传则走 `isSwaggerEnabled()`）。 */
  enabled?: boolean;
}

/**
 * **构造** OpenAPI 文档 —— 唯一一处文档配置。
 *
 * 单独导出（而不是塞在 `setupSwagger()` 里）是为了让测试用**同一个**函数：
 * 之前 `swagger.e2e-spec.ts` 自己又写了一遍 `DocumentBuilder`，
 * 于是入口改了 title / `extraModels` 而测试照样全绿 —— 测试就没在测入口。
 *
 * `extraModels` / 信封组件的注入理由见各自的注释。
 */
export function buildDocument(
  app: INestApplication,
  options: SetupSwaggerOptions = {},
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('nestjs-start API')
    .setDescription(
      [
        '`nestjs-start` 的接口文档。',
        '',
        '**响应契约**：',
        '- 成功 `{ success: true, data, meta? }`',
        '- 失败 `{ success: false, error, message, code?, traceId?, errors? }`',
        '',
        '`success` 是唯一判据；`code` 是机器判据（**不要 parse `message`**）；',
        '数字状态码只在 HTTP 状态行里；`traceId` 同时回写在 `x-request-id` 响应头。',
        '详见 `docs/validation.md` §9。',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(options.serverUrl ?? 'http://localhost:3000', '本地开发')
    .addTag(
      'validation-demo',
      '参数校验 / 响应契约的活文档（内存版 users 资源）',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    /**
     * 响应模型要显式注册（见 {@link RESPONSE_MODELS} 的说明）：
     * `@ApiOkEnvelope(UserDto, …)` 只在 schema 里写了一个 `$ref` 字符串，
     * 不注册的话 `components.schemas.UserDto` 不存在 → UI 上是悬空引用。
     */
    extraModels: RESPONSE_MODELS,
  });

  /**
   * 信封的三个组件同样是**手工注入**的：路由 schema 里写的是
   * `$ref: '#/components/schemas/ResponseEnvelope'` 这样的字符串，
   * `createDocument()` 不会替字符串创建组件。
   *
   * 单一数据源仍在 `envelope.schema.ts`：那边定义，这里注入 —— 两个入口（这里和测试）
   * 都走这一个函数，所以不存在"测试用的文档和线上文档不一样"。
   */
  document.components.schemas = {
    ...document.components.schemas,
    ...ENVELOPE_COMPONENT_SCHEMAS,
  };

  return document;
}

/**
 * 挂上 Swagger UI 与 OpenAPI 文档。
 *
 * 在 `main.ts` 里创建完应用后调用一次即可 —— 和 `ApiContractModule.forRoot()` 一样，
 * 是"入口保持干净、能力集中在模块里"的思路（没做成 Nest 模块，因为
 * `SwaggerModule.setup()` 需要 `INestApplication` 实例，做成模块反而要绕回入口）。
 *
 * ## 为什么不会被响应信封包住
 *
 * `/docs` 与 `/docs-json` 是 `SwaggerModule` **直接注册到 Express 适配器**上的中间件，
 * 不经过 Nest 的路由 / 管道 / 拦截器 / 过滤器 —— 所以不需要 `@NoEnvelope()`，
 * 也不会有 `{ success, data }` 外壳。
 *
 * ## 启停
 *
 * 走 `isSwaggerEnabled()`（默认：非 production 开启；`ENABLE_SWAGGER` 可显式覆盖）。
 * 关掉时**什么都不注册**，访问 `/docs` 会落到 Nest 未匹配路由的 404，
 * 即标准失败信封 `{ success: false, error: 'Not Found', message: 'Cannot GET /docs' }`。
 */
export function setupSwagger(
  app: INestApplication,
  options: SetupSwaggerOptions = {},
): void {
  const enabled = options.enabled ?? isSwaggerEnabled();

  if (!enabled) {
    return;
  }

  SwaggerModule.setup(SWAGGER_UI_PATH, app, buildDocument(app, options), {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
  });
}
