import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ENVELOPE_COMPONENT_SCHEMAS } from './envelope.schema';
import type { ApiDocsOptions } from './api-docs.options';

/** `/docs`（UI）与 `/docs-json`（原始文档）的路径。 */
export const SWAGGER_UI_PATH = 'docs';
export const SWAGGER_JSON_PATH = 'docs-json';

/**
 * 本文档层**唯一**的输入 —— 就是注入进来的 {@link ApiDocsOptions}。
 *
 * 保留这个别名（而不是直接用 `ApiDocsOptions`）是为了让调用点能表达
 * "我给的是构造文档所需的选项"，同时**不重复声明任何字段**：
 *
 * ## 为什么是"选项"而不是"登记表"
 *
 * 这里曾经有一张 `RESPONSE_MODELS` 常量，静态 import 了 auth 与 validation-demo 的
 * 全部响应 DTO —— 于是**文档层反向依赖业务层**，新增一个业务模块必须来改这个文件。
 *
 * 现在 tags 与 `extraModels` 由业务模块的 `FeatureDocs` 自描述、组合根
 * （`app.module.ts` → `ApiDocsModule`）通过 `API_DOCS_OPTIONS` 注入。
 * 依赖方向因此变成**单向**：`业务 → 文档描述符`、`组合根 → 文档层`，
 * 而 `src/swagger/` 不再 import 任何业务代码（守卫见 `docs/architecture-review.md` §6②）。
 */
export type SetupSwaggerOptions = ApiDocsOptions;

/**
 * **构造** OpenAPI 文档 —— 唯一一处文档配置。
 *
 * 单独导出（而不是塞在 `setupSwagger()` 里）是为了让测试用**同一个**函数：
 * 之前 `openapi.e2e-spec.ts` 自己又写了一遍 `DocumentBuilder`，
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
        '- 失败 `{ success: false, error, message, traceId?, errors? }`',
        '',
        '`success` 是唯一判据；`code` 是机器判据（**不要 parse `message`**）；',
        '数字状态码只在 HTTP 状态行里；`traceId` 同时回写在 `x-request-id` 响应头。',
        '详见 `docs/validation.md` §9。',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addServer(options.serverUrl ?? 'http://localhost:3000', '本地开发');

  /**
   * 顶层 tag 由**业务模块**自描述（`FeatureDocs.tag`）。
   *
   * 这里只把数据交给 `DocumentBuilder`：`addTag()` 的 `description` 是可选的，
   * 不传时产出的就是"只有 `name`"的 tag 对象 —— 与控制器上的 `@ApiTags('…')`
   * 提供的名字相同。
   *
   * ⚠️ 本层不知道有哪些 tag，所以"每个 tag 都有描述"由
   * `openapi.e2e-spec.ts` 的守卫负责（tag 名与控制器不一致时它会红）。
   */
  for (const tag of options.tags ?? []) {
    config.addTag(tag.name, tag.description);
  }

  const document = SwaggerModule.createDocument(app, config.build(), {
    /**
     * 响应模型要显式注册（理由见 `ApiDocsOptions.responseModels` 的说明）：
     * `@ApiOkEnvelope(UserDto, …)` 只在 schema 里写了一个 `$ref` 字符串，
     * 不注册的话 `components.schemas.UserDto` 不存在 → UI 上是悬空引用。
     *
     * ⚠️ `?? []` 不只是兜底：这一项曾经是模块内常量，现在来自注入的选项 ——
     * 没有它，任何没注入 `API_DOCS_OPTIONS` 的测试模块生成的文档都会缺组件。
     */
    extraModels: options.responseModels ?? [],
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
 * `options.enabled` 是**必填**的：本层刻意不读 `process.env` ——
 * 要不要暴露文档是**配置层**的决定（`src/config/swagger.config.ts` 的 `isSwaggerEnabled()`），
 * 由入口读出来传进来。
 *
 * 关掉时**什么都不注册**，访问 `/docs` 会落到 Nest 未匹配路由的 404，
 * 即标准失败信封 `{ success: false, error: 'Not Found', message: 'Cannot GET /docs' }`。
 */
export function setupSwagger(
  app: INestApplication,
  options: SetupSwaggerOptions,
): void {
  if (!options.enabled) {
    return;
  }

  SwaggerModule.setup(SWAGGER_UI_PATH, app, buildDocument(app, options), {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
  });
}
