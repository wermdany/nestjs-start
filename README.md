# nestjs-start

一个精简的 NestJS 起步仓库：**配置 + 入参校验 + 统一响应契约 + 分页 + OpenAPI 文档**一次配好，
`main.ts` 里几乎不写全局配置。

```bash
pnpm install            # 直接跑即可
cp .env.example .env    # 可选：不建也能跑（一切都有默认值）
pnpm start:dev          # http://localhost:3000 ，文档在 /docs
pnpm test:e2e           # 契约测试（响应形状 + 权限 + OpenAPI 文档 + 配置校验）
pnpm test               # 单元测试（判定逻辑与纯函数，jest.json）
```

启动时会打一行**不含任何密码、也不含任何 token**的配置摘要（本身就是一条结构化日志），
并标出哪些配置还是"预留"状态：

```
[bootstrap] env=development port=3000 host=(默认: 全部网卡) swagger=on(http://localhost:3000) jwt=expires:1h,secret:(默认) log=debug,file=logs/app.log cors=* throttle=60s/100 db=memory(预留)
```

环境变量不合法 → **进程拒绝启动**，并一次性列出全部问题（无堆栈）：

```
[bootstrap] ERROR 配置校验失败，进程不会启动：
  - PORT: PORT 必须是 1..65535 之间的整数（收到 "abc"）
```

## 一行接入

```ts
// src/app.module.ts
@Module({
  imports: [
    AppConfigModule,                     // 配置：加载 .env + 七个类型化 namespace
    ApiContractModule.forRootAsync(...),  // 契约：管道 / 过滤器 / 拦截器 / 请求 id
    AuthModule.forRootAsync(...),         // 认证：JWT 登录 + 全局守卫（密钥来自 JWT_SECRET）
    PlatformModule.forRootAsync(...),     // 平台：限流守卫（+ 提供给入口的 CORS 选项）
    ValidationDemoModule,
  ],
})
export class AppModule {}
```

`ApiContractModule`（住在 `src/http-enhancers.module.ts`）一次挂三个全局增强器（`APP_PIPE` / `APP_FILTER` / `APP_INTERCEPTOR`）
加一个请求 id 中间件，所以**不需要** `app.useGlobalPipes()` / `useGlobalFilters()` / `app.useGlobalInterceptors()`。

| 能力 | 实现 | 干什么 |
| --- | --- | --- |
| 配置 | `AppConfigModule` | `.env` 加载 + **启动即校验**；七个 namespace：`app` / `swagger` / `cors` / `throttle` / `jwt` / `log` / `database`（只有 `database` 是预留） |
| 入参校验 | `ContractValidationPipe` → `APP_PIPE` | body / query / param 全过 `ValidationPipe`（`whitelist` + `transform`），错误是结构化的，且每条明细带 `location` |
| 失败响应 | `AppExceptionFilter` → `APP_FILTER` | 400 / 401 / 403 / 404 / 409 / **429** / 500 统一成同一个形状；连**别人抛的**数组型 `message` 也规范化；内部异常只回通用文案，堆栈只进日志；异常自带的响应头（如 `WWW-Authenticate`）在 `json()` 之前写出 |
| 成功响应 | `ResponseEnvelopeInterceptor` → `APP_INTERCEPTOR` | 所有成功返回值包成同一个形状，分页的 `meta` 提到顶层；**幂等**（模块被 import 多次也不会套两层） |
| 认证 | `AuthModule`（`JwtAuthGuard` → `APP_GUARD`） | 登录签发 JWT（内存用户表），**默认拒绝**：`@Public()` 之外的所有路由都要 `Authorization: Bearer`，否则 401 + `WWW-Authenticate`；token 里只有身份，没有角色 / 权限 |
| 限流 | `PlatformModule`（`ThrottlerGuard` → `APP_GUARD`） | 窗口内允许 `THROTTLE_LIMIT` 次，超出 429（形状同其它失败）+ `Retry-After` / `X-RateLimit-*`；**排在认证守卫之后** ⇒ 未认证优先得到 401 |
| CORS | `PlatformModule` → `main.ts` 的 `app.enableCors()` | 来源来自 `CORS_ORIGINS`；白名单模式带凭证、通配模式不带（浏览器规范禁止两者共存）；`x-request-id` 与限流响应头进 `Access-Control-Expose-Headers` |
| 业务异常 | `ApiException` | 把「文案 + HTTP 状态码 + 可选响应头」集中一处；⚠️ **不带错误码**（见 §"响应契约"的取舍说明） |
| 可观测 | `RequestIdMiddleware` | 每个请求一个 id：`AsyncLocalStorage` + `x-request-id` 响应头 + 失败信封的 `traceId`；认证成功后 `userId` 进同一个上下文 |
| 日志 | `LoggingModule`（`AppLogger`） | 接管 Nest 全局 logger：NDJSON、自动带 `traceId`/`userId`、敏感值脱敏、访问日志（状态码决定级别），并**写入本地滚动文件** `logs/app.log` |
| 参数级豁免 | `@RawBody()` | 同一条路由跳过整个管道（同一个 DTO 在别处照常校验） |
| 可选非空 | `@IsOptionalNotNull()` | 可以不传，但显式传 `null` 会被拒（`@IsOptional()` 会放行 `null`，见 §"响应契约"） |
| 接口文档 | `setupSwagger(app, options)` → `@nestjs/swagger` | `/docs` 上的 OpenAPI UI，schema 由 DTO 上的 class-validator 推导；`buildDocument()` 是唯一构建入口 |
| 逃生门 | `@NoEnvelope()` | 这条路由不套响应信封 |
| 分页 | `src/system/pagination/` | 跨业务复用：`PaginationQueryDto` / `createPaginationQueryDto()` / `buildPaginatedResult()` |

选项透传（校验选项平铺在顶层）：

```ts
ApiContractModule.forRoot({ forbidNonWhitelisted: true }); // 多余字段直接 400
ApiContractModule.forRoot({ envelope: false });            // 不要响应信封
```

选项走 `API_CONTRACT_OPTIONS` 这个 DI token（不再是调用时 `useValue` 死值），所以配置能从
`ConfigService` 来、测试里也能 `overrideProvider(API_CONTRACT_OPTIONS)` 换掉：

```ts
ApiContractModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    forbidNonWhitelisted: config.get('app.strictValidation'),
    envelope: config.get('app.envelope'),
  }),
});
```

重复 import 是**安全**的（信封幂等、请求 id 幂等），但仍然建议只在 `AppModule` 里 import 一次
（否则校验管道会多跑一遍）。

## 响应契约

**body 里只放 HTTP 层给不了的东西**：数字状态码留在 HTTP 状态行，`success` 判断成败，`error` 是失败的大类。

| 字段 | 恒有？ | 内容 |
| --- | --- | --- |
| `success` | 是 | **唯一判据**。`true` 必有 `data`，`false` 必有 `error` + `message` |
| `data` | 仅成功 | handler 的返回值；分页时是**这一页的数据数组** |
| `meta` | 仅成功、仅有元数据时 | 分页元信息：`totalItems` / `itemsPerPage` / `currentPage`（没有 `totalPages` —— `Math.ceil` 客户端自己算） |
| `error` | 仅失败 | HTTP 状态短语（`Bad Request` / `Not Found` …）—— **失败侧唯一的大类判据** |
| `traceId` | 仅失败（真实请求里恒有） | 请求 id，同时回写在 `x-request-id` 响应头、并进日志 |
| `message` | 仅失败 | 人类可读说明（成功文案由前端自己出，后端不下发） |
| `errors` | 仅失败、仅有明细时 | `{ field, location?, message }[]`，`field` 是权威定位（嵌套用点号 `address.city`） |

数字状态码不放 body：前端读 `res.status`（axios 是 `error.response.status`）即可，
这样就不存在"body 里的状态码和状态行不一致"的可能。

### ⚠️ 失败响应**没有** `code`（刻意的取舍，务必知道代价）

本仓库曾经有一个机器可读的 `code`（`VALIDATION_FAILED` / `USER_NOT_FOUND` …），**已移除**。
于是失败响应的大类判据只剩 `error`（HTTP 状态短语）。

**代价是真实的**：同一个状态码下的不同失败原因**不再可机器区分**。例如：

```bash
$ curl -s localhost:3000/validation-demo/users/999999   # 业务 404
{"success":false,"error":"Not Found","message":"user 999999 not found","traceId":"…"}

$ curl -s localhost:3000/nope                            # 路由 404（框架抛的）
{"success":false,"error":"Not Found","message":"Cannot GET /nope","traceId":"…"}
```

两个响应**结构完全相同**，只剩 `message` 文案不同 —— 而让客户端 parse 文案，
正是这份文档一直在警告的反模式（文案可改、可 i18n，一改就是破坏性变更）。

所以现在的约定是：**业务侧要让 `message` 尽量说清楚是哪一种失败**，
并且**不要把 `message` 当作稳定的机器契约**。若将来重新需要区分能力，
加回的是 `code` 这个字段，**不要**靠约定 `message` 前缀。

`errors[]` 里的 `field` / `location` 仍然是结构化的 —— 表单回填这类场景照旧可靠，
它们不受这次删除影响：

```ts
// 前端：所有失败都有 message 与 error
if (!body.success) {
  toast(body.message);
  mapFields(body.errors);   // 只有校验类失败才有 errors；field + location 可精确定位
  return;                   // 想要更强的区分能力，得先给后端加回 code
}
use(body.data);              // 成功一定有 data
```

实测输出（`pnpm start:dev` 之后直接 curl）：

```bash
# 成功 · 单个资源 → HTTP 200
$ curl -s localhost:3000/validation-demo/users/1
{"success":true,"data":{"id":1,"name":"Neo","email":"neo@example.com","age":30,"role":"admin","tags":["founder"]}}

# 成功 · 分页 → HTTP 200（data 是数组，meta 在顶层，不会出现 data.data）
$ curl -s 'localhost:3000/validation-demo/users?limit=999'
{"success":true,"data":[...],"meta":{"totalItems":3,"itemsPerPage":50,"currentPage":1}}

# 失败 · 校验 → HTTP 400（errors[].field 可直接映射到表单，location 说明来自 body/query/param）
$ curl -s -X POST localhost:3000/validation-demo/users -H 'content-type: application/json' -d '{"name":"x"}'
{"success":false,"error":"Bad Request","message":"Request validation failed","traceId":"…","errors":[{"field":"name","message":"name must be longer than or equal to 2 characters","location":"body"}]}

# 失败 · 业务 → HTTP 404（没有 errors 键）
$ curl -s localhost:3000/validation-demo/users/999999
{"success":false,"error":"Not Found","message":"user 999999 not found","traceId":"…"}

# 失败 · 框架（未匹配路由）→ HTTP 404（与业务 404 结构相同，见上面的取舍说明）
$ curl -s localhost:3000/nope
{"success":false,"error":"Not Found","message":"Cannot GET /nope","traceId":"…"}

# 成功 · 登录 → HTTP 200（内存里的演示账号；token 里只有 sub + username）
$ curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"username":"neo","password":"matrix"}'
{"success":true,"data":{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":3600}}

# 失败 · 未认证 → HTTP 401（响应头另有 WWW-Authenticate: Bearer …；头不受 code 删除影响）
$ curl -s -i localhost:3000/auth/profile
{"success":false,"error":"Unauthorized","message":"Missing or malformed credentials","traceId":"…"}

# 失败 · 限流 → HTTP 429（需 THROTTLE_LIMIT=3；响应头另有 Retry-After 与 X-RateLimit-*）
#   形状与其它失败**完全一致**：它同样是"一个信封"，不是另一套错误格式
$ for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code} ' localhost:3000/validation-demo/users/1; done
200 200 200 429 429
$ curl -s localhost:3000/validation-demo/users/1
{"success":false,"error":"Too Many Requests","message":"Too many requests, please try again later","traceId":"…"}
```

两个**必须知道的边界**：

- **`@IsOptional()` 会放行 `null`**（官方语义是"null 或 undefined 时跳过该字段所有校验"）。
  想要"可以不传、但传了不能是 null"用 `@IsOptionalNotNull()`；`PartialType` 派生 Update DTO 时
  要显式传 `{ skipNullProperties: false }`，否则 PATCH 又能塞 `null` 进来。
- **`traceId` 在 body 解析失败时缺席**：请求 id 中间件跑在 body-parser 之后，
  畸形 JSON 的 400 拿不到 id（响应头也没有）。所以它在 schema 里是可选字段。

完整规则、边界（`@Render()` / `@Redirect()` / `@Sse()` / `StreamableFile` / 空返回值 / `@NoEnvelope()`）
以及取舍依据见 [`docs/validation.md`](docs/validation.md) §9。

## 配置

一个入口、一份契约、**启动即校验**。`src/config/` 把环境变量收敛成七个类型化 namespace：

```ts
const app = config.getOrThrow<AppConfig>('app');            // { env, port, host?, strictValidation, envelope }
const jwt = config.getOrThrow<JwtConfig>('jwt');            // { secret, expiresIn }
const log = config.getOrThrow<LogConfig>('log');            // { level, toFile, dir, file, maxBytes, maxFiles, pretty }
const db = config.getOrThrow<DatabaseConfig>('database');   // { driver, url?, host?, port?, ... }
```

| namespace | 变量 | 状态 |
| --- | --- | --- |
| `app` | `NODE_ENV` / `PORT` / `HOST` / `STRICT_VALIDATION` / `ENABLE_ENVELOPE` | ✅ `main.ts` 用它监听，`app.module.ts` 用它配契约层 |
| `swagger` | `ENABLE_SWAGGER` / `SWAGGER_SERVER_URL` | ✅ `main.ts` 用它开关 `/docs` |
| `jwt` | `JWT_SECRET` / `JWT_EXPIRES_IN` | ✅ `app.module.ts` → `AuthModule`（**生产环境没配密钥或仍用默认值 = 拒绝启动**） |
| `log` | `LOG_LEVEL` / `LOG_TO_FILE` / `LOG_DIR` / `LOG_FILE` / `LOG_MAX_BYTES` / `LOG_MAX_FILES` | ✅ `LoggingModule`（测试环境默认 `warn` + 不落盘） |
| `cors` | `CORS_ORIGINS` | ✅ `PlatformModule` → `main.ts` 的 `app.enableCors()`（**生产环境用 `*` = 拒绝启动**） |
| `throttle` | `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | ✅ `PlatformModule` → 全局 `ThrottlerGuard`（超限 429 + `Retry-After`） |
| `database` | `DATABASE_DRIVER` / `_URL` / `_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` / `_SCHEMA` / `_SSL` / `_POOL_SIZE` / `_LOGGING` / `_SYNCHRONIZE` / `_MIGRATIONS_RUN` | 🅿️ 预留（B1 接 ORM） |

三条规矩：

- **默认值只有一处**：都定义在 `src/config/env.ts` 的导出常量里，校验器与读取函数共同 import；
  `validateEnv()` 只判断"给了的值"，不注入默认值。
- **可选的 `null` 不放过**：`DATABASE_*` 的布尔项只认恰好 `true` / `false`，写 `yes` 直接启动失败。
- **敏感值不落地**：`redactUrl()` 抹掉连接串里的用户名/密码；JWT 密钥在启动摘要里只以
  `secret:(默认｜已配置)` 出现（`jwt=expires:1h,secret:(默认)`），密钥本身永不进日志。

配置**真的会被用上**（不是摆设）—— 四个已接线的消费者：

```ts
// src/app.module.ts：环境变量 → 契约层选项
ApiContractModule.forRootAsync({
  inject: [ConfigService],
  useFactory: apiContractOptionsFactory,   // STRICT_VALIDATION → forbidNonWhitelisted
});                                        // ENABLE_ENVELOPE   → envelope

// src/app.module.ts：环境变量 → 认证层选项（凭证表）
AuthModule.forRootAsync({
  inject: [ConfigService],
  useFactory: jwtOptionsFactory,           // JWT_SECRET / JWT_EXPIRES_IN → JwtModule
});

// src/app.module.ts：环境变量 → 平台层选项（限流守卫 + CORS 选项）
PlatformModule.forRootAsync({
  inject: [ConfigService],
  useFactory: platformOptionsFactory,      // THROTTLE_* → ThrottlerModule
});                                        // CORS_ORIGINS → app.enableCors()

// src/main.ts：环境变量 → 监听端口 / 文档启停 / CORS 来源
await app.listen(resolved.app.port, resolved.app.host);
setupSwagger(app, { enabled, serverUrl });
app.enableCors(resolvePlatformOptions(app).cors);
```

实测：`ENABLE_ENVELOPE=false` 时 `GET /users/1` 返回裸对象（失败响应不受影响）；
`STRICT_VALIDATION=true` 时多带一个字段就 400；
`THROTTLE_LIMIT=3` 时同一条公开路由第 4 次返回 429（带 `Retry-After: 60`）。

`database` 目前**没有消费者**（名字后面的 🅿️ 就是这个意思）；
`cors` / `throttle` 曾经也在那个名单里，现在由 `src/platform/` 消费。
`database` 虽然还没接，但**连接契约已经定好了**（`url` 优先、`port` 按驱动补默认值、
`synchronize` 生产禁用、`password` 永不进日志）—— B1 落地时直接照做，不必重新讨论。

> 有一个**无法**配置化的地方值得说明：分页的 `PAGE_SIZE_DEFAULT` / `PAGE_SIZE_MAX`
> （`src/system/pagination/`）在**装饰器里求值**，是编译期常量 —— 要改成配置驱动
> 得先重构分页 DTO 的生成方式（把静态类换成按配置构造的工厂），收益不值这个复杂度。

完整变量表、致命/告警规则、以及"为什么不走 `ConfigModule.forRoot({ validate })`"见
[`docs/configuration.md`](docs/configuration.md)。

## OpenAPI / Swagger

启动后打开 <http://localhost:3000/docs>（UI）；原始文档：<http://localhost:3000/docs-json>。

| `ENABLE_SWAGGER` | `NODE_ENV` | `/docs` |
| --- | --- | --- |
| `true` | 任意 | **开**（强制） |
| `false` | 非 production | 关 |
| 未设 | `production` | **关**（默认不暴露接口全貌） |
| 未设 | 其它 / 未设 | **开**（本地开发直接可用） |

只认恰好 `'true'` / `'false'`，`'1'` 之类的含糊真值不算数（避免 `Boolean('false') === true` 这种经典坑）。
关掉时 `/docs` 不注册，访问会落到标准的 404 失败信封。

**schema 与校验同源**：`nest-cli.json` 里挂了 `@nestjs/swagger` 的 CLI 插件，
DTO 的 `@Length` / `@IsEmail` / `@Min` / `@IsEnum` 与 `/** */` 注释会自动变成 schema 的
`minLength` / `format` / `minimum` / `enum` / `description` —— 不用手抄一遍校验规则。

少数地方仍然**显式**写（枚举、分页参数、契约层的信封）—— 原因见
[`docs/validation.md`](docs/validation.md) §9.7。

**控制器里只留业务语义**：信封 / `$ref` / 状态码的拼装全在 `src/swagger/`，所以每条路由只写一行响应装饰器：

```ts
@Post('users')
@ApiOperation({ summary: '创建用户（body 走全局校验管道）' })
@ApiCreatedEnvelope(UserDto, '创建成功')   // { success: true, data: UserDto }
@ApiEnvelopeConflict()
create(@Body() dto: CreateUserDto) { return this.users.create(dto); }
```

示例只挂在 DTO 字段上（`@ApiProperty({ example })`），不在控制器里抄 —— 抄的示例会在改名后漂移。

e2e 里也能拿到同样的 schema：`jest-e2e.json` 给 ts-jest 挂了一个 AST 变换桥
（仓库根 `jest-swagger-transformer.js`），否则测试中生成的文档会比构建产物"瘦"一圈。

> 那个 `jest-swagger-transformer.js` 是给 jest 加载的 CommonJS 桥，故意不进 TS 项目，
> 所以 `eslint.config.mjs` 的 `ignores` 里把它和 `dist/**` 一起排除了 ——
> 否则编辑器里的 ESLint 扩展（它按 ESLint 自身规则 lint 全仓库，而不是只扫 `src/**/*.ts`）
> 会为这些"不属于 tsconfig 项目"的文件报 `not found by the project service`。

## 安装

```bash
pnpm install       # 直接跑即可
```

三个曾经踩过的坑（现在都已在本仓库里修掉，换机器时留意）：

**① `ERR_PNPM_IGNORED_BUILDS`：`allowBuilds` 的值必须是布尔**

`@nestjs/swagger` 的传递依赖 `@scarf/scarf` 带 `postinstall`。`pnpm approve-builds` 会往
`pnpm-workspace.yaml` 写一条**占位符**：

```yaml
allowBuilds:
  '@scarf/scarf': set this to true or false   # ← 占位符，pnpm 不接受
```

pnpm 的 `createAllowBuildFunction()` 只对 `true` / `false` 建规则，其它值一律**静默忽略**，
于是这个包一直处于"未授权"状态，`pnpm install` 以 `ERR_PNPM_IGNORED_BUILDS` 失败。
本仓库显式写成 `false`（scarf 只是匿名统计上报，与功能无关，拒绝它顺带关掉上报）。

**② `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`**

删 `node_modules` 重新链接时 pnpm 会弹确认，拿不到 TTY 就中断。本仓库在
`pnpm-workspace.yaml` 里设了 `confirmModulesPurge: false`；临时遇到也可以 `CI=true pnpm install`。

> 历史上还遇到过 `ERR_PNPM_UNEXPECTED_STORE`（lockfile 按主目录 store 解析、pnpm 默认用项目内 store）。
> 现在 `pnpm-workspace.yaml` 同目录的 `.pnpm-store/` 已是**项目内 store**，直接 `pnpm install` 即可；
> 真需要指定就加 `--store-dir <path>`。

**③ `@nestjs/config` 必须停在 4.x（12.x 是 ESM-only）**

```bash
pnpm add '@nestjs/config@^4.0.4'      # ✅ 根目录 index.js 是 CJS
pnpm add '@nestjs/config'             # ❌ 会装 12.0.0 → type: module → TS1479
```

本仓库是 CJS（`module: nodenext`、`package.json` 里没有 `"type": "module"`），
而 `@nestjs/config` 在 **12.0.0** 换成了 `"type": "module"` + 只有 `import` 条件的 `exports`
—— 直接 import 会编译失败（`TS1479: ... referenced file is an ECMAScript module`）。
版本列表里 4.0.4 之后直接跳到 12.0.0（没有 5–11），所以要显式锁 `^4.0.4`。
等本仓库迁到 Nest 12 + ESM 时，这个约束才会解除。

> 同样的道理：`helmet` 是**运行时**依赖，必须留在 `dependencies`（曾经误放进 `devDependencies`，
> 结果 `pnpm install --prod` 后 `node dist/main` 会 `Cannot find module 'helmet'`）。

## 目录结构

```
logs/                             运行时产物：app.log（活动）+ app.1.log…（滚动），已被 .gitignore 忽略

openapi/openapi.json              `pnpm openapi:export` 的产物（提交进仓库，供 diff / 破坏性变更检测）

scripts/                          ★ 构建期脚本：与 src/ 同级，**不属于运行时 HTTP 服务**
├── export-openapi.ts             pnpm openapi:export → openapi/openapi.json
└── tsconfig.json                 脚本自己的 project（为什么需要它见文件内注释）

src/
├── main.ts                       入口（校验 env → create → helmet → CORS → 关闭钩子 → 文档 → listen）
├── app.module.ts                 组装：AppConfigModule + ApiContractModule + LoggingModule + AuthModule + 业务模块 + PlatformModule
├── http-enhancers.module.ts      ★ ApiContractModule：APP_PIPE / APP_FILTER / APP_INTERCEPTOR + 请求 id 中间件
│                                 （跨模块的组合职责，所以住在 src/ 根而不是 system/ 里）
│
├── system/                       ★ 系统级模块：全部平铺，越靠前越底层（详见下表）
│   ├── http-contract/            ⬇ 第 1 层｜零依赖叶子：线上形状（纯类型 + ERROR_LOCATIONS）
│   │   └── index.ts              成功 / 失败响应体、分页元信息、ErrorDetail —— 不 import 任何东西
│   ├── request-context/          ⬇ 第 1 层｜零依赖叶子（只依赖 node:async_hooks）
│   │   ├── request-context.ts    AsyncLocalStorage：getRequestId() / setRequestUserId()
│   │   └── request-id.middleware.ts  x-request-id 生成/沿用 + 幂等
│   ├── http-response/            ⬇ 第 2 层｜依赖 http-contract
│   │   ├── response-contract.ts  ENVELOPED / PAGINATED_RESULT 两个标记
│   │   ├── response-envelope.interceptor.ts
│   │   ├── is-enveloped.ts       ← 幂等：已经包过就不包第二次
│   │   ├── is-paginated-result.ts
│   │   └── no-envelope.decorator.ts  @NoEnvelope()
│   ├── http-validation/          ⬇ 第 2 层｜依赖 http-contract + request-context
│   │   ├── validation-pipe.factory.ts      默认开关 + createValidationPipe()
│   │   ├── contract-validation.pipe.ts     给每条明细补 errors[].location
│   │   ├── validation-exception.factory.ts 校验错误 → { message, errors[] }
│   │   ├── http-exception.filter.ts        失败响应统一形状（含数组型 message 规范化 + 异常响应头）
│   │   ├── api-exception.ts                业务异常基类（message + status + headers?）
│   │   ├── is-optional-not-null.decorator.ts  @IsOptionalNotNull()
│   │   ├── raw-body.decorator.ts           @RawBody()
│   │   └── is-not-reserved-name.validator.ts
│   └── pagination/               ⬇ 第 3 层｜依赖 http-validation + http-response
│       ├── pagination-query.dto.ts         PaginationQueryDto + createPaginationQueryDto()
│       └── paginated-result.ts             buildPaginatedResult()
│
├── config/                       ★ 配置层，对外只有 index.ts 一个入口
│   ├── env.ts                    变量名/默认值常量 + 类型转换 + 校验类 + validateEnv + 告警
│   ├── app.config.ts             app namespace（env / port / host / 两个契约开关）
│   ├── swagger.config.ts         swagger namespace（复用 isSwaggerEnabled 的规则）
│   ├── platform.config.ts        cors + throttle namespace（消费者：src/platform/）
│   ├── jwt.config.ts             jwt namespace（JWT_SECRET / JWT_EXPIRES_IN）
│   ├── log.config.ts             log namespace（LOG_LEVEL / LOG_TO_FILE / …）
│   ├── database.config.ts        database namespace（🅿️ 预留，含连接契约）
│   ├── describe-config.ts        readResolvedConfig / formatConfigSummary / redactUrl
│   └── app-config.module.ts      AppConfigModule + env 文件选择
├── auth/                         ★ 认证层（JWT），对外只有 index.ts 一个入口
│   ├── auth.module.ts            forRoot / forRootAsync（包 JwtModule）+ 全局 APP_GUARD
│   ├── auth-options.ts           AuthOptions（就是 JwtModuleOptions）/ AuthAsyncOptions
│   ├── auth.controller.ts        POST /auth/login（@Public）+ GET /auth/profile（受保护）
│   ├── auth.service.ts           校验凭证 → 签发 JWT
│   ├── users.service.ts          内存用户表（两个演示账号）+ 常量时间密码比较
│   ├── jwt-auth.guard.ts         认证守卫（fail-closed，@Public() 白名单）
│   ├── jwt-payload.ts            JwtPayload 类型 + isJwtPayload() + lifetimeSecondsOf()
│   ├── decorators/               @Public() / @CurrentUser()
│   ├── exceptions.ts             401（+ WWW-Authenticate）
│   ├── api-docs.ts               AUTH_DOCS：本模块的 tag + 响应模型自描述
│   └── dto/                      LoginDto / LoginResponseDto / ProfileDto
├── observability/                ★ 日志：全局 logger + 访问日志 + 本地滚动文件
│   ├── logging.module.ts         LoggingModule（安装 logger、挂访问日志、关闭时 flush）
│   ├── install-logger.ts         installLogger()：overrideLogger + 进程级兜底（幂等）
│   ├── app-logger.ts             AppLogger（LoggerService）：stdout + 文件双写、自动带 traceId/userId
│   ├── log-line.ts               纯函数：级别过滤 / 行构建 / 脱敏 / 序列化
│   ├── log-file.writer.ts        滚动写入器（串行、按大小或跨天、保留 N、失败降级）
│   └── request-log.middleware.ts 访问日志（method/url/status/durationMs）
├── swagger/                      OpenAPI 投影（**零业务依赖**、契约层保持零 Swagger 依赖）
│   ├── api-docs.module.ts        ApiDocsModule.forRootAsync() + apiDocsOptionsFactory（配置+业务自描述 → 选项）
│   ├── api-docs.options.ts       API_DOCS_OPTIONS token / ApiDocsOptions / FeatureDocs / resolveApiDocsOptions()
│   ├── setup-swagger.ts          buildDocument(app, options) + setupSwagger(app, options)：/docs、/docs-json
│   ├── is-swagger-enabled.ts     启停规则（纯函数；被 src/config/ 单向引用）
│   ├── envelope.schema.ts        响应信封在 OpenAPI 里的表示（唯一手写处）
│   ├── api-envelope.decorator.ts @ApiOkEnvelope() / @ApiCreatedEnvelope() —— 成功响应一行
│   └── api-errors.decorator.ts   @ApiEnvelopeErrors() / @ApiEnvelopeConflict() / @ApiEnvelopeUnauthorized()
├── platform/                     ★ 平台层：与业务无关、但每个请求都过的基础设施
│   ├── platform.module.ts        PlatformModule.forRoot / forRootAsync：ThrottlerModule + 全局 APP_GUARD
│   └── platform.options.ts       PLATFORM_OPTIONS token + 配置→选项投影（CORS 政策、秒→毫秒）
└── modules/
    └── validation-demo/          活文档：内存版 users 资源，把每种校验行为都跑一遍
        ├── validation-demo.controller.ts
        ├── validation-pipe-order.controller.ts
        ├── validation-demo.service.ts
        ├── api-docs.ts           VALIDATION_DEMO_DOCS：本模块的 tag + 响应模型自描述
        ├── user.dto.ts           响应模型 UserDto（= 原来的 User interface）
        ├── exceptions.ts         具名业务异常（继承 ApiException，文案 + 状态码集中一处）
        └── dto/
```

`src/system/` 的**层级方向**（单向，靠目录顺序表达）：

```
http-contract  request-context      ← 零依赖叶子
      ↓              ↓
http-response   http-validation     ← 只依赖叶子
      ↓              ↓
      pagination                    ← 依赖 http-validation + http-response
      ↓
http-enhancers.module.ts            ← 组合三个增强器（住 src/ 根）
      ↓
app.module.ts → 业务模块
```

> 为什么 `request-context` 必须独立成叶子：它被 `observability`（日志要自动带 `traceId`）
> 和 `http-validation`（失败信封要填 `traceId`）**同时**需要。曾经它被放在
> `contract/observability/` 并与日志模块同名，导致两者互相引用（成环）。
> 提成独立底座后方向变单向。**不要**把它合并回 `src/observability/`。

约定：

- **模块内部互相引用走具体文件**，绝不走桶 —— 桶永远不参与循环依赖。
- 消费方按需走**精确子桶**：`import { ApiException } from '@/system/http-validation'`、
  `import { buildPaginatedResult } from '@/system/pagination'`。
- **子桶只做显式具名导出，不用 `export *`** —— 它会在同名时静默遮蔽，且暴露面失控。
- **绝不对 DTO / 模块写 `import type`**：类型导入会被运行时擦除，`emitDecoratorMetadata` 只能发出 `Object`，
  而 `Object` 在 `ValidationPipe` 的跳过名单里 —— 校验会**静默失效**（400 变 201，无任何报错）。详见 docs §8。
- `src/system/http-contract/` 只管**线上形状**（纯类型，零依赖）；运行时行为在
  `http-response` / `http-validation`；OpenAPI 投影一律放 `src/swagger/`。
- **`src/swagger/` 不认识任何业务**：响应模型（`responseModels`）与标签（`tags`）由**业务模块自己**
  在 `<module>/api-docs.ts` 里以 `FeatureDocs` 描述，由 `app.module.ts` 的 `FEATURE_DOCS` 注入
  `ApiDocsModule`。所以新增一个业务模块**不需要改 `src/swagger/` 的任何文件** ——
  只加一行 `FEATURE_DOCS`（追加到**末尾**：数组顺序会带进 `components.schemas` 与顶层 `tags` 的顺序）。
- **线上形状只在 `src/system/http-contract/` 定义一次**（本项目是纯后端，不再有跨仓库共享包）。
- **`config` / `http-*` / `auth` / `platform` 互不认识**：它们都只被 `app.module.ts` 的工厂函数粘起来，
  所以每个都能单独 import 进测试模块（`src/auth/` 里没有一行 `@/config`；
  `src/platform/` 只认识 `config`，不认识任何业务）。
  唯一的方向例外是 `config → swagger/is-swagger-enabled`（一个不 import 任何东西的纯函数）。
- **平台层与契约层刻意分开**：`http-enhancers.module.ts` 管「请求/响应**形状**」，
  `src/platform/` 管「请求**能不能进来、进多快**」（限流 / CORS）。混在一起会让
  "只想改响应格式"的人碰到限流策略。两者的 `APP_GUARD` 顺序也有语义：
  `PlatformModule` 在 `app.module.ts` 里排在 `AuthModule` **之后** ⇒ 未认证 + 超限得到 401 而不是 429
  （代价是"匿名刷受保护路由"不计入限流，见 `src/platform/platform.module.ts` 的注释）。
- **测试已全部删除**（见 §"测试"）—— 原本"文档级不变量在 `src/swagger/__tests__/`"这条约定
  暂时悬空，补回测试时按同一归属原则放。

> 上面这几条**声明**可以用一组 `grep` 守卫机器验证（含"契约层零 Swagger 依赖"），
> 见 [`docs/architecture-review.md`](docs/architecture-review.md) §6。

## 线上形状定义在哪（原「共享契约包」）

**本项目是纯后端**：曾经有一个 `packages/api-contract` 的 pnpm workspace 包（前后端共享的纯类型契约），
已随后端化改造**删除**。它的内容全部内联到了：

```
src/system/http-contract/index.ts     ← 成功/失败响应体、分页元信息、ErrorDetail、ERROR_LOCATIONS
```

它是**零依赖叶子**：只有类型 + 一个 `ERROR_LOCATIONS` 常量与 `isErrorLocation()`，
不 import 任何东西 —— 所以任何层都可以引用它而不产生方向问题。

为什么内联（而不是继续留着包）：

- 项目不再有前端消费者，"两边同时编译失败"这个收益消失了；
- 包带来的成本是真实的：`pnpm-workspace.yaml`、`build:contract`、`prepare`、
  tsconfig 的 `paths` + `exclude`（否则 `rootDir` 会漂移成仓库根、产物变 `dist/src/main.js`）、
  两个 jest 配置各一条 `moduleNameMapper`、`.gitignore` 的 negate 规则 —— 全部为它服务；
- 内联后定义与消费者重新在一起，少一层「类型定义在别处、服务端 re-export」的间接。

### 前端的类型从哪来

后端仍然**导出 OpenAPI 文档**：`pnpm openapi:export` 落盘 `openapi/openapi.json`
（与 `/docs-json` 同一份 `buildDocument()`）。前端 / BFF 走**生成式**类型，而不是手抄：

```bash
pnpm openapi:export        # → openapi/openapi.json
npx openapi-typescript openapi/openapi.json -o src/api/schema.d.ts
```

把这份产物提交进仓库，CI 里就能用 `oasdiff` 做**破坏性变更检测** —— 字段删了、类型收紧了，
在 PR 阶段就红，而不是等前端联调。

> ⚠️ 删掉 `code` 字段后，生成的类型里也不再有错误码联合类型。
> 前端若需要区分"同一个状态码下的不同失败原因"，得先让后端加回 `code`
> —— 见 §"响应契约"里那段取舍说明。

## 路径别名（Path Alias）

`@/*` 映射到 `src/*`，跨目录导入不再需要 `../../..`：

```ts
import { AppModule } from '@/app.module';
import { ApiException } from '@/system/http-validation';
```

- 同目录/同模块内仍用相对路径。
- 构建必须走 Nest CLI（`pnpm build` / `pnpm start:dev`）：Nest CLI 在 emit 前把别名重写成相对路径，
  所以 `dist` 里不会残留 `@/...`，`pnpm start:prod` 可直接跑。
- 不要直接 `npx tsc -p tsconfig.build.json`：裸 `tsc` 不重写别名，`dist` 会在运行时报 `MODULE_NOT_FOUND`。
- 测试脚本的 `moduleNameMapper` 已配好同样的别名（当前无测试，见 §"测试"）。

### `scripts/` 的别名由 `tsconfig-paths` 解析

上面的规矩只覆盖 `src/`。**`scripts/` 走另一条路**（`pnpm openapi:export`）：

```bash
ts-node --project scripts/tsconfig.json --require tsconfig-paths/register scripts/export-openapi.ts
```

原因与本仓库踩过的两个坑有关，值得记住：

1. **`scripts/` 不能进 `nest build` 的 program**：它住在仓库根，与 `src/` 的公共祖先是仓库根
   ⇒ tsc 推断的 `rootDir` 从 `src` 漂移成仓库根 ⇒ 产物变 `dist/src/main.js`，`start:prod` 失效。
   （所以根 `tsconfig.json` 的 `exclude` 里有 `"scripts"`。）
2. **`tsc` 不会重写 `paths` 别名**（那是 Nest CLI 做的）。所以"单独 `tsc` 编译 scripts"也不可行
   —— 产物里会留着 `require("@/app.module")`，运行时报 `MODULE_NOT_FOUND`。

于是脚本**不编译进 `dist/`**，而是用 `ts-node` 直接执行、由 `tsconfig-paths/register` 解析别名。
好处是 `dist/` 由"服务端编译产物"独享，构建脚本永远不会进发布产物。
类型检查单独走 `pnpm typecheck`（`tsc --noEmit` 两个 project，配置见 `scripts/tsconfig.json`）。

## 测试

⚠️ **本仓库当前没有任何测试。**

这不是遗漏，是一次**有意**的清理：在大规模结构调整期间先清空测试，
等结构稳定后再按新的模块边界重写。代价是这段时间**没有自动化回归网** ——
所以改动后请用 §"响应契约"里的 curl 命令手工验证关键行为。

保留下来的东西（补测试时直接用）：

- `jest.json`（单测）与 `jest-e2e.json`（e2e）**保留**，含 `moduleNameMapper` 的 `@/*` 别名；
- `package.json` 的 `test` / `test:cov` / `test:e2e` / `test:e2e:watch` **保留** ——
  但在补回测试之前，它们会以"没有测试可跑"失败，这不是配置坏了；
- `devDependencies` 的 jest / ts-jest / supertest / `@nestjs/testing` 等**全部保留**。

已删除（需要时从 git 历史取回）：16 个测试文件（11 单测 + 5 e2e）、
`src/auth/__tests__/fixtures/test-doubles.ts`、`src/observability/__tests__/quiet-logger.setup.ts`，
以及 `jest-swagger-transformer.js`（`@nestjs/swagger` 插件给 ts-jest 的桥，只为 e2e 服务）。

## 常用脚本

```bash
pnpm start:dev        # 开发（watch）
pnpm build            # 构建服务端（dist/main.js）
pnpm lint             # eslint（type-aware，含 scripts/）
pnpm typecheck        # tsc --noEmit，src + scripts 两个 project
pnpm openapi:export   # 落盘 openapi/openapi.json（ts-node 跑 scripts/export-openapi.ts）
pnpm test             # ⚠️ 当前无测试可跑（见 §"测试"）
pnpm test:e2e         # ⚠️ 同上
```

## 文档

- [`docs/configuration.md`](docs/configuration.md)：环境变量契约、启动即校验规则、数据库配置的预留契约。
- [`docs/validation.md`](docs/validation.md)：校验与响应契约的完整规则、实现依据、实测证据、有意没做的取舍。
- [`docs/authentication.md`](docs/authentication.md)：**认证方案** —— JWT 登录（内存用户表）、守卫与白名单、`JWT_SECRET` 契约、安全边界、升级路径（bcrypt / refresh token / 角色权限）。
- [`docs/logging.md`](docs/logging.md)：**日志规范与实现** —— 接管了什么、一行日志的字段、落盘与滚动策略、怎么写才算合格、验收命令。
- [`docs/review-backlog.md`](docs/review-backlog.md)：一次复盘（P0/P1 已修复，P2/P3 待办）+ 实测复现命令。
- [`docs/nestjs-learning-plan.md`](docs/nestjs-learning-plan.md)：Nest 学习路线（本仓库按它逐步搭建；不含数据库）。
- [`docs/database-learning-plan.md`](docs/database-learning-plan.md)：**数据库从零开始的四周计划** —— SQL → 建模与约束 → 事务与并发 → 接回本仓库（Repository 端口 → 适配器 → 迁移 → 分页），全部命令都在本机实测过。
- [`docs/learning-next.md`](docs/learning-next.md)：**下一步做什么** —— 按投入产出比重排的学习与实施清单（含实测缺口、验收命令、四个可独立合并的迭代）。
