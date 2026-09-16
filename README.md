# nestjs-start

一个精简的 NestJS 起步仓库：**入参校验 + 统一响应契约 + 分页 + OpenAPI 文档**一次配好，
`main.ts` 里几乎不写全局配置。

```bash
pnpm install            # 直接跑即可
pnpm start:dev          # http://localhost:3000 ，文档在 /docs
pnpm test:e2e           # 契约测试（锁定响应形状 + OpenAPI 文档）
```

## 一行接入

```ts
// src/app.module.ts
@Module({
  imports: [ApiContractModule.forRoot(), ValidationDemoModule],
})
export class AppModule {}
```

`ApiContractModule.forRoot()` 一次挂三个全局增强器（`APP_PIPE` / `APP_FILTER` / `APP_INTERCEPTOR`），
所以**不需要** `app.useGlobalPipes()` / `useGlobalFilters()` / `app.useGlobalInterceptors()`。

| 能力 | 实现 | 干什么 |
| --- | --- | --- |
| 入参校验 | `createValidationPipe()` → `APP_PIPE` | body / query / param 全过 `ValidationPipe`（`whitelist` + `transform`），错误是结构化的 |
| 失败响应 | `AppExceptionFilter` → `APP_FILTER` | 400 / 404 / 409 / 500 统一成同一个形状；内部异常只回通用文案，堆栈只进日志 |
| 成功响应 | `ResponseEnvelopeInterceptor` → `APP_INTERCEPTOR` | 所有成功返回值包成同一个形状，分页的 `meta` 提到顶层 |
| 参数级豁免 | `@RawBody()` | 同一条路由跳过整个管道（同一个 DTO 在别处照常校验） |
| 接口文档 | `setupSwagger(app)` → `@nestjs/swagger` | `/docs` 上的 OpenAPI UI，schema 由 DTO 上的 class-validator 推导 |
| 逃生门 | `@NoEnvelope()` | 这条路由不套响应信封 |

选项透传（校验选项平铺在顶层）：

```ts
ApiContractModule.forRoot({ forbidNonWhitelisted: true }); // 多余字段直接 400
ApiContractModule.forRoot({ envelope: false });            // 不要响应信封
```

## 响应契约

**body 里只放 HTTP 层给不了的东西**：数字状态码留在 HTTP 状态行，`success` 是唯一判据。

| 字段 | 恒有？ | 内容 |
| --- | --- | --- |
| `success` | 是 | **唯一判据**。`true` 必有 `data`，`false` 必有 `error` + `message` |
| `data` | 仅成功 | handler 的返回值；分页时是**这一页的数据数组** |
| `meta` | 仅成功、仅有元数据时 | 分页元信息：`totalItems` / `itemsPerPage` / `currentPage`（没有 `totalPages` —— `Math.ceil` 客户端自己算） |
| `error` | 仅失败 | HTTP 状态短语 |
| `message` | 仅失败 | 人类可读说明（成功文案由前端自己出，后端不下发） |
| `errors` | 仅失败、仅有明细时 | `{ field, message }[]`，`field` 是权威定位（嵌套用点号 `address.city`） |

数字状态码不放 body：前端读 `res.status`（axios 是 `error.response.status`）即可，
这样就不存在"body 里的状态码和状态行不一致"的可能。

```ts
// 前端只需要一个分支
if (!body.success) {
  toast(body.message);           // 所有失败都有 message
  mapFields(body.errors);        // 只有校验类失败才有 errors
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

# 失败 · 校验 → HTTP 400（errors[].field 可直接映射到表单）
$ curl -s -X POST localhost:3000/validation-demo/users -H 'content-type: application/json' -d '{"email":"x@example.com","role":"viewer"}'
{"success":false,"error":"Bad Request","message":"Request validation failed","errors":[{"field":"name","message":"name must be longer than or equal to 2 characters"}]}

# 失败 · 业务 → HTTP 404
$ curl -s localhost:3000/validation-demo/users/999999
{"success":false,"error":"Not Found","message":"user 999999 not found"}
```

完整规则、边界（`@Render()` / `@Redirect()` / `@Sse()` / `StreamableFile` / 空返回值 / `@NoEnvelope()`）
以及取舍依据见 [`docs/validation.md`](docs/validation.md) §9。

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

两个曾经踩过的坑（现在都已在本仓库里修掉，换机器时留意）：

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

## 目录结构

```
src/
├── main.ts                       入口（create → setupSwagger → listen）
├── app.module.ts                 组装：ContractModule + 业务模块
├── contract/                     ★ 可复用契约层，对外只有 index.ts 一个入口
│   ├── index.ts                  门面桶（显式具名导出，不用 export *）
│   ├── api-contract.module.ts    ApiContractModule.forRoot()
│   ├── validation/
│   │   ├── validation-pipe.factory.ts     默认开关 + createValidationPipe()
│   │   ├── validation-exception.factory.ts 校验错误 → { message, errors: [{field, message}] }
│   │   ├── http-exception.filter.ts       失败响应统一形状
│   │   ├── error-contract.ts              ErrorDetail / ApiErrorBody
│   │   ├── raw-body.decorator.ts          @RawBody()
│   │   └── is-not-reserved-name.validator.ts
│   ├── response/
│   │   ├── response-contract.ts           契约类型 + 分页结果标记
│   │   ├── response-envelope.interceptor.ts
│   │   ├── is-paginated-result.ts
│   │   └── no-envelope.decorator.ts       @NoEnvelope()
│   └── pagination/
│       ├── pagination-query.dto.ts        PaginationQueryDto + createPaginationQueryDto()
│       └── paginated-result.ts            PaginatedResult<T> + buildPaginatedResult()
├── swagger/                      OpenAPI 投影（契约层保持零 Swagger 依赖）
│   ├── setup-swagger.ts          setupSwagger(app)：DocumentBuilder + 注册 /docs、/docs-json
│   ├── is-swagger-enabled.ts     启停规则（纯函数，可单测）
│   ├── envelope.schema.ts        响应信封在 OpenAPI 里的表示（唯一手写处）
│   └── api-errors.decorator.ts   @ApiEnvelopeErrors() / @ApiEnvelopeConflict()
└── modules/
    └── validation-demo/          活文档：内存版 users 资源，把每种行为都跑一遍
        ├── validation-demo.controller.ts
        ├── validation-pipe-order.controller.ts
        ├── validation-demo.service.ts
        ├── user.dto.ts           响应模型 UserDto（= 原来的 User interface）
        ├── exceptions.ts         具名业务异常（文案集中一处）
        ├── dto/
        └── __tests__/            validation-demo.e2e-spec.ts（响应契约）+ swagger.e2e-spec.ts（文档）
```

约定：

- **`src/contract/` 内部互相引用走具体文件**，绝不走桶 —— 桶永远不参与循环依赖。
- 消费方走门面：`import { ApiContractModule, RawBody } from '@/contract'`。
- **绝不对 DTO / 模块写 `import type`**：类型导入会被运行时擦除，`emitDecoratorMetadata` 只能发出 `Object`，
  而 `Object` 在 `ValidationPipe` 的跳过名单里 —— 校验会**静默失效**（400 变 201，无任何报错）。详见 docs §8。
- `src/contract/` 只管运行时行为；OpenAPI 投影一律放 `src/swagger/`，避免契约层被文档工具绑住。

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
- 测试由 `jest-e2e.json` 的 `moduleNameMapper` 解析同样的别名。

## 文档

- [`docs/validation.md`](docs/validation.md)：校验与响应契约的完整规则、实现依据、实测证据、有意没做的取舍。
- [`docs/nestjs-learning-plan.md`](docs/nestjs-learning-plan.md)：Nest 学习路线（本仓库按它逐步搭建）。
