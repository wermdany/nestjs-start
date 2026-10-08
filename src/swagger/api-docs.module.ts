import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DynamicModule, ValueProvider } from '@nestjs/common';
import type { SwaggerConfig } from '@/config';
import { API_DOCS_OPTIONS, apiDocsInjectTokens } from './api-docs.options';
import type {
  ApiDocsAsyncOptions,
  ApiDocsOptions,
  FeatureDocs,
} from './api-docs.options';

/**
 * **文档选项**的提供者 —— 把"业务自描述的文档"与"配置层读出来的服务地址"
 * 合成一份 {@link ApiDocsOptions}。
 *
 * ## 为什么是独立模块，而不是 `main.ts` 里拼一个对象
 *
 * 本仓库有**两个**会创建应用的入口：`src/main.ts` 与 `src/swagger/export-openapi.ts`。
 * 如果各自拼一次选项，就会出现"`/docs-json` 与落盘的 `openapi.json` 不一致"的漂移
 * —— 这正是 `buildDocument()` 单独导出时踩过的同一个坑（测试自己写了一遍
 * `DocumentBuilder`，于是入口改了而测试照样全绿）。
 * 做成模块后，两个入口都只 `app.get(API_DOCS_OPTIONS)`，配置消费只有一处。
 *
 * ## 为什么工厂是导出的
 *
 * 与 `app.module.ts` 的 `apiContractOptionsFactory` / `jwtOptionsFactory` 同一理由：
 * 可以**直接单测映射结果**（`api-docs.factory.spec.ts`），不必起应用。
 *
 * ## 依赖方向
 *
 * `swagger → config` 只是**读取**（`ConfigService` 由全局的 `AppConfigModule` 提供）；
 * `src/config/` 从不 import 本模块 ⇒ 无环。
 *
 * ## 它**不认识**任何业务
 *
 * tag 与 `responseModels` 全部由组合根通过 `options.providers` 注入 ——
 * 这是"文档层零业务依赖"的落点（守卫见 `docs/architecture-review.md` §6②）。
 */
export function apiDocsOptionsFactory(
  config: ConfigService,
  ...featureDocs: FeatureDocs[]
): ApiDocsOptions {
  const { enabled, serverUrl } = config.getOrThrow<SwaggerConfig>('swagger');

  return {
    enabled,
    serverUrl,
    // ⚠️ 顺序 = `components.schemas` 的键顺序（见 FeatureDocs 的说明）。不要重排。
    responseModels: featureDocs.flatMap((docs) => docs.responseModels),
    tags: featureDocs.map((docs) => docs.tag),
  };
}

/**
 * 把一个业务模块的 {@link FeatureDocs} 包成可注入的 provider。
 *
 * token 用字符串（可读、日志里能认出来），由 tag 名保证唯一。
 *
 * 返回类型是 `ValueProvider`（而不是宽泛的 `Provider`）：
 * 消费方（比如测试）需要直接读 `useValue` 拿到那份自描述，
 * 而 `Provider` 是联合类型，取 `useValue` 得先做断言 —— 没必要把类型信息丢掉。
 */
export function docsProvider(docs: FeatureDocs): ValueProvider {
  return {
    provide: `API_DOCS_FEATURE_${docs.tag.name}`,
    useValue: docs,
  };
}

/**
 * OpenAPI 文档选项的**唯一装配点**的一个可复用实现：
 *
 * ```ts
 * @Module({
 *   imports: [
 *     ApiDocsModule.forRootAsync({
 *       providers: FEATURE_DOCS_PROVIDERS,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * 与 `ApiContractModule` 同构（`forRoot` / `forRootAsync` + options token），
 * 且**只应在 `AppModule` 里 import 一次**。
 *
 * ## 没做成"挂 `/docs` 的模块"
 *
 * `SwaggerModule.setup()` 需要 `INestApplication` 实例，而模块里拿 app 要额外绕路。
 * 所以本模块只负责**选项**，`setupSwagger(app)` 的调用点仍在入口
 * （顺序要求见 `setup-swagger.ts`：必须在 `listen()` / `init()` **之前**）。
 */
@Module({})
export class ApiDocsModule {
  static forRoot(options: ApiDocsOptions = {}): DynamicModule {
    return {
      module: ApiDocsModule,
      providers: [{ provide: API_DOCS_OPTIONS, useValue: options }],
    };
  }

  static forRootAsync(options: ApiDocsAsyncOptions): DynamicModule {
    return {
      module: ApiDocsModule,
      providers: [
        ...options.providers,
        {
          provide: API_DOCS_OPTIONS,
          useFactory: apiDocsOptionsFactory,
          // 顺序与 `apiDocsOptionsFactory(config, ...featureDocs)` 严格对应：
          // 配置在前，业务自描述按传入顺序跟在后面。
          inject: [ConfigService, ...apiDocsInjectTokens(options.providers)],
        },
      ],
    };
  }
}
