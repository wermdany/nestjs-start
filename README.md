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

启动时会打一行**不含任何密码、也不含任何 token**的配置摘要，并标出哪些配置还是"预留"状态：

```
[bootstrap] env=development port=3000 host=(默认: 全部网卡) swagger=on(http://localhost:3000) jwt=expires:1h,secret:(默认) cors=*(预留) throttle=60s/100(预留) db=memory(预留)
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
    AppConfigModule,               // 配置：加载 .env + 六个类型化 namespace
    ApiContractModule.forRoot(),   // 契约：管道 / 过滤器 / 拦截器 / 请求 id
    AuthModule.forRoot(),          // 认证：JWT 登录 + 全局守卫（密钥来自 JWT_SECRET）
    ValidationDemoModule,
  ],
})
export class AppModule {}
```

`ApiContractModule.forRoot()` 一次挂三个全局增强器（`APP_PIPE` / `APP_FILTER` / `APP_INTERCEPTOR`）
加一个请求 id 中间件，所以**不需要** `app.useGlobalPipes()` / `useGlobalFilters()` / `app.useGlobalInterceptors()`。

| 能力 | 实现 | 干什么 |
| --- | --- | --- |
| 配置 | `AppConfigModule` | `.env` 加载 + **启动即校验**；六个 namespace：`app` / `swagger` / `cors` / `throttle` / `auth` / `database`（`cors` / `throttle` / `database` 是预留） |
| 入参校验 | `ContractValidationPipe` → `APP_PIPE` | body / query / param 全过 `ValidationPipe`（`whitelist` + `transform`），错误是结构化的，且每条明细带 `location` |
| 失败响应 | `AppExceptionFilter` → `APP_FILTER` | 400 / 401 / 403 / 404 / 409 / 500 统一成同一个形状；连**别人抛的**数组型 `message` 也规范化；内部异常只回通用文案，堆栈只进日志；异常自带的响应头（如 `WWW-Authenticate`）在 `json()` 之前写出 |
| 成功响应 | `ResponseEnvelopeInterceptor` → `APP_INTERCEPTOR` | 所有成功返回值包成同一个形状，分页的 `meta` 提到顶层；**幂等**（模块被 import 多次也不会套两层） |
| 认证 | `AuthModule`（`JwtAuthGuard` → `APP_GUARD`） | 登录签发 JWT（内存用户表），**默认拒绝**：`@Public()` 之外的所有路由都要 `Authorization: Bearer`，否则 401 `UNAUTHENTICATED` + `WWW-Authenticate`；token 里只有身份，没有角色 / 权限 |
| 机器判据 | `ErrorCode` + `ApiException` | 业务异常带稳定 `code`，前端 `switch (body.code)` 而不是 parse `message` |
| 可观测 | `RequestIdMiddleware` | 每个请求一个 id：`AsyncLocalStorage` + `x-request-id` 响应头 + 失败信封的 `traceId`；认证成功后 `userId` 进同一个上下文 |
| 参数级豁免 | `@RawBody()` | 同一条路由跳过整个管道（同一个 DTO 在别处照常校验） |
| 可选非空 | `@IsOptionalNotNull()` | 可以不传，但显式传 `null` 会被拒（`@IsOptional()` 会放行 `null`，见 §"响应契约"） |
| 接口文档 | `setupSwagger(app)` → `@nestjs/swagger` | `/docs` 上的 OpenAPI UI，schema 由 DTO 上的 class-validator 推导；`buildDocument()` 是唯一构建入口 |
| 逃生门 | `@NoEnvelope()` | 这条路由不套响应信封 |
| 前端契约 | `packages/api-contract` | 响应信封 / 分页 / 错误码的**纯类型**包，前后端同一份定义 |

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

**body 里只放 HTTP 层给不了的东西**：数字状态码留在 HTTP 状态行，`success` 判断成败，`code` 判断原因。

| 字段 | 恒有？ | 内容 |
| --- | --- | --- |
| `success` | 是 | **唯一判据**。`true` 必有 `data`，`false` 必有 `error` + `message` |
| `data` | 仅成功 | handler 的返回值；分页时是**这一页的数据数组** |
| `meta` | 仅成功、仅有元数据时 | 分页元信息：`totalItems` / `itemsPerPage` / `currentPage`（没有 `totalPages` —— `Math.ceil` 客户端自己算） |
| `error` | 仅失败 | HTTP 状态短语 |
| `code` | 仅失败、仅有语义时 | **机器判据**：`VALIDATION_FAILED` / `EMAIL_ALREADY_EXISTS` / …（框架自身抛的错没有） |
| `traceId` | 仅失败（真实请求里恒有） | 请求 id，同时回写在 `x-request-id` 响应头、并进日志 |
| `message` | 仅失败 | 人类可读说明（成功文案由前端自己出，后端不下发） |
| `errors` | 仅失败、仅有明细时 | `{ field, location?, message, code? }[]`，`field` 是权威定位（嵌套用点号 `address.city`） |

数字状态码不放 body：前端读 `res.status`（axios 是 `error.response.status`）即可，
这样就不存在"body 里的状态码和状态行不一致"的可能。

`code` 与 `message` 的分工是**刻意的**：`message` 可以随便改、可以 i18n，
`code` 一旦发布就不能改名 —— AIP-193 的警告是"客户端一旦开始 parse message，文案就变成契约"。
字段级 `code` 也是语义化的（`INVALID_LENGTH` / `OUT_OF_RANGE`），**不是** class-validator 的约束名
（`isLength` / `min` 是库的实现细节，换校验库就全变了）。

```ts
// 前端只需要一个分支
if (!body.success) {
  toast(body.message);           // 所有失败都有 message
  switch (body.code) {           // 机器判据，不要正则匹配 message
    case 'EMAIL_ALREADY_EXISTS': markField('email', body.message); break;
    default: mapFields(body.errors);   // 只有校验类失败才有 errors
  }
  return;
}
use(body.data);                  // 成功一定有 data
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
$ curl -s -X POST localhost:3000/validation-demo/users -H 'content-type: application/json' -d '{"email":"x@example.com","role":"viewer"}'
{"success":false,"error":"Bad Request","message":"Request validation failed","code":"VALIDATION_FAILED","traceId":"…","errors":[{"field":"name","message":"name must be longer than or equal to 2 characters","code":"INVALID_LENGTH","location":"body"}]}

# 失败 · 业务 → HTTP 404（有 code，没有 errors 键）
$ curl -s localhost:3000/validation-demo/users/999999
{"success":false,"error":"Not Found","message":"user 999999 not found","code":"USER_NOT_FOUND","traceId":"…"}

# 失败 · 框架（未匹配路由）→ HTTP 404（没有业务 code）
$ curl -s localhost:3000/nope
{"success":false,"error":"Not Found","message":"Cannot GET /nope","traceId":"…"}

# 成功 · 登录 → HTTP 200（内存里的演示账号；token 里只有 sub + username）
$ curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"username":"neo","password":"matrix"}'
{"success":true,"data":{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":3600}}

# 失败 · 未认证 → HTTP 401（响应头另有 WWW-Authenticate: Bearer …）
$ curl -s -i localhost:3000/auth/profile
{"success":false,"error":"Unauthorized","message":"Missing or malformed credentials","code":"UNAUTHENTICATED","traceId":"…"}
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

一个入口、一份契约、**启动即校验**。`src/config/` 把环境变量收敛成六个类型化 namespace：

```ts
const app = config.getOrThrow<AppConfig>('app');            // { env, port, host?, strictValidation, envelope }
const auth = config.getOrThrow<AuthConfig>('auth');         // { tokens: [{ token, subjectId, roles }] }
const db = config.getOrThrow<DatabaseConfig>('database');   // { driver, url?, host?, port?, ... }
```

| namespace | 变量 | 状态 |
| --- | --- | --- |
| `app` | `NODE_ENV` / `PORT` / `HOST` / `STRICT_VALIDATION` / `ENABLE_ENVELOPE` | ✅ `main.ts` 用它监听，`app.module.ts` 用它配契约层 |
| `swagger` | `ENABLE_SWAGGER` / `SWAGGER_SERVER_URL` | ✅ `main.ts` 用它开关 `/docs` |
| `jwt` | `JWT_SECRET` / `JWT_EXPIRES_IN` | ✅ `app.module.ts` → `AuthModule`（**生产环境没配密钥或仍用默认值 = 拒绝启动**） |
| `cors` | `CORS_ORIGINS` | 🅿️ 预留（A2 接 CORS） |
| `throttle` | `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | 🅿️ 预留（A2 接限流） |
| `database` | `DATABASE_DRIVER` / `_URL` / `_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` / `_SCHEMA` / `_SSL` / `_POOL_SIZE` / `_LOGGING` / `_SYNCHRONIZE` / `_MIGRATIONS_RUN` | 🅿️ 预留（B1 接 ORM） |

三条规矩：

- **默认值只有一处**：都定义在 `src/config/env.ts` 的导出常量里，校验器与读取函数共同 import；
  `validateEnv()` 只判断"给了的值"，不注入默认值。
- **可选的 `null` 不放过**：`DATABASE_*` 的布尔项只认恰好 `true` / `false`，写 `yes` 直接启动失败。
- **敏感值不落地**：`redactUrl()` 抹掉连接串里的用户名/密码；JWT 密钥在启动摘要里只以
  `secret:(默认｜已配置)` 出现（`jwt=expires:1h,secret:(默认)`），密钥本身永不进日志。

配置**真的会被用上**（不是摆设）—— 三个已接线的消费者：

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

// src/main.ts：环境变量 → 监听端口 / 文档启停
await app.listen(resolved.app.port, resolved.app.host);
setupSwagger(app, { enabled, serverUrl });
```

实测：`ENABLE_ENVELOPE=false` 时 `GET /users/1` 返回裸对象（失败响应不受影响）；
`STRICT_VALIDATION=true` 时多带一个字段就 400。

`cors` / `throttle` / `database` 目前**没有消费者**（名字后面的 🅿️ 就是这个意思）；
`database` 虽然还没接，但**连接契约已经定好了**（`url` 优先、`port` 按驱动补默认值、
`synchronize` 生产禁用、`password` 永不进日志）—— B1 落地时直接照做，不必重新讨论。

> 有一个**无法**配置化的地方值得说明：分页的 `PAGE_SIZE_DEFAULT` / `PAGE_SIZE_MAX`
> （`src/contract/pagination/`）在**装饰器里求值**，是编译期常量 —— 要改成配置驱动
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
packages/
└── api-contract/                 ★ 前后端共享的**线上契约**（纯类型，零运行时导出）
    └── src/index.ts              响应信封 / 分页 / ErrorCode —— 服务端与前端同一份定义

src/
├── main.ts                       入口（校验 env → create → helmet → describe → setupSwagger → listen）
├── app.module.ts                 组装：AppConfigModule + ContractModule + AuthModule + 业务模块
├── config/                       ★ 配置层，对外只有 index.ts 一个入口
│   ├── env.ts                    变量名/默认值常量 + 类型转换 + 校验类 + validateEnv + 告警
│   ├── app.config.ts             app namespace（env / port / host / 两个契约开关）
│   ├── swagger.config.ts         swagger namespace（复用 isSwaggerEnabled 的规则）
│   ├── platform.config.ts        cors + throttle namespace（🅿️ 预留）
│   ├── jwt.config.ts             jwt namespace（JWT_SECRET / JWT_EXPIRES_IN）
│   ├── database.config.ts        database namespace（🅿️ 预留，含连接契约）
│   ├── describe-config.ts        readResolvedConfig / formatConfigSummary / redactUrl
│   ├── app-config.module.ts      AppConfigModule + env 文件选择
│   └── __tests__/                config.e2e-spec.ts（配置契约）+ jwt.config.spec.ts（JWT 配置单测）
├── auth/                         ★ 认证层（JWT），对外只有 index.ts 一个入口
│   ├── auth.module.ts            forRoot / forRootAsync（包 JwtModule）+ 全局 APP_GUARD
│   ├── auth-options.ts           AuthOptions（就是 JwtModuleOptions）/ AuthAsyncOptions
│   ├── auth.controller.ts        POST /auth/login（@Public）+ GET /auth/profile（受保护）
│   ├── auth.service.ts           校验凭证 → 签发 JWT
│   ├── users.service.ts          内存用户表（两个演示账号）+ 常量时间密码比较
│   ├── jwt-auth.guard.ts         认证守卫（fail-closed，@Public() 白名单）
│   ├── jwt-payload.ts            JwtPayload 类型 + isJwtPayload() + lifetimeSecondsOf()
│   ├── decorators/               @Public() / @CurrentUser()
│   ├── exceptions.ts             401（UNAUTHENTICATED + WWW-Authenticate）
│   ├── dto/                      LoginDto / LoginResponseDto / ProfileDto
│   └── __tests__/                单测（用户表 / 签发 / 守卫矩阵 / 载荷）+ auth.e2e-spec.ts
├── contract/                     ★ 可复用契约层，对外只有 index.ts 一个入口
│   ├── index.ts                  门面桶（显式具名导出，不用 export *）
│   ├── api-contract.module.ts    forRoot / forRootAsync / API_CONTRACT_OPTIONS + 请求 id 中间件
│   ├── validation/
│   │   ├── validation-pipe.factory.ts      默认开关 + createValidationPipe()
│   │   ├── contract-validation.pipe.ts     给每条明细补 errors[].location
│   │   ├── validation-exception.factory.ts 校验错误 → { code, message, errors[] }
│   │   ├── http-exception.filter.ts        失败响应统一形状（含数组型 message 规范化 + 异常响应头）
│   │   ├── error-contract.ts               失败侧类型的本地别名（形状在共享包里）
│   │   ├── error-code.ts                   ErrorCode 值对象 + 约束名→语义 code 映射
│   │   ├── error-location.ts               location 的运行时校验
│   │   ├── api-exception.ts                业务异常基类（code + message + status + headers?）
│   │   ├── is-optional-not-null.decorator.ts  @IsOptionalNotNull()
│   │   ├── raw-body.decorator.ts           @RawBody()
│   │   └── is-not-reserved-name.validator.ts
│   ├── observability/
│   │   ├── request-context.ts              AsyncLocalStorage：getRequestId() / setRequestUserId()
│   │   └── request-id.middleware.ts        x-request-id 生成/沿用 + 幂等
│   ├── response/
│   │   ├── response-contract.ts            ENVELOPED / PAGINATED_RESULT 两个标记
│   │   ├── response-envelope.interceptor.ts
│   │   ├── is-enveloped.ts                 ← 幂等：已经包过就不包第二次
│   │   ├── is-paginated-result.ts
│   │   └── no-envelope.decorator.ts        @NoEnvelope()
│   └── pagination/
│       ├── pagination-query.dto.ts         PaginationQueryDto + createPaginationQueryDto()
│       └── paginated-result.ts             buildPaginatedResult()
├── swagger/                      OpenAPI 投影（契约层保持零 Swagger 依赖）
│   ├── setup-swagger.ts          buildDocument(app) + setupSwagger(app)：/docs、/docs-json
│   ├── export-openapi.ts         pnpm openapi:export → openapi/openapi.json
│   ├── is-swagger-enabled.ts     启停规则（纯函数，可单测）
│   ├── envelope.schema.ts        响应信封在 OpenAPI 里的表示（唯一手写处 + e2e 双向守卫）
│   ├── api-errors.decorator.ts   @ApiEnvelopeErrors() / @ApiEnvelopeConflict() / @ApiEnvelopeAuthErrors()
│   └── __tests__/                openapi.e2e-spec.ts（**整份文档**：路径清单 / 标签 / 悬空 $ref / 失败响应）
└── modules/
    └── validation-demo/          活文档：内存版 users 资源，把每种校验行为都跑一遍
        ├── validation-demo.controller.ts
        ├── validation-pipe-order.controller.ts
        ├── validation-demo.service.ts
        ├── user.dto.ts           响应模型 UserDto（= 原来的 User interface）
        ├── exceptions.ts         具名业务异常（继承 ApiException，code + 文案集中一处）
        ├── dto/
        └── __tests__/            validation-demo.e2e-spec.ts（响应契约）
```

约定：

- **`src/contract/` 内部互相引用走具体文件**，绝不走桶 —— 桶永远不参与循环依赖。
- 消费方走门面：`import { ApiContractModule, RawBody } from '@/contract'`。
- **绝不对 DTO / 模块写 `import type`**：类型导入会被运行时擦除，`emitDecoratorMetadata` 只能发出 `Object`，
  而 `Object` 在 `ValidationPipe` 的跳过名单里 —— 校验会**静默失效**（400 变 201，无任何报错）。详见 docs §8。
- `src/contract/` 只管运行时行为；OpenAPI 投影一律放 `src/swagger/`，避免契约层被文档工具绑住。
- **线上形状只在 `packages/api-contract` 定义一次**：`src/contract/` 转出类型、只放服务端运行时需要的东西。
- **`config` / `contract` / `auth` 互不认识**：三者都只被 `app.module.ts` 的工厂函数粘起来，
  所以每个都能单独 import 进测试模块（`src/auth/` 里没有一行 `@/config`）。
- **测试按被测对象归属**：文档级不变量在 `src/swagger/__tests__/`，每个 demo 只测自己的行为 ——
  加一个模块不必去改另一个模块的测试文件。

## 共享契约包（`packages/api-contract`）

响应信封 / 分页 / `ErrorCode` 的**纯类型**定义，前端（或 BFF、其它语言的手写 SDK）直接消费同一份：

```ts
import type { ResponseBody, PaginatedResult, ErrorCode } from '@nest-start/api-contract';
```

它是**类型唯一事实来源**：改错一边，服务端和前端会同时编译失败，而不是联调时才发现字段对不上。

刻意的约束：**零运行时导出**（没有 `enum`、没有 `const`、没有类）。

- 服务端通过 tsconfig 的 `paths` 指向它的 **`.d.ts`** 消费 ⇒ 编译后 import 被完全擦除，
  `dist/` 里不残留任何引用、运行时不需要它先构建好（`grep -r '@nest-start' dist --include='*.js'` 应为空）；
- `ErrorCode` 的**值对象**因此留在服务端 `src/contract/validation/error-code.ts`，
  并有一句编译期断言保证它覆盖共享联合类型的每个成员；
- 因为它**不参与服务端 program**（`tsconfig.json` 的 `exclude` 里有 `packages`），
  `rootDir` 不会被推断成仓库根 —— 否则产物会从 `dist/main.js` 变成 `dist/src/main.js`（实测踩过）。
- 改了它要重新构建：`pnpm build:contract`（`pnpm install` 的 `prepare` 和 `pnpm build` 都会带上它）。

前端要**生成式**类型（而不是手写）时，用 `pnpm openapi:export` 落盘的 `openapi/openapi.json`
配合 `openapi-typescript` / `orval`：

```bash
pnpm openapi:export        # → openapi/openapi.json（与 /docs-json 同一份 buildDocument()）
npx openapi-typescript openapi/openapi.json -o src/api/schema.d.ts
```

把这份产物提交进仓库，CI 里就能用 `oasdiff` 做**破坏性变更检测** —— 字段删了、类型收紧了，
在 PR 阶段就红，而不是等前端联调。

## 路径别名（Path Alias）

`@/*` 映射到 `src/*`，跨目录导入不再需要 `../../..`：

```ts
import { AppModule } from '@/app.module';
import { ApiContractModule } from '@/contract';
```

- 同目录/同模块内仍用相对路径。
- 构建必须走 Nest CLI（`pnpm build` / `pnpm start:dev`）：Nest CLI 在 emit 前把别名重写成相对路径，
  所以 `dist` 里不会残留 `@/...`，`pnpm start:prod` 可直接跑。
- 不要直接 `npx tsc -p tsconfig.build.json`：裸 `tsc` 不重写别名，`dist` 会在运行时报 `MODULE_NOT_FOUND`。
- 测试由 `jest-e2e.json`（e2e）与 `jest.json`（单测）的 `moduleNameMapper` 解析同样的别名。

## 常用脚本

```bash
pnpm start:dev        # 开发（watch）
pnpm build            # 构建契约包 + 构建服务端（dist/main.js）
pnpm lint             # eslint（type-aware）
pnpm test             # 单元测试（判定逻辑 / 纯函数，jest.json）
pnpm test:cov         # 单元测试 + 覆盖率
pnpm test:e2e         # 契约测试（响应形状 + 认证 + OpenAPI 文档 + 配置校验）
pnpm openapi:export   # 落盘 openapi/openapi.json
pnpm build:contract   # 只构建 packages/api-contract（pnpm install 的 prepare 会跑它）
```

## 文档

- [`docs/configuration.md`](docs/configuration.md)：环境变量契约、启动即校验规则、数据库配置的预留契约。
- [`docs/validation.md`](docs/validation.md)：校验与响应契约的完整规则、实现依据、实测证据、有意没做的取舍。
- [`docs/authentication.md`](docs/authentication.md)：**认证方案** —— JWT 登录（内存用户表）、守卫与白名单、`JWT_SECRET` 契约、安全边界、升级路径（bcrypt / refresh token / 角色权限）。
- [`docs/review-backlog.md`](docs/review-backlog.md)：一次复盘（P0/P1 已修复，P2/P3 待办）+ 实测复现命令。
- [`docs/nestjs-learning-plan.md`](docs/nestjs-learning-plan.md)：Nest 学习路线（本仓库按它逐步搭建）。
- [`docs/learning-next.md`](docs/learning-next.md)：**下一步做什么** —— 按投入产出比重排的学习与实施清单（含实测缺口、验收命令、四个可独立合并的迭代）。
