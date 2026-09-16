# 复盘与优化清单（Review & Improvement Backlog）

> 对象：本仓库 `src/contract/`、`src/swagger/`、`src/modules/validation-demo/` 三个**已实现**模块。
> 方法：通读源码 + 文档 + e2e，然后在真实进程上做边界探测（`node dist/main` + `curl`）。
> 原则：只写**能复现**的问题，每条给出「现象 → 根因 → 社区对照 → 方案 → 验收」。
> 已经写明「有意没做」的事（`docs/validation.md` §7 / §9.6）不重复建议，只在触发条件到了的地方提醒排期。

---

## 0. 一句话结论

契约层的**设计判断**（`success` 单判据、状态码只走状态行、symbol 标记分页、`@RawBody` 参数级豁免、
悬空 `$ref` 守卫）都在社区第一梯队水平，文档质量甚至高于多数开源仓库。

缺口集中在三处：

1. **健壮性**：3 个可复现的缺陷会让「契约必然成立」这件事在边界上不成立（§1）；
2. **表达力**：错误里缺 `code` / 位置信息 / `traceId`，契约「稳」但「说不清」（§2）；
3. **工程基座**：`strict` 未开、无单测、无 CI、无安全头/限流/配置层 —— 作为学习仓库的「下一层脚手架」缺失（§3）。

---

## 1. P0 · 已实测的契约缺陷

### 1.1 重复 `forRoot()` 会套两层信封 🔴

**现象**（实测）：一个 feature 模块自己也 `imports: [ApiContractModule.forRoot()]`（真实项目里常见：

`CommonModule` / `SharedModule` 里顺手 import 一次），响应变成：

```json
{"success":true,"data":{"success":true,"data":{"ok":true,"dto":{"a":1}}}}
```

**根因**：`forRoot()` 每次调用返回一个新的动态模块实例，各自注册一个 `APP_INTERCEPTOR`；
Nest 把整张模块图里所有 `APP_INTERCEPTOR` 实例收进同一条拦截器链，于是 `map()` 跑两次。
`APP_FILTER` 不会双跑（`ExceptionsHandler` 命中第一个匹配的过滤器就返回），所以**只有成功侧**出问题 ——
这也是它容易被漏掉的原因：错误路径测起来是好的。

**社区做法**：全局模块要么 `@Global()` + 单一注册点，要么让增强器**幂等**。
`@nestjs/throttler`、`nestjs-pino` 这类成熟模块都选了「增强器内部判断，可重复注册」。

**方案**（两层都要，缺一不可）：

```ts
// response-contract.ts —— 与 PAGINATED_RESULT 同款的非枚举标记
export const ENVELOPED = Symbol('ENVELOPED');

// response-envelope.interceptor.ts
private envelope(value: unknown): ResponseBody {
  if (isStreamableFile(value)) return value as ResponseBody;
  if (isEnveloped(value)) return value as ResponseBody;   // ← 幂等：包过就不再包
  const body = /* ...原逻辑... */;
  Object.defineProperty(body, ENVELOPED, { value: true });
  return body;
}
```

外加：`ApiContractModule` 加 `@Global()`、README 写明「**只在 `AppModule` import 一次**」，
并补一条 e2e（就照本仓库 §1 的探针写法：`RootModule` 与 `InnerModule` 各 import 一次，断言键集只有一层）。

### 1.2 `null` 能击穿 DTO 类型与 OpenAPI schema 🔴

**现象**（实测）：

| 请求 | 响应 |
| --- | --- |
| `PATCH /users/1 {"tags":null}` | `"tags": null` |
| `POST /users {...,"age":null}` | `"age": null` |

而 `UserDto.tags` 是 `string[]`（非可选）、`UserDto.age?: number`、OpenAPI 里 `tags` 是 `required` 的 `array`。
**运行时响应违反了自己发布的 schema** —— 这是契约测试按「键集」断言时照不到的盲区（键没变，值是错的）。

**根因**：class-validator 的 `@IsOptional()` 官方语义是「值为 `null` **或** `undefined` 时跳过所有校验」
（不是「字段可以不存在」）。`PartialType` 后又给 `tags` 加了可选性，于是 `null` 一路通过。

**方案**（按业务语义二选一，别混）：

- 显式传 `null` 有语义（清空）→ 把类型改成 `tags: string[] | null`，Swagger 标 `nullable: true`，service 显式处理；
- 不支持清空 → 用「可选但不接受 null」的写法替换 `@IsOptional()`：

```ts
// 可以是 contract 层提供的可复用装饰器
export const IsOptionalNotNull = () => ValidateIf((_o, v) => v !== undefined);
```

**验收**：e2e 增加「`tags: null` → 400」或用 `swagger.e2e-spec.ts` 的 schema 与运行时响应做一致性断言
（见 §2.4 的建议）。

### 1.3 `AppExceptionFilter` 会**丢掉**数组型 `message` 🔴

**现象**（实测）：

```bash
# 抛 new BadRequestException(['title must be a string', 'title too long'])
{"success":false,"error":"Bad Request","message":"Bad Request"}   # ← 两条明细全丢，message 退化成状态短语
```

**影响面**：Nest 内建/第三方管道与守卫的**默认异常载荷**就是 `{ statusCode, message: string[], error }`
（`ParseFilePipe`、`ParseUUIDPipe` 之外的自定义管道、任何人局部挂的 `new ValidationPipe()`、
第三方模块抛的 `BadRequestException(messages)`）。也就是说：只要有一条路径没走本仓库的
`createValidationExceptionFactory()`，契约就从「结构化」退化成「什么都不说」。

**根因**：`http-exception.filter.ts` 只处理 `typeof message === 'string'`，其它一律
`STATUS_CODES[statusCode]`；`errors` 只在 payload 自带 `errors` 数组时才透传。

**方案**：在过滤器里把 Nest 的**传统载荷**也规范化（这是社区统一错误层的标准做法 ——
「管你是谁的异常，出口形状只有一个」）：

```ts
const phrase = this.phraseOf(statusCode);
const details: ErrorDetail[] = Array.isArray(errors)
  ? (errors as ErrorDetail[])
  : Array.isArray(message)
    ? (message as unknown[]).map((m) => ({ field: '(request)', message: String(m) }))
    : [];

body = {
  success: false,
  error: phrase,
  message: typeof message === 'string' && message.trim() ? message : phrase,
  ...(details.length ? { errors: details } : {}),
};
```

顺带两个小口子（同一函数内一起修）：

- `new NotFoundException('')` → 现在返回 `message: ""`，应 fallback 到状态短语；
- `response.headersSent` 为真时（`@Sse()` 建立连接后抛错）`status().json()` 会抛
  `ERR_HTTP_HEADERS_SENT`，过滤器自身变成未处理异常 —— 建议 `if (response.headersSent) return;` 收口。

### 1.4 邮箱唯一性可被大小写绕过 / 首尾空格入库 🟠

**现象**（实测）：`NEO@EXAMPLE.COM` 被当成新用户接受（seed 里已有 `neo@example.com`），
`"  Spacey  "` 原样入库（`@Length` 量的是含空格的原始串）。

**根因**：DTO 只做形状校验，不做**规范化**；唯一性比较是 `user.email === email`（大小写敏感）。

**方案**：规范化放在**入参入口**（DTO 的 `@Transform`），保证「入库的值 = 校验过的值」：

```ts
@Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
@IsEmail()
email: string;

@Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
@IsString() @Length(2, 20) @IsNotReservedName()
name: string;
```

注意**不要**把 trim/lowercase 做成全局管道级行为：webhook 的 `@RawBody()` 载荷、
签名校验用的原始 body 都不能被改写。社区做法就是「DTO 上显式 `@Transform`」（class-transformer 的
`@Transform` 是 DTO 局部语义，天然满足这个边界）。

**验收**：`POST /users` 用大写邮箱打 seed 已占用的地址 → 409；用 `" Neo "` 创建 → 409（trim 后撞 seed）。

---

## 2. P1 · 契约表达力与架构

### 2.1 `errors[].field` 缺「位置」，同名不同源无法区分 🟠

`field: "id"` 到底是 body 的 `id` 还是 path param 的 `id`？现在只能靠调用方猜。
社区标准做法：JSON:API 用 `source.pointer`（body 指针）**和** `source.parameter`（query 参数）分开表达；
RFC 9457 也要求错误明细带机器可读的定位。

**根因**：`exceptionFactory` 只拿到 `ValidationError[]`，**拿不到** `ArgumentMetadata`，而位置信息只在后者里。

**方案**：把「规范化」上移到 `ValidationPipe` 子类（管道手里有 `metadata.type`）：

```ts
// src/contract/validation/contract-validation.pipe.ts
@Injectable()
export class ContractValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata): unknown {
    try {
      return super.transform(value as object, metadata);
    } catch (error) {
      if (error instanceof BadRequestException && metadata.type !== 'custom') {
        throw new BadRequestException(
          withLocation(error.getResponse(), metadata.type), // 'body' | 'query' | 'param'
        );
      }
      throw error;
    }
  }
}
```

`ErrorDetail` 加 `location: 'body' | 'query' | 'param'`（信封 schema 与 `ENVELOPE_COMPONENT_SCHEMAS` 同步，
§2.4 会让这件事只改一处）。这是**兼容性增量**：只加字段、不改语义，`code`（§2.2）一起加最划算。

### 2.2 缺 `code`：文档已自认是「最明显缺口」，建议现在就加 🟠

`docs/validation.md` §9.6 的分析是对的（AIP-193：一旦客户端开始 parse `message`，文案就变成契约）。
补两点**落地建议**：

- 不要直接暴露 class-validator 的约束名（`isInt` / `min` 是库细节，换 Zod 就全变）。
  自定义一套 `ErrorCode` 枚举，在 `exceptionFactory` 里做**约束名 → code** 的映射；
- 业务异常侧加一个基类，让「状态码 / code / 文案」集中一处，现有 `exceptions.ts` 直接升级：

```ts
export class ApiException extends HttpException {
  constructor(readonly code: ErrorCode, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}
export class EmailAlreadyExistsException extends ApiException {
  constructor(email: string) {
    super(ErrorCode.EMAIL_ALREADY_EXISTS, `email ${email} already exists`, HttpStatus.CONFLICT);
  }
}
```

过滤器把 `code` 透出（`ApiErrorBody.code`），OpenAPI 的 `ErrorEnvelope` 加 `code` 枚举
—— 前端就能 `switch (body.code)` 而不是正则匹配文案。**这是本仓库投入产出比最高的一项。**

### 2.3 缺 `traceId`：500 只能靠时间对齐日志 🟠

`docs/validation.md` §9.6 已识别。落地方案二选一：

- 轻量：一个 `RequestIdMiddleware`（读/生成 `x-request-id`，写回响应头）+ `AsyncLocalStorage`
  （社区库 `nestjs-cls`，或自己 20 行）；
- 完整：`nestjs-pino` 接管日志，自动带 `req.id`，`app.useLogger()` 一挂即可。

过滤器把 id 写进 `ApiErrorBody.traceId` 与日志上下文，排障从「按秒猜」变成「按 id 查」。

### 2.4 `ErrorDetail` 的 Swagger 依赖与文档自相矛盾 🟡

事实核查：

- `docs/validation.md` §9.7 与 `envelope.schema.ts` 的注释都写着「契约层保持**零 Swagger 依赖**」；
- 但 `src/contract/validation/error-contract.ts` 第 1 行就是 `import { ApiProperty } from '@nestjs/swagger'`，
  且 `index.ts` 因为装饰器不得不把 `ErrorDetail` 当**值**导出（注释里也承认了）。

后果有两个：契约层被文档工具绑住（与设计原则相反）；`ErrorDetail` 有**两份**定义
（类 + `ERROR_DETAIL_SCHEMA`），正是文档警告的漂移风险，而 e2e 只断言了 `$ref` 字符串、没断言两者一致。

**方案**（选一个，然后把文档改对）：

- **A（推荐，务实）**：承认这层依赖 —— 把 `ErrorDetail` 放进 `RESPONSE_MODELS`，
  让 CLI 插件生成组件，删掉手写的 `ERROR_DETAIL_SCHEMA`；顺带在 e2e 里断言
  `components.schemas.ErrorDetail.properties` 与 `flattenValidationErrors()` 的产出键一致（真正的单一数据源）。
- **B（纯粹）**：`ErrorDetail` 退回 `interface`，schema 只在 `envelope.schema.ts` 手写，
  `index.ts` 改回 `export type`，并在 CI 里加一条「运行时样例 → 校验 schema」的断言。

无论哪条，都要顺手修掉 `docs/validation.md` §9.7 的表述 —— 现在文档在自我矛盾。

### 2.5 `ApiContractModule` 没有 options token / `forRootAsync` 🟡

现在的注释把「选项在调用时被 `useValue` 捕获」当成刻意简化，代价写明了（测试不能 `overrideProvider`）。
但一旦接 `@nestjs/config`（§3.4），`envelope` / `forbidNonWhitelisted` 就该来自环境，`forRootAsync` 是刚需。

**方案**：

```ts
export const API_CONTRACT_OPTIONS = Symbol('API_CONTRACT_OPTIONS');

static forRoot(options: ApiContractOptions = {}): DynamicModule {
  return this.withOptions({ provide: API_CONTRACT_OPTIONS, useValue: options });
}
static forRootAsync(options: AsyncOptions): DynamicModule { /* useFactory + inject */ }
```

关键设计点：**把 `envelope` 的判断从「要不要注册 provider」挪进拦截器内部**
（`if (!this.options.envelope) return next.handle()`）。
这样 `forRootAsync` 才可能实现（静态 providers 列表无法按运行时的值增删），
同时 `overrideProvider(API_CONTRACT_OPTIONS)` 也就可用了 —— 一份改动同时解决两个限制。

### 2.6 Swagger 文档配置被复制了一份，测试测不到真实入口 🟡

`swagger.e2e-spec.ts` 的 `buildDocument()` 自己又写了一遍 `DocumentBuilder`（title / version / tag / extraModels）。
也就是说：`setupSwagger()` 改了 `setDescription` 或 `extraModels`，测试**不会红** —— 而测试的全部意义就是钉住入口。

**方案**：`setup-swagger.ts` 导出 `buildDocument(app, { config })`，`setupSwagger()` 和测试都调它；
测试只保留 `SwaggerModule.setup` 之外的断言。配合 §3.5 的 `openapi.json` 快照，
文档契约从「按名字断言」升级成「按产物断言」。

### 2.7 契约类型无法共享给前端 🟡

`ResponseBody<T>` / `PaginatedResult<T>` / `ErrorBody` 现在只活在服务端仓库里，前端必然手抄一份。
`pnpm-workspace.yaml` 已经在了，但**没有 `packages:`** —— 加一个 workspace 包是顺路的事：

```
packages/api-contract/          # 纯类型 + ErrorCode 枚举，零运行时依赖
  ├── package.json
  └── src/index.ts
```

再配 `openapi-typescript`（或 `orval`）从 `/docs-json` 生成客户端类型，让「信封」这份定义**只有一处**。
社区成熟项目（Nest 官方 starter 之外的多数生产仓）都是这个组合：契约包 + 生成式客户端。

---

## 3. P2 · 工程基座

### 3.1 `tsconfig.json` 没开 `strict` 🟠

实测：打开 `--strict` 后 **37 个错误**，分布如下 —— 不是「一开就炸得没法收拾」，是可以一次做完的量：

| 文件 | 条数 | 主要错误码 |
| --- | --- | --- |
| `__tests__/swagger.e2e-spec.ts` | 13 | TS18048（`document.components` 可能 undefined） |
| `dto/webhook-response.dto.ts` | 6 | TS2564（属性未初始化） |
| `user.dto.ts` | 5 | TS2564 |
| `dto/webhook.dto.ts` / `dto/create-user.dto.ts` | 3 / 3 | TS2564 |
| `swagger/setup-swagger.ts` | 2 | TS18048 |
| `dto/address.dto.ts` / `error-contract.ts` | 2 / 2 | TS2564 |
| `dto/user-id-param.dto.ts` | 1 | TS2564 |

DTO 的 `TS2564` 是**框架惯例**，官方示例用**明确赋值断言 `!`** 解决（`name!: string;`），
不要用 `strictPropertyInitialization: false` 把这层保护整体关掉。`setup-swagger.ts` 那两处
顺手写成 `document.components ??= { schemas: {} }` 就好。

### 3.2 测试体系不完整（且文档有一批失效引用）🟠

- `package.json` **没有 `test` / `test:cov`**，只有 `test:e2e` —— `pnpm test` 直接失败；
- 仓库没有一个单测，但 `docs/nestjs-learning-plan.md` §4 通篇在讲 `src/app.controller.spec.ts`、
  `test/app.e2e-spec.ts`、`package.json` 里的 `jest` 内联配置、`npm run test:cov` —— 这些**都已不存在**；
- `plain-webhook.dto.ts` 第 12 行指向 `src/pipes/__tests__/validation-pipe.factory.spec.ts` —— 文件不存在；
- `user-id-param.dto.ts` 注释说错误 `message` 是 `["id must be an integer number", ...]` ——
  与现行契约（`message` 是概述字符串 + `errors[]`）**相反**；
- `docs/validation.md` §1 说「整个仓库只剩一个测试文件」，§3 又说有两个 —— 自相矛盾。

**方案**：补 `jest.json`（`rootDir: src`、`testRegex: \.spec\.ts$`、`collectCoverageFrom` + **覆盖率阈值**），
`"test": "jest --config ./jest.json"`、`"test:cov": "jest --config ./jest.json --coverage"`。
第一批单测就该是最该被钉住的三件事：`flattenValidationErrors`（含嵌套/多约束）、
`AppExceptionFilter`（§1.3 的数组 message）、`isSwaggerEnabled`（现在是 e2e 顺带测的，应是纯单测）。
然后把上述失效引用一次性清掉 —— 学习仓库里「注释指向不存在的文件」比没有注释更误导。

### 3.3 无 CI 🟠

没有 `.github/workflows/`。最小可用流水线（4 步）：`pnpm install --frozen-lockfile` →
`pnpm lint` → `pnpm build` → `pnpm test:e2e`（加了单测后并联 `test:cov`）。
再补一句 `pnpm format --check`（现在只有写、没有检查），以及 `package.json` 的
`"packageManager": "pnpm@x.y.z"` 固定包管理器版本。

### 3.4 没有配置层 🟠（学习计划 §5.1 的练习项，建议直接做掉）

`main.ts` 硬编码 `3000`；`isSwaggerEnabled(process.env)` 直接读环境；没有 `.env.example`；没有启动期校验。

**方案**：`@nestjs/config` + `registerAs('app', ...)` + `validate`（zod / joi / class-validator 都行）：

```ts
ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true });
// main.ts
const config = app.get(ConfigService);
await app.listen(config.getOrThrow<number>('app.port'));
```

配 `validateEnv` 后，「少了必填环境变量」从「跑到某条路径才 500」变成**启动即失败** ——
这正是学习计划 §5.1 那个练习的价值，也让 §2.5 的 `forRootAsync` 有了真实用例。

### 3.5 生产基本盘（与「已实现模块」直接相关的部分）🟠

实测响应头里**只有 `X-Powered-By: Express`** —— 一个安全头都没有。逐条最小改动：

| 缺口 | 方案 | 备注 |
| --- | --- | --- |
| 缺安全响应头 / 暴露技术栈 | `helmet()`（`app.use`） | 顺手 `app.disable('x-powered-by')` 或卸掉 `X-Powered-By` |
| 无 CORS | `app.enableCors({ origin: [...], credentials: true })` | 白名单来自配置层 |
| 无限流 | `@nestjs/throttler` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` | 429 也要进 `@ApiEnvelopeErrors()` |
| 无优雅退出 | `app.enableShutdownHooks()` | 学习计划 §7.2 的自测题之一 |
| 无统一前缀 / 版本 | `app.setGlobalPrefix('api')` + `enableVersioning({ type: VersioningType.URI })` | 越早做越便宜（前端路径全改） |
| 请求体不设上限 | `NestFactory.create(AppModule, { bodyParser: true })` 后 `json({ limit: '100kb' })` | 默认 100kb 其实已有，但应显式 |
| 无 ETag/条件请求策略 | `CacheInterceptor` 或 `res.setHeader('ETag', ...)` | 与信封的兼容性需实测 |

建议这些**不塞进 `ApiContractModule`**（它只管「请求/响应形状」），而单开一个 `PlatformModule`
（`APP_GUARD` + 中间件 + 全局配置），职责边界更清楚 —— 这也正好是学习计划 §5.8 的落点。

### 3.6 日志仍是默认 `Logger` 🟡

`bootstrap` 的错误处理已经做对了（`Logger.error` + `process.exitCode = 1`，比 starter 强）。缺的是结构化：

- 生产输出 JSON、本地 pretty（`nestjs-pino` 一行搞定）；
- 请求级上下文（与 §2.3 的 `traceId` 是同一件事）；
- 过滤器里 `Unhandled exception on ...` 已带 method + url，建议再加 `requestId` 与 `userId`。

### 3.7 OpenAPI 的长期维护成本 🟡

现在有三处「手工同步」：`RESPONSE_MODELS`、`ENVELOPE_COMPONENT_SCHEMAS`、`jest-swagger-transformer.js`。
已有的**悬空 `$ref` 通用守卫**是很好的兜底，可以再往前一步：

- CI 里把 `GET /docs-json` 落成 `openapi/openapi.json` 提交，用 `openapi-diff` / `oasdiff`
  检测**破坏性变更**（字段删除、类型收紧）—— 这才叫「契约测试」的完整形态；
- 用它生成前端类型（§2.7），把 `ResponseBody<T>` 的手抄风险彻底消灭；
- `swagger.e2e-spec.ts` 现在只断言「8 个路径 / 12 个操作」，可加一条「**每条路由都必须有 2xx 与
  类级失败响应**」的守卫（新加路由忘挂 `@ApiOkEnvelope` 时立刻红）。

---

## 4. P3 · 与学习计划对齐的下一步

| 项目 | 现状 | 建议（含社区参照） |
| --- | --- | --- |
| **Guard / 鉴权** | 完全没有（学习计划 §2.7 未做）；`UserRole` 枚举已存在但无授权 | `@Roles()` + `RolesGuard` + `APP_GUARD` + `@Public()` 白名单（社区标准写法）；401/403 补进失败信封文档与 OpenAPI |
| **持久层** | service 直接持有 `Map`，单例可变状态 | 先抽 `UsersRepository` **端口** + 内存适配器（DI token 注入）。既让单测可 mock，也让后面换 TypeORM/Prisma 时 service 不用改 —— 这是「上 DB」最低成本的前置 |
| **e2e 状态隔离** | 用例共享同一个 app 与内存数据（测试里已用 `>=`、`totalItems >= 2` 之类断言绕开顺序依赖） | 每个 `describe` 重建 app，或 `overrideProvider(UsersRepository)` 注入每个用例的干净实例 |
| **分页** | 见 `docs/validation.md` §7「有意没做」 | 触发条件已写明；上 DB 时**必须**一起做：稳定 tiebreaker（`created_at DESC, id DESC`）、`totalItems` 的 `COUNT` 成本、游标分页。排序方向（`sortBy=name:DESC`）可提前按 nestjs-paginate 的语法对齐 |
| **序列化层** | 无 `ClassSerializerInterceptor` / `@Exclude()` | 一旦出现 `password` / 内部字段就会漏。`docs/nestjs-learning-plan.md` §5.3 的练习，建议提前到有第一个真实资源时做 |
| **`@nestjs/testing` 单测样板** | 只有 e2e | §3.2 的第一批三个单测就是最好的教材 |

---

## 5. 做对了、不要动的地方

写在这里是为了避免「重构时把优点改掉」：

- **`success` 单判据 + 状态码只走 HTTP 状态行** —— 与 RFC 9110 / AIP-193 一致，比「全 200 + `code` 字段」那一派正确；
- **分页用非枚举 symbol 标记**，而不是结构判断 —— 避免领域对象里合法 `data`/`meta` 被误提升，这个设计很讲究；
- **`@RawBody()` 参数级豁免**（而不是 DTO 类型级标记）—— 引用 `toValidate()` 的源码依据，判断准确；
- **`limit` 超上限截断**（AIP-158 coerce down）、**`sortBy` 白名单必填**（nestjs-paginate 同款）、
  **`meta` 不传 `totalPages`** —— 每个都写清了依据，且都经得起推敲；
- **悬空 `$ref` 通用守卫** + **`Object.keys(body).sort()` 精确键集断言** —— 比 `toMatchObject` 强得多，
  是「多一个字段也应该红」的正确做法；
- **`contract` 层内部走具体文件、桶只做门面**，以及那条「`import type` 会让校验静默失效」的实测记录 ——
  这是仓库里最有教学价值的一条；
- **`docs/validation.md` 的 §9.6「有意没做」** —— 把「已知缺口 + 触发条件」写清楚，比假装完备有价值得多。
  本清单只是把它和**没被记录下来的**缺口（§1、§2.4–2.6、§3）合并。

---

## 6. 建议实施顺序（可勾选）

按「风险 ↓ / 成本 ↑」排序，每步都能独立合并、独立验证：

- [ ] **① 修 P0 四件套**（§1.1 幂等信封、§1.2 null 语义、§1.3 过滤器规范化、§1.4 email 规范化）
      —— 验收：新增 4 条 e2e/单测即可回归
- [ ] **② 打开 `strict`**（§3.1，37 处）+ `format --check` + `packageManager` 字段
- [ ] **③ 补 `test` / `test:cov` + 首批单测 + 清掉失效文档引用**（§3.2）
- [ ] **④ 加 CI**（§3.3）：lint → build → test
- [ ] **⑤ 配置层**（§3.4）+ **`forRootAsync`/options token**（§2.5）
- [ ] **⑥ 错误契约升级：`code` + `location` + `traceId`**（§2.1–2.3）—— 一次改动，三处受益
- [ ] **⑦ 平台模块**（§3.5）：helmet / CORS / throttler / shutdown hooks / prefix
- [ ] **⑧ Swagger 单一构建函数 + `openapi.json` 快照 + 破坏性变更检测**（§2.6、§3.7）
- [ ] **⑨ 契约包 + 客户端类型生成**（§2.7）
- [ ] **⑩ 按学习计划推进 Guard / Repository 端口 / 序列化层**（§4）

### 复现本文所有 P0 的命令

```bash
pnpm build && node dist/main &

B=http://localhost:3000/validation-demo

# §1.2 null 击穿（返回 tags:null）
curl -s -X PATCH $B/users/1 -H 'content-type: application/json' -d '{"tags":null}'

# §1.4 大小写绕过唯一性（应 409，实为 201）与空格入库
curl -s -X POST $B/users -H 'content-type: application/json' \
  -d '{"name":"Upper","email":"NEO@EXAMPLE.COM","role":"viewer"}'
curl -s -X POST $B/users -H 'content-type: application/json' \
  -d '{"name":"  Spacey  ","email":"spacey@example.com","role":"viewer"}'

# §3.5 无安全头
curl -s -D - -o /dev/null $B/users/1 | grep -i x-powered

# §1.1 与 §1.3 由 src/__tests__ 里的探针复现（见正文代码片段）
```

---

## 附：社区对照来源

| 主题 | 参照 |
| --- | --- |
| 错误契约 / `code` / `traceId` | [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.txt)、[Google AIP-193](https://google.aip.dev/193)、[JSON:API errors](https://jsonapi.org/format/#error-objects) |
| 分页上限与 coerce down | [Google AIP-158](https://google.aip.dev/158) |
| 分页字段命名与排序白名单 | [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate) |
| 状态码语义 / 可启发式缓存 | [RFC 9110 §15](https://www.rfc-editor.org/rfc/rfc9110.html) |
| 全局增强器的注册与幂等 | Nest 官方 [Exception filters](https://docs.nestjs.com/exception-filters) / [Interceptors](https://docs.nestjs.com/interceptors)、`@nestjs/throttler`、`nestjs-pino` |
| 配置校验 / 启动即失败 | Nest [Configuration](https://docs.nestjs.com/techniques/configuration)、`nestjs-zod` |
| 契约产物与破坏性变更检测 | `openapi-typescript`、`orval`、`oasdiff` |
| 安全响应头 | [Helmet](https://docs.nestjs.com/security/helmet)、[Rate limiting](https://docs.nestjs.com/security/rate-limiting) |
