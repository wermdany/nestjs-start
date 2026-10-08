import type {
  INestApplication,
  InjectionToken,
  Provider,
  Type,
} from '@nestjs/common';

/**
 * OpenAPI 文档选项的 **DI token**。
 *
 * 与契约层的 `API_CONTRACT_OPTIONS` 是同一套约定（见 `api-contract.module.ts`）：
 * 选项只有一处定义，`buildDocument()` 从这里读，测试里可以直接 override。
 */
export const API_DOCS_OPTIONS = Symbol('API_DOCS_OPTIONS');

/** 一个 OpenAPI 标签。`name` 必须与控制器上 `@ApiTags('…')` 的值**完全一致**。 */
export interface ApiDocsTag {
  /**
   * 标签名。**全局唯一** —— 两个业务模块声明同名标签会在文档里出现两条 tag，
   * 而操作只会挂到其中一个上。
   */
  name: string;
  /** 标签说明（出现在 Swagger UI 的分组标题下）。 */
  description?: string;
}

/**
 * **业务模块对 OpenAPI 的自描述**。
 *
 * 这是"文档层零业务依赖"的关键：`src/swagger/` 不 import 任何业务 DTO，
 * 而是由每个业务模块导出自己的 `FeatureDocs`，组合根（`app.module.ts`）把它注进来。
 *
 * ## 为什么需要 `responseModels`
 *
 * `@nestjs/swagger` 只为它**探测到的模型类**建 `components.schemas`：入参 DTO
 * （`@Body()` / `@Query()` 的类型）会被自动发现，但**出参**模型只以 `$ref` **字符串**
 * 的形式出现在路由 schema 里 —— 框架不会逆向为字符串创建组件。
 *
 * 所以"只作为响应出现"的模型必须在这里显式登记。漏登记的后果是 Swagger UI 上
 * 一个解析不到的引用（`openapi.e2e-spec.ts` 的悬空 `$ref` 通用守卫会兜住它）。
 *
 * ⚠️ **数组顺序即 `components.schemas` 的键顺序**。它不影响 OpenAPI 语义，
 * 但会影响 `openapi/openapi.json` 的 diff 可读性 —— 重排会让一次无关改动看起来很大。
 */
export interface FeatureDocs {
  /** 本模块的标签。 */
  tag: ApiDocsTag;
  /** 只作为响应出现、需要显式注册的模型类。 */
  responseModels: Type<unknown>[];
}

/** 文档层的选项。`buildDocument()` / `setupSwagger()` 从这里读。 */
export interface ApiDocsOptions {
  /**
   * 服务地址，只影响文档里的 `servers` 展示。
   *
   * 不在这里给默认值：默认值属于配置层（`DEFAULT_SWAGGER_SERVER_URL`），
   * 由 `apiDocsOptionsFactory()` 从 `ConfigService` 读出来填上。
   */
  serverUrl?: string;
  /** 顶层 tag 列表（含描述）。 */
  tags?: ApiDocsTag[];
  /** 需要显式注册的响应模型（`extraModels`）。 */
  responseModels?: Type<unknown>[];
  /**
   * 是否挂载 `/docs`。**未提供时按"不挂载"处理**（`setupSwagger()` 的判据是
   * `if (!options.enabled) return;`），所以那些只关心 `buildDocument()` 的测试模块
   * 不必凭空造一个布尔值。
   *
   * 它属于这里（而不是只属于 setup 层），是因为启停同样是**配置**的产物：
   * `apiDocsOptionsFactory()` 从 `swagger` namespace 读出 `enabled`，
   * 于是入口只要 `setupSwagger(app, resolveApiDocsOptions(app))` 一行 ——
   * 不需要知道选项里有哪些字段。
   */
  enabled?: boolean;
}

/**
 * `forRootAsync()` 的输入。
 *
 * 形状照 Nest 自己的约定（`imports` / `useFactory` / `inject`），但 `providers` 是
 * **业务模块自描述的载体**：组合根把每个 `FeatureDocs` 包成一个 provider 传进来，
 * 工厂按**数组顺序**用 rest 参数接收它们。
 *
 * 刻意不用泛型 `inject: [...]` 数组：那个写法在调用点看不出来"会注进来几个东西"，
 * 而这里的数量与顺序**就是** `components.schemas` 的顺序（见 {@link FeatureDocs}）。
 */
export interface ApiDocsAsyncOptions {
  /**
   * 每个业务模块一份 `FeatureDocs` 的 provider（见 `docsProvider()`）。
   *
   * 类型是 `Provider[]`（而不是 `InjectionToken[]`），因为它既被当作 provider 注册、
   * 又要推导出 `inject` 列表 —— 后者由 `apiDocsInjectTokens()` 完成。
   */
  providers: Provider[];
}

/**
 * 由 {@link ApiDocsAsyncOptions.providers} 推导出 `useFactory` 的 `inject` 列表。
 *
 * 存在的理由是一个**类型**问题：`useFactory` 的 `inject` 只接受
 * `(InjectionToken | OptionalFactoryDependency)[]`，而 `Provider` 是它的超集
 * （还包含 `ClassProvider` / `FactoryProvider` 等）。这些 token 本来就是字符串，
 * 所以这里做一次**收窄**，让调用点不必自己拼 `inject`。
 */
export function apiDocsInjectTokens(providers: Provider[]): InjectionToken[] {
  return providers.map((provider): InjectionToken => {
    // 字面量 token（字符串 / symbol / 类）直接可用；provider 对象要取出 `provide`。
    // 用 `'provide' in provider` 而不是 `typeof` 判断：`ClassProvider` 的 `provide`
    // 本身也可以是字符串，两者无法靠类型区分，但运行时判断 `in` 最准。
    return typeof provider === 'string' ||
      typeof provider === 'symbol' ||
      typeof provider === 'function'
      ? provider
      : provider.provide;
  });
}

/**
 * 从应用里取出文档选项。
 *
 * ## `strict: false`
 *
 * token 没注册时返回 `undefined`（而不是抛错），兜底成空对象 ——
 * 于是**不 import `AppModule`** 的测试模块也能调 `buildDocument()` 生成文档，
 * 只是没有 tag 与 `responseModels` 组件；而 `setupSwagger()` 会因为
 * `enabled` 为 `undefined`（假）直接不挂载，而不是抛一个与测试意图无关的 DI 错误。
 */
export function resolveApiDocsOptions(app: INestApplication): ApiDocsOptions {
  return app.get<ApiDocsOptions>(API_DOCS_OPTIONS, { strict: false }) ?? {};
}
