# 参数校验与响应契约（Validation & Response Contract）

本仓库的**入参校验**全部走 Nest 请求生命周期的 **Pipes** 层：

```
Middleware → Guards → Interceptors(前) → Pipes → Handler → Interceptors(后) → Filters
```

而**出参形状**由 Interceptors(后)（成功侧）和 Filters（失败侧）两侧合起来保证。
一切都在 `ApiContractModule.forRoot()` 里挂好，`main.ts` 保持干净。

- 全局兜底：`ApiContractModule.forRoot()` → `APP_PIPE` + `APP_FILTER` + `APP_INTERCEPTOR`
- 局部补充：`@UsePipes()` / 参数级管道，处理全局管道管不了的参数
- 参数级豁免：`@RawBody()`（只影响这一条路由，同一个 DTO 在别处照常校验）
- 响应逃生门：`@NoEnvelope()`（这条路由不套信封）

## 1. 文件在哪

```
packages/api-contract/src/index.ts            ★ 线上契约（纯类型）：ResponseBody / ErrorBody /
                                                ErrorDetail / PaginationMeta / PaginatedResult / ErrorCode

src/contract/                              契约层：对外只有 index.ts 一个入口
├── index.ts                               ★ 门面桶：只导出外部要用的东西
├── api-contract.module.ts                 forRoot / forRootAsync / API_CONTRACT_OPTIONS + 请求 id 中间件
├── validation/
│   ├── validation-pipe.factory.ts         DEFAULT_VALIDATION_PIPE_OPTIONS / resolveValidationPipeOptions() / createValidationPipe()
│   ├── contract-validation.pipe.ts        ContractValidationPipe：给每条明细补 errors[].location
│   ├── validation-exception.factory.ts    校验失败 → { code, message, errors: [{field, message, code}] }
│   ├── http-exception.filter.ts           AppExceptionFilter：失败响应统一形状（含数组型 message 规范化）
│   ├── error-contract.ts                  失败侧类型的本地别名（形状在共享包里）
│   ├── error-code.ts                      ErrorCode 值对象 + 约束名 → 语义 code 映射
│   ├── error-location.ts                  location 的运行时校验（跨信任边界）
│   ├── api-exception.ts                   业务异常基类：code + message + status
│   ├── is-optional-not-null.decorator.ts  @IsOptionalNotNull()
│   ├── raw-body.decorator.ts              @RawBody()（参数级豁免，走 createParamDecorator）
│   └── is-not-reserved-name.validator.ts  IsNotReservedNameConstraint 类 + @IsNotReservedName()
├── observability/
│   ├── request-context.ts                 AsyncLocalStorage：runWithRequestContext / getRequestId
│   └── request-id.middleware.ts           RequestIdMiddleware：x-request-id 生成/沿用 + 幂等
├── response/
│   ├── response-contract.ts               ENVELOPED / PAGINATED_RESULT 两个标记 + 契约类型转出
│   ├── response-envelope.interceptor.ts   成功响应统一形状（可关、幂等）
│   ├── is-enveloped.ts                    「已经包过信封」守卫（幂等的基础）
│   ├── is-paginated-result.ts             分页结果守卫（只认非枚举 symbol）
│   └── no-envelope.decorator.ts           @NoEnvelope()
└── pagination/                            跨 feature 复用的共享分页
    ├── pagination-query.dto.ts            PaginationQueryDto + createPaginationQueryDto()
    └── paginated-result.ts                buildPaginatedResult()

src/swagger/                               OpenAPI 投影（契约层保持零 Swagger 依赖，见 §9.7）
├── setup-swagger.ts                       buildDocument(app)（唯一构建入口）+ setupSwagger(app)：/docs + /docs-json
├── export-openapi.ts                      pnpm openapi:export → openapi/openapi.json
├── is-swagger-enabled.ts                  启停规则（纯函数）
├── envelope.schema.ts                     信封 / errors[] 的 schema（唯一手写处 + e2e 双向守卫）
└── api-errors.decorator.ts                @ApiEnvelopeErrors() / @ApiEnvelopeConflict()

src/modules/validation-demo/               内存版 users 资源，无数据库 —— 活文档
├── validation-demo.module.ts
├── validation-demo.controller.ts          只用全局管道
├── validation-pipe-order.controller.ts    全局 + 局部两级管道的对照
├── validation-demo.service.ts
├── user.dto.ts                            响应模型 UserDto（= 原来的 User interface）
├── exceptions.ts                          具名业务异常（继承 ApiException）
├── dto/                                   user-role / address / create-user / update-user / query-users / user-id-param / webhook / plain-webhook / webhook-response
└── __tests__/                             validation-demo.e2e-spec.ts（响应契约；文档测试已移到 src/swagger/__tests__/）
```

约定：

- **`src/contract/` 内部互相引用走具体文件**（`api-contract.module.ts` 里写 `./validation/validation-pipe.factory`），**绝不走桶** —— 这样桶永远不参与循环依赖。
- 消费方走门面：`import { ApiContractModule, RawBody } from '@/contract'`。
- **测试按被测对象归属**（每个模块只对自己的行为负责，加一个模块不必改另一个的测试文件）：

  | 文件 | 钉住什么 |
  | --- | --- |
  | `src/modules/validation-demo/__tests__/validation-demo.e2e-spec.ts` | 响应契约的形状（键集 / 状态码 / code / location / traceId） |
  | `src/swagger/__tests__/openapi.e2e-spec.ts` | **整份** OpenAPI 文档（路由清单、标签、悬空 `$ref`、信封 schema、插件推导、每条路由的失败响应） |
  | `src/auth/__tests__/auth.e2e-spec.ts` | 认证的运行时行为（登录 → token → 受保护路由；401 / `WWW-Authenticate` / `traceId`） |
  | `src/config/__tests__/config.e2e-spec.ts` | 环境变量契约（校验规则、默认值、脱敏、启动摘要） |
  | `src/**/__tests__/*.spec.ts` | 纯函数与判定逻辑的单测（`jest.json` 那条道） |

`main.ts` 里**没有** `app.useGlobalPipes(...)` / `app.useGlobalFilters(...)` / `app.useGlobalInterceptors(...)`。

## 2. 默认开关

```ts
{ whitelist: true, forbidNonWhitelisted: false, transform: true }
```

| 开关 | 含义 |
| --- | --- |
| `whitelist` | 剥掉 DTO 上没有校验装饰器的字段 |
| `forbidNonWhitelisted` | **当前是 `false`**：未声明字段被 `whitelist` 静默剥掉。设成 `true` 会改成"直接 400" |
| `transform` | 把 plain object 变成 DTO 实例，`@Type()` 与默认值才会生效 |
| `exceptionFactory` | 输出 `{ code: 'VALIDATION_FAILED', message, errors: [{ field, message, code }] }` |

管道的**类**是 `ContractValidationPipe`（`ValidationPipe` 的子类），它只多做一件事：
给每条明细补 `errors[].location`（`body` / `query` / `param`）—— 见 §9.8。
`createValidationPipe()` 返回的就是它，所以参数级 `@UsePipes(createValidationPipe(...))`
拿到的也是同一套行为。

> ⚠️ **这两个开关必须成对理解**：`forbidNonWhitelisted` 只是 `whitelist()` **内部的一个分支**
> （`class-validator` 的 `ValidationExecutor` 里 `if (whitelist) this.whitelist(...)`）。
> 所以 `forbidNonWhitelisted: true` 配 `whitelist: false` 是**完全没有效果**的。

`true` 与 `false` 的取舍：`true` 对契约更严格（多传字段就报错，问题暴露得早），
但前端、埋点、缓存破坏参数只要多带一个 query 参数，接口就 400；`false` 更宽容，代价是拼错字段名会被静默吞掉。

还有两个刻意**没有**设的东西：

- `transformOptions.enableImplicitConversion`：query 的类型转换请在 DTO 字段上显式写 `@Type(() => Number)`，否则 `"123"` 会被静默转成 `123` 而通过 `@IsInt()`。
- `forbidUnknownValues`：Nest 的 `ValidationPipe` 会主动把它设成 `false`，所以"一个校验装饰器都没有的类"不会报 `unknownValue`，只会被 `whitelist` 剥空（见 §3.4）。

要改默认值（校验选项平铺在顶层，`envelope` 是本模块自己的开关）：

```ts
// src/app.module.ts
imports: [ApiContractModule.forRoot({ forbidNonWhitelisted: true }), ValidationDemoModule];
```

## 3. 怎么跑

```bash
pnpm start:dev
```

```bash
BASE=http://localhost:3000/validation-demo

# 合法 body → 201，响应是信封 { success, data }，见 §9
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"name":"Cypher","email":"cypher@example.com","role":"viewer","tags":["ops"],"address":{"street":"Main 1","city":"Zion"}}'

# 缺必填字段 → 400，错误形状见 §9
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"email":"x@example.com","role":"viewer"}'

# 多余字段 → 被静默剥掉（默认 forbidNonWhitelisted: false）
#   想让它变 400：ApiContractModule.forRoot({ forbidNonWhitelisted: true })
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"name":"Cypher","email":"cypher2@example.com","role":"viewer","nickname":"x"}'

# 自定义校验器命中保留字 → 400
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"name":"admin","email":"admin@example.com","role":"viewer"}'

# 嵌套对象非法 → 400，明细字段是 field: "address.city"
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"name":"Cypher","email":"cypher3@example.com","role":"viewer","address":{"street":"Main 1","city":"X"}}'

# 邮箱与 seed 数据重复 → 409
curl -s -X POST $BASE/users -H 'content-type: application/json' \
  -d '{"name":"Dup","email":"neo@example.com","role":"viewer"}'

# 分页（data 是数组，meta 在信封顶层，见 §7 / §9）
curl -s "$BASE/users?page=1&limit=10"

# limit 超过上限被截断成 50，而不是 400
curl -s "$BASE/users?limit=999"

# sortBy 只接受白名单里的字段
curl -s "$BASE/users?sortBy=name"     # 200
curl -s "$BASE/users?sortBy=role"     # 400，errors[] 列出允许值

# query 里的数字非法 → 400
curl -s "$BASE/users?page=abc"

# 未知 query 参数 → 被静默剥掉（默认 forbidNonWhitelisted: false）
curl -s "$BASE/users?unknown=1"

# param 转换 / 404 —— 走 DTO，所以 field 点名 id（ParseIntPipe 给不出字段名）
curl -s $BASE/users/abc        # 400，errors: [{ field: "id", ... }]
curl -s $BASE/users/0          # 400（ParseIntPipe 不会挡 0）
curl -s $BASE/users/-5         # 400（ParseIntPipe 也不会挡负数）
curl -s -o /dev/null -w '%{http_code}\n' $BASE/users/999999     # 404

# PartialType：只改传入的字段
curl -s -X PATCH $BASE/users/1 -H 'content-type: application/json' -d '{"age":31}'

# 三种 webhook 机制对照（WebhookDto = event + data + count，count 必填）
# ① @Body() + 带校验规则的 DTO ⇒ 缺 count 会 400；多余的 extra 被剥掉
curl -s -X POST $BASE/webhooks/body -H 'content-type: application/json' \
  -d '{"event":"user.created","data":{"id":7},"count":2,"extra":"x"}'

# ② @RawBody() ⇒ 同一个 DTO，参数级豁免，201 原样回显（extra 也留着）
curl -s -X POST $BASE/webhooks/raw-body -H 'content-type: application/json' \
  -d '{"event":"user.created","data":{"id":7},"count":2,"extra":"x"}'

# ③ 无装饰器的 DTO ⇒ 被 whitelist 剥成空对象（开 forbidNonWhitelisted 才会 400）
curl -s -X POST $BASE/webhooks/plain -H 'content-type: application/json' -d '{"any":"thing"}'

# 全局 + 局部两级管道
curl -s -X POST $BASE/pipe-order/ids -H 'content-type: application/json' -d '["1","2"]'  # data.ids = [1,2]
curl -s -X POST $BASE/pipe-order/ids -H 'content-type: application/json' -d '["a"]'      # 400
curl -s -X POST $BASE/pipe-order/strict -H 'content-type: application/json' \
  -d '{"email":"s@example.com","role":"viewer"}'   # 400（不是 422）

# 没有 return 值的 handler 也走信封：data 为 null，而不是空响应体（HTTP 201）
curl -s -X POST $BASE/no-content    # {"success":true,"data":null}
```

测试：

```bash
pnpm test:e2e        # jest-e2e.json，rootDir=src，testRegex=\.e2e-spec\.ts$
pnpm test:e2e:watch  # 同上，--watch
```

`testRegex` 是对**完整路径**匹配的，所以测试文件放进 `__tests__/` 不影响发现，也不用改配置。

两个 e2e 文件分工：`validation-demo.e2e-spec.ts` 钉响应契约（成功/失败信封的**键集**与状态码），
`openapi.e2e-spec.ts` 钉 OpenAPI 文档（路由覆盖、信封 schema、插件推导出的约束、`/docs` 的启停）。

## 4. 四条必须记住的结论

### 4.1 全局管道永远第一个跑，局部管道只能「补」，不能「改」

管道装配在 `@nestjs/core` 里是这么串起来的：

```
ContextCreator.createContext()          → [...global, ...class, ...method]
RouterExecutionContext.createPipesFn()  → pipes.concat(paramPipes)
PipesConsumer.applyPipes()              → transforms.reduce(...)   // 每个管道收到上一个的输出
```

后果：

- 非法输入时全局管道已经先抛 400，控制器级/参数级的 `ValidationPipe` **根本不会执行**；
- 合法输入时全局的 `whitelist` 已经把未声明字段剥掉了，局部的 `forbidNonWhitelisted` 无从触发。

所以对 DTO 参数，局部 `ValidationPipe` **既不能放松也不能加严**。`POST /validation-demo/pipe-order/strict` 就是故意保留的反例：它配了 422，实测返回 **400**。

### 4.2 局部管道的正确用法是「管全局管不了的东西」

`ValidationPipe.toValidate()` 会跳过内置类型：

```js
const types = [String, Boolean, Number, Array, Object, Buffer, Date];
```

所以 `@Body() ids: number[]` 这种参数全局管道**直接放行**，正好交给方法级管道：

```ts
@Post('ids')
@UsePipes(new ParseArrayPipe({ items: Number }))
parseIds(@Body() ids: number[]) { return { ids }; }   // ["1","2"] → [1,2]
```

这就是 `POST /validation-demo/pipe-order/ids`。

### 4.3 绕过校验用参数级 `@RawBody()`

**`@RawBody()` 为什么天然能生效** —— `@nestjs/core` 的 `ParamsTokenFactory` 对 BODY/QUERY/PARAM 之外一律返回 `'custom'`，而 `@nestjs/common/pipes/validation.pipe.js` 里：

```js
// toValidate()
if (type === 'custom' && !this.validateCustomDecorators) {
  return false;
}
// 构造函数
this.validateCustomDecorators = validateCustomDecorators || false;   // 默认关闭
```

反过来说：一旦 `ApiContractModule.forRoot({ validateCustomDecorators: true })`，
`@RawBody()` 就又开始校验 —— e2e 里的 `webhooks/raw-body` 用例把这个行为钉住了。

同一个 DTO 的两条路由 —— 这就是「不需要复制 DTO」的意思：

```ts
@Post('webhooks/body')                                  // 走默认校验
receiveChecked(@Body() payload: WebhookDto) { ... }

@Post('webhooks/raw-body')                              // 同一个 WebhookDto，不校验
receiveRaw(@RawBody() payload: WebhookDto) { ... }
```

**为什么不做成「打在 DTO 类上的类型级标记」**：管道唯一能读到的锚点是 `metadata.metatype`（DTO 类），而 `ValidationPipe.transform(value, metadata)` 的第二个参数是 `ArgumentMetadata`（只有 `{ type, metatype, data }`），**没有 `ExecutionContext`**。所以类型级标记会变成一个**回不去**的开关：该类型在**所有**路由都失去校验，管道内部没有任何"这次例外"的表达空间，想恢复只能再定义一个同形状的 DTO。挂在参数上就没有这个问题。

**注意跳过的是整个管道，不只是校验**：值不会被转成 DTO 实例，`@Type()` 转换和字段默认值都不会发生，handler 拿到的是原始 plain object。

顺带一个容易误用的**隐式**旁路：参数类型写成内置类型（`object`、`any`、`number[]`）时全局管道也会自动跳过。请用 `@RawBody()` 把意图写明白。

### 4.4 「无装饰器的类」不是免检

`PlainWebhookDto` 一个校验装饰器都没有，payload 里每个字段都算「未声明字段」：

- 默认（`forbidNonWhitelisted: false`）→ 被 `whitelist` **静默剥成 `{}`**（`POST /validation-demo/webhooks/plain` 的 `data.received` 是 `{}`）；
- 若把 `forbidNonWhitelisted` 打开 → 同样请求变成 **400**。

想把 payload 原样留下，用 `@RawBody()`（`POST /validation-demo/webhooks/raw-body`）。

## 5. 加新 DTO / 新校验器

```ts
// DTO：规则写在类上，Update 版用 PartialType 复用
export class CreateThingDto {
  @IsString() @Length(2, 20) name: string;
  @IsOptional() @IsInt() @Min(1) count?: number;
  @IsOptional() @ValidateNested() @Type(() => NestedDto) nested?: NestedDto;  // @Type 不能省，否则嵌套校验静默失效
}
export class UpdateThingDto extends PartialType(CreateThingDto) {}
```

```ts
// 自定义校验器：约束类 + registerDecorator 工厂写在一个文件里（见 src/contract/validation/is-not-reserved-name.validator.ts）
@ValidatorConstraint({ name: 'isXxx', async: false })
@Injectable()
export class IsXxxConstraint implements ValidatorConstraintInterface { /* ... */ }

export function IsXxx(options?: ValidationOptions): PropertyDecorator { /* registerDecorator(...) */ }
```

约束类里**不要注入依赖**：class-validator 会自己 `new` 它。确实需要注入时（比如异步查库），必须先从 `class-validator` 引入 `useContainer` 并绑定 Nest 容器 —— Nest 没有 `app.useContainer`：

```ts
import { useContainer } from 'class-validator';

useContainer(app.select(AppModule), { fallbackOnErrors: true });
```

但更好的做法是别这么做：「这个值是否合法」不该依赖数据库，见 §6。

## 6. 自定义校验逻辑放哪

| 场景 | 放在哪 | 例子 |
| --- | --- | --- |
| 格式正确性（长度、正则、枚举、范围） | **DTO 上的装饰器** | `@Length(2, 40)`、`@IsEnum(UserRole)` |
| 单字段取值规则（保留字、正则、业务枚举） | `@ValidatorConstraint` + `registerDecorator` | `src/contract/validation/`（可复用）或 DTO 同目录（局部） |
| 跨字段一致性（`endAt > startAt`、二选一必填） | **DTO 类的自定义校验器**（拿得到整个对象） | 类上加 `@IsXxx()`，约束类里读 `args.object` |
| 需要读数据库/外部服务（邮箱是否已存在） | **不进 DTO** —— 交给 service，抛具名业务异常 | `EmailAlreadyExistsException`（409） |
| 整条路由跳过校验 | 参数级 `@RawBody()` | `docs` §4.3 |

最后两行是**有意的边界**：管道只做"这个值形状对不对"的同步判断，
"这个值在系统里能不能用"是业务规则 —— 放进去会让 DTO 依赖 repository、单测必须打桩、
而且校验错误和业务错误会混成同一个状态码。

写自定义约束的三个坑（`src/contract/validation/is-not-reserved-name.validator.ts` 三条都有对照）：

1. `@ValidatorConstraint({ name })` 的 `name` 要和 `registerDecorator` 里用的一致，否则 `errors[].message` 里会冒出 `undefined`；
2. nil 值要自己放行（返回 `true`），否则"字段缺失"和"字段非法"会报同一条错误 —— 缺失该由 `@IsOptional()` / 必填装饰器管；
3. 约束类要被 `@Injectable()` 标注（即使没有依赖），否则以后想注入 `ConfigService` 之类的会静默失效。

### 6.1 为什么路由参数用 DTO，而不是 `ParseIntPipe`

`@Param('id', ParseIntPipe)` 的异常是在**构造函数里造好的**、只接受一个字符串，
所以内建消息长这样：

```
Validation failed (numeric string is expected)
```

**没有字段名**，前端没法把它映射回表单；而且它只检查"是不是数字字符串" ——
`/users/0`、`/users/-5` 都会通过。

改用 DTO 之后：

```ts
export class UserIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number;
}
```

`field: "id"` 有了，`0` 和负数也被挡住。代价是 `@Type(() => Number)` 不能省。

## 7. 分页查询

封装在 `src/contract/pagination/`，任何列表接口直接复用：

```ts
// src/contract/pagination/pagination-query.dto.ts
export class PaginationQueryDto {
  @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @Type(() => Number)
  @Transform(({ value }) => Math.min(Number(value), PAGE_SIZE_MAX))
  @IsInt() @Min(1)
  limit: number = PAGE_SIZE_DEFAULT;
}
```

```ts
// src/contract/pagination/paginated-result.ts
export interface PaginationMeta { totalItems; itemsPerPage; currentPage }
export interface PaginatedResult<T> { data: T[]; meta: PaginationMeta }
export function buildPaginatedResult<T>(data: T[], totalItems: number, query): PaginatedResult<T>
```

用法（`src/modules/validation-demo/dto/query-users.dto.ts`）：

```ts
export class QueryUsersDto extends createPaginationQueryDto(['id', 'name', 'email']) {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
}
```

service 只返回 `buildPaginatedResult(...)`，**不需要**知道响应信封的存在；
`ResponseEnvelopeInterceptor` 会把 `data` / `meta` 提到信封顶层（见 §9）：

```json
{
  "success": true,
  "data": [ /* 这一页的数据 */ ],
  "meta": { "totalItems": 3, "itemsPerPage": 50, "currentPage": 1 }
}
```

`meta` 只有三个字段，全是**服务端才知道**的数：

| 字段 | 含义 |
| --- | --- |
| `totalItems` | 过滤之后的总条数（不是这一页的长度） |
| `itemsPerPage` | 这一页的页大小（已按 `PAGE_SIZE_MAX` 截断） |
| `currentPage` | 当前页码（从 1 开始） |

**没有 `totalPages`**：它是 `Math.ceil(totalItems / itemsPerPage)`，客户端一行就能算出来。
服务端多传一个可推导的字段，只是多一个"可能和另外两个不一致"的地方 ——
尤其当 `totalItems` 以后换成估算值（见下面"有意没做的"）时，`totalPages` 会跟着变成估算，
不如让客户端自己算。前端要显示"第 x / y 页"就 `Math.ceil(totalItems / itemsPerPage)`。

**它是怎么被认出来的**：`buildPaginatedResult()` 在返回值上打了一个**非枚举**的 `PAGINATED_RESULT`
symbol（`Object.defineProperty(result, PAGINATED_RESULT, { value: true })`）。
非枚举 ⇒ `JSON.stringify` 看不见它，wire 形状与 `PaginatedResult<T>` 类型都没变；
用 symbol 而不是结构判断（`'data' in v && 'meta' in v`）⇒ 普通域对象即使刚好有 `data` / `meta`
字段也不会被误判成分页结果、字段被静默提到顶层。

### 三个设计决策及其依据

| 决策 | 依据 |
| --- | --- |
| `limit` 超上限**截断**而不是 400 | [Google AIP-158](https://google.aip.dev/158)："should coerce down to the maximum permitted page size"。垃圾输入（`?limit=abc`）仍然 400 |
| `sortBy` 白名单做成**必填参数** | [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate) 把 `sortableColumns` 标为 `Required: true`。排序字段最终进 `ORDER BY`，必须是硬白名单；漏传白名单时 `sortBy` 只会被丢掉，**不会**退化成"随便排序" |
| `meta` 字段命名 `totalItems` / `itemsPerPage` / `currentPage` | 对齐 nestjs-paginate（JSON:API 风格），以后换库或对齐前端都不用改字段名 |
| `meta` 里**不放** `totalPages` | 可推导字段不重复传：`Math.ceil(totalItems / itemsPerPage)` 客户端能算，且以后 `totalItems` 变估算值时不会自相矛盾 |

### 有意没做的

- **`links`（first/next/last）**：拼 URL 需要知道请求基址，属于 HTTP 层（interceptor / controller），不该塞进 DTO。
- **省略 / 估算 `total`**：现在内存 count 是 O(1)。上数据库后 `COUNT` 会变贵，那时参考 AIP-158 的 "total_size may be an estimate" 和 nestjs-paginate 的 `buildCountQuery` / `optimizedCount`。
- **游标分页**：数据量大之后再说。届时的形态是 `?cursor=xxx&limit=20`，游标必须是**不透明字符串**（AIP-158：base64 不算混淆），所以用 `@IsString()` 而不是 `ParseIntPipe`。
- **稳定排序的 tiebreaker**：内存里无所谓；上数据库后 `ORDER BY created_at DESC, id DESC` 必须补，否则翻页会漏行/重复行（nestjs-paginate 明确要求"at least one column must be unique"）。

## 8. 桶文件（index.ts）

### 能不能用：能

实测三层解析都通过（因为 `package.json` **没有** `"type": "module"`，产物是 **CJS**，而 CJS 原生支持"目录 → `index.js`"）：

| 层 | 目录导入 `from './dir'` → `dir/index.ts` |
| --- | --- |
| jest（ts-jest + 默认 resolver） | ✅ |
| tsc（`moduleResolution: nodenext`） | ✅ |
| Node CJS 运行时（`require('./dist/contract')`） | ✅ |

> ⚠️ 一旦给 `package.json` 加上 `"type": "module"`，这条立刻失效（ESM 不做目录解析），
> 桶文件得写成 `./dir/index.js`。

### 两个实测出来的隐患

**① `import type` 会让校验静默失效（最致命）**

`import type { CreateUserDto } from '@/contract'` 看起来很自然，但类型导入会被运行时擦除 →
`emitDecoratorMetadata` 只能发出 `Object` → 而 `Object` 正好在 `ValidationPipe.toValidate()`
的跳过名单 `[String, Boolean, Number, Array, Object, Buffer, Date]` 里 → **整个管道放行**。

实测两个只差一个 `type` 的控制器，发同样的非法 body `{"name":123}`：

```
import { ProbeDto } from './index';        →  400  ✅
import type { ProbeDto } from './index';   →  201  ← 校验消失，无任何报错或警告
```

官方文档也点名了这条："you can't use a type-only import as that would be erased at runtime"。

**② 循环依赖时，`export *` 的顺序决定谁拿到 `undefined`**

两个模块互相通过同一个桶引用时：

```
CycleA.ref = undefined
CycleB.ref = [class CycleA] { tag: 'A', ref: undefined }
```

**先被 `export *` 的那个拿到 `undefined`** —— 往桶里加一行就可能弄坏无关模块。
在 Nest 里它表现为 `@Type(() => X)` 静默失效，或 `Nest can't resolve dependencies`。

（次要：`isolatedModules: true` 下，`export { SomeType } from './x'` 而 `SomeType` 是纯类型时必须写 `export type`；桶还会把整棵子树拉进模块图，改变装饰器求值顺序 —— 正是 ② 的触发器。）

### 本仓库的规矩

- 门面桶放在**契约层根目录**：`src/contract/index.ts`，只导出外部要用的东西，
  且**用显式具名导出而不是 `export *`**（避开 ② 的顺序问题与重名遮蔽）。
- **契约层内部互相引用走具体文件**，绝不走桶 —— 这样桶永远不参与循环依赖。
- 消费方**绝不能**对 DTO / 模块写 `import type`（第 ① 条）。

## 9. 响应契约

设计原则一句话：**body 里只放 HTTP 层给不了的东西**。

### 9.1 形状：`success` 是唯一判据

```jsonc
// 成功 · 单个资源（HTTP 200）
{ "success": true, "data": { "id": 1, "name": "Neo" } }

// 成功 · 列表（分页）：data 是数组，meta 提到顶层
{ "success": true, "data": [ ... ],
  "meta": { "totalItems": 3, "itemsPerPage": 50, "currentPage": 1 } }

// 成功 · handler 没 return（HTTP 201）
{ "success": true, "data": null }

// 失败 · 校验（HTTP 400）：带 code / traceId / 字段级明细
{ "success": false, "error": "Bad Request", "message": "Request validation failed",
  "code": "VALIDATION_FAILED", "traceId": "3f1c9a4e-…",
  "errors": [ { "field": "address.city", "location": "body", "code": "INVALID_LENGTH",
                "message": "city must be longer than or equal to 2 characters" } ] }

// 失败 · 业务（HTTP 404 / 409）：没有 errors 就没有那个键，但 code 有
{ "success": false, "error": "Not Found", "message": "user 999999 not found",
  "code": "USER_NOT_FOUND", "traceId": "3f1c9a4e-…" }
{ "success": false, "error": "Conflict", "message": "email neo@example.com already exists",
  "code": "EMAIL_ALREADY_EXISTS", "traceId": "3f1c9a4e-…" }

// 失败 · 框架（未匹配路由的 404）：没有业务 code
{ "success": false, "error": "Not Found", "message": "Cannot GET /nope", "traceId": "3f1c9a4e-…" }
```

| 字段 | 恒有？ | 谁产出 | 给谁用 |
| --- | --- | --- | --- |
| `success` | 是 | 两侧 | **唯一判据**：`true` 必有 `data`，`false` 必有 `error` + `message` |
| `data` | **仅成功** | interceptor | 业务数据；分页时是这一页的数组 |
| `meta` | 仅成功且仅有元数据时 | interceptor | 分页元信息：`totalItems` / `itemsPerPage` / `currentPage` |
| `error` | **仅失败** | filter | HTTP 状态短语 |
| `code` | 仅失败且**有语义**时 | filter（业务异常 / 校验） | **机器判据**（见 §9.8） |
| `traceId` | 仅失败（真实请求里恒有） | filter（读请求 id） | 把响应和日志对上（见 §9.8） |
| `message` | **仅失败** | filter | 人类可读说明（校验失败时是固定概述） |
| `errors[]` | 仅失败且仅有明细时 | filter（校验类 / 内建管道） | `field` 映射到表单字段，`location` 说明来源，`code` 给机器，`message` 给终端用户 |

**`data` 与 `error` 互斥**：handler 抛异常时成功信封根本不参与（异常直接冒泡到 filter），
所以客户端永远不需要处理"既带 data 又带 error"的响应 —— 而 `success` 就是这件事的显式化。

**成功响应没有 `message`**：成功文案该由前端按接口 / `data` 自己出（前端有 i18n 与设计规范）。
后端下发文案只会让它变成事实上的对外契约，改一个字都变成破坏性变更 —— 这和 AIP-193
对 `Status.message` 的警告是同一个机制。失败侧的 `message` 保留，因为它是人话说明、
是 `errors[]` 之外唯一的可读信息。

推荐类型（前端只需要一个，`success` 是字面量类型 ⇒ 自动收窄）：

```ts
// 定义在 packages/api-contract，前后端同一份
import type { ResponseBody } from '@nest-start/api-contract';

type Body = ResponseBody<User>;
// body.success === true  → body.data 可用
// body.success === false → body.error / body.code / body.traceId / body.message / body.errors 可用
```

前端一个分支收口：

```ts
if (!body.success) {
  toast(body.message);
  switch (body.code) {                  // 机器判据，不要正则匹配 message
    case 'EMAIL_ALREADY_EXISTS': markField('email', body.message); break;
    default: mapFieldsToForm(body.errors);
  }
  return;
}
use(body.data);
```

### 9.2 数字状态码：只活在 HTTP 状态行

**body 里没有 `statusCode`**（成功侧、失败侧都没有）。理由三条：

1. **可推导**：前端从 `res.status`（axios 是 `error.response.status`）本来就能拿到；
   单个判据是 `success`，不需要在 body 里再问一次"本次请求成功了吗"。
2. **会漂移**：body 里那份是"另一次记录"，没有任何机制保证它与状态行一致 ——
   和 `meta.totalPages` 被删掉是同一条理由（可推导的字段不重复传）。
3. **分工**：状态码属于 HTTP 层（RFC 9110），body 放业务数据。

实现上：

- **成功侧**不碰状态码：`@Post()` 的 201、`@HttpCode(204)` 之类的赋值发生在
  `RouterExecutionContext.create()` 里、**跑拦截器之前**（`responseController.setStatus(res, httpStatusCode)`），
  拦截器只负责包 body。
- **失败侧**由过滤器按异常的真实状态设置：`response.status(exception.getStatus()).json(body)`；
  非 `HttpException` 固定 500。所以 `.expect(201/400/404/409)` 这类断言落在 HTTP 层 —— 那才是它的位置。

### 9.3 两侧分别在哪实现

| 侧 | 实现 | 挂载 |
| --- | --- | --- |
| 成功 | `ResponseEnvelopeInterceptor` | `APP_INTERCEPTOR`（`ApiContractModule.forRoot()` / `forRootAsync()`） |
| 失败 | `AppExceptionFilter`（`@Catch()`） | `APP_FILTER`（同一个模块） |
| 请求 id | `RequestIdMiddleware` | 模块的 `configure()`：`forRoutes('/{*splat}')` |

`APP_*` 是 Nest 用来「全局挂增强器」的 token：`scanner` 会把整张模块图里这些 token 的 provider
**实例**收进 `ApplicationConfig`。所以 `imports: [ApiContractModule.forRoot()]` 一行就够，
`main.ts` 保持干净。

三个实现上有讲究的地方：

1. **选项走 `API_CONTRACT_OPTIONS` 这个 DI token**（不再在 `forRoot()` 里 `useValue` 死）。
   于是一份改动同时解决两件事：`forRootAsync()` 能实现（选项可以来自 `ConfigService`），
   测试里能 `overrideProvider(API_CONTRACT_OPTIONS)` 换配置。
   代价是 `envelope` 开关必须挪进拦截器**运行时**判断（静态 provider 列表没法按异步工厂的结果增删）。
2. **信封幂等**：每个 `APP_INTERCEPTOR` 实例都会跑一遍 `map()`，而 `ApiContractModule`
   可能被 import 多次（某个 `SharedModule` 顺手又 import 一次）—— 实测会套出
   `{"success":true,"data":{"success":true,"data":{…}}}`。所以拦截器给产物打一个**非枚举**
   `ENVELOPED` symbol，已经包过就原样放行。`APP_FILTER` 侧无此问题（`ExceptionsHandler`
   命中第一个匹配的过滤器就返回）。
3. **请求 id 中间件也是幂等的**（请求对象上已有 id 就跳过），并且**不能用 `forRoutes('*')`**：
   Nest 11 底层是 Express 5，path-to-regexp v8 要求通配符必须命名，`'*'` / `'/*'` / `'(.*)'`
   会直接抛 `TypeError: Missing parameter name`；`'/{*splat}'` 才是 v8 的写法（`{}` 表示可选，
   根路径也覆盖）。

**异常过滤器把细节挡在里面**（RFC 9457 §5 / OWASP）：非 `HttpException` 一律回
`{ success: false, error: 'Internal Server Error', message: 'Internal server error',
code: 'INTERNAL_ERROR', traceId }`（HTTP 500），
堆栈、SQL、类名只进日志 —— 不通过 HTTP 泄漏实现细节。`traceId` 是日志与响应之间唯一那根线。

**业务异常集中 `src/modules/validation-demo/exceptions.ts`**，都继承契约层的 `ApiException`
（`code` + 文案 + 状态码三件事绑在一处）：

```ts
export class EmailAlreadyExistsException extends ApiException {
  constructor(email: string) {
    super(ErrorCode.EMAIL_ALREADY_EXISTS, `email ${email} already exists`, HttpStatus.CONFLICT);
  }
}
```

### 9.3.1 过滤器还要管"别人抛的异常"

Nest 内建 / 第三方管道与守卫抛异常的**传统载荷**是 `{ statusCode, message: string[], error }`
（`ParseFilePipe`、任何人局部挂的 `new ValidationPipe()`、第三方模块…）。如果只认
`typeof message === 'string'`，这些异常的 `message` 会退化成状态短语、明细**全丢**：

```http
GET /validation-demo/pipe-order/array-message       # throw new BadRequestException([...])
# 修复前：{"success":false,"error":"Bad Request","message":"Bad Request"}
# 现在：  {"success":false,"error":"Bad Request","message":"title must be a string",
#          "errors":[{"field":"(request)","message":"title must be a string"},
#                    {"field":"(request)","message":"title too long"}]}
```

规则：**出口只有一个形状**。数组型 `message` 逐条转成 `errors[]`（它们不带字段名，
所以 `field` 是 `'(request)'`，硬编一个字段名比写 `'(request)'` 更误导），
`message` 兜底成第一条明细。没有这一层，契约只在"自己写的管道"上成立。

另外两个小口子也在这一个函数里收掉：空字符串 `message`（`new NotFoundException('')`）
fallback 到状态短语；`response.headersSent` 为真时（`@Sse()` 已建流后抛错）直接记日志返回，
否则 `status().json()` 会抛 `ERR_HTTP_HEADERS_SENT` —— 过滤器自己变成未处理异常。

### 9.4 边界：什么时候不套信封

"永远一致"的前提是**请求真的走完了 Nest 的请求管线**。所以：

| 情况 | 行为 | 为什么 |
| --- | --- | --- |
| handler 没有 `return`（`undefined` / `null`） | **套**：`{ success: true, data: null }` | 没有信封时它是**空响应体**（`express-adapter` 的 `reply()` 遇到 `isNil` 会 `send()` 空体），前端连 `Content-Type` 都拿不到；要真的空体就 `@HttpCode(204)` + `@NoEnvelope()` 一起用 |
| `@Res()` / `@Next()`（没有 `passthrough`） | 不套（返回值本来就被丢弃，包了也到不了客户端） | `router-execution-context.js` 的 `isResponseHandled`：`!isResponseHandled && apply(...)` |
| `@Res({ passthrough: true })` | **套** | 它仍然走 `apply()`，属于 Nest 管理的响应 |
| `@Render()` | **跳过** | 走 `responseController.render()`，包住会毁掉渲染上下文 |
| `@Redirect()` | **跳过** | 走 `responseController.redirect()`，包住会丢掉 `Location` |
| `@Sse()` | **跳过** | 逐条消息序列化（`writeMessage`），每条都被包一层就破坏了 SSE 协议 |
| `StreamableFile` | **跳过** | `reply()` 里它走 `stream.pipe(response)`，包成 JSON 会毁掉文件下载 |
| `@NoEnvelope()` | **跳过** | 显式逃生门（见下） |
| `forRoot({ envelope: false })` | 成功侧**全部跳过** | 关掉信封就没有 `success` 字段；失败侧不受影响（全局过滤器始终生效） |

跳过是怎么实现的：拦截器读 `@nestjs/common/constants` 的
`RENDER_METADATA='__renderTemplate__'` / `REDIRECT_METADATA='__redirect__'` / `SSE_METADATA='__sse__'`
（方法级或控制器级），命中就 `return next.handle()` 原样放行。

`@NoEnvelope()` 是给"必须保持裸形状"的接口准备的显式开关 —— 刻意做成装饰器而不是
"自动识别某些类型"，因为隐式规则会在框架升级时**静默**改变 wire 形状：

```ts
@Get('legacy')
@NoEnvelope()
legacy() { return { old: 'shape' }; }   // HTTP 200 {"old":"shape"} —— 没有 success
```

### 9.5 为什么不把 HTTP 状态码也统一成 200

"所有响应都 200，靠 body 判成败"能省掉前端的 `res.status` 判断，但代价是协议层不再表达失败，
而 `success` 已经让前端**只写一套分支**了。所以本仓库不做这件事，理由：

| 依据 | 结论 |
| --- | --- |
| [RFC 9110 §15.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.1) | 200 的语义是 "the request has succeeded"。失败标 200 是协议层的错误陈述，不是风格问题 |
| [RFC 9110 §15.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.1) | 200 是**可启发式缓存**的状态码（400 / 409 不是）→ 失败改成 200 之后，中间缓存**可以合法缓存失败响应**，必须再手动补 `Cache-Control: no-store` |
| [Google AIP-193](https://google.aip.dev/193) | HTTP/1.1+JSON 的错误体里 `code` 就是 **HTTP 状态码**（其示例含 404 / 429）；Google 全线 API 错误返回真实 4xx/5xx |
| 监控 / 网关 / APM | 全部按状态码统计错误率；全 200 之后错误率恒为 0，报警与 SLO 静默失效 —— 这是上线后才会暴露的那类损失 |
| 客户端库 | axios / fetch 封装、`Retry-After` 重试、302 Location 都依赖状态行；全 200 会让它们全部失效 |

真遇到只认 200 的老网关时，正确做法是加一个**显式开关**（例如
`ApiContractOptions.forceOkStatus`：只压平状态行，其余契约不动），而不是把默认行为改成全 200。

### 9.6 有意没做

- **`application/problem+json` 媒体类型**：只在对外公开 API 时才值得；内部 SPA 用自定义信封更省事。
- **成功响应的提示文案**：本仓库刻意不下发（见 §9.1）；如果哪天真需要，也应该像 `code` 一样
  走**稳定的语义标识**，而不是把一段给人看的文案当契约。
- **`message` 的 i18n**：现在是硬编码英文，且校验类 `message` 由 class-validator 的模板产出。
  真要做多语言，得在 `exceptionFactory` 里把 `constraints` 的 key 映射成自己的文案表（而不是 parse 文案）
  —— 好消息是有了 `errors[].code` 之后，前端可以先按 code 出文案，
  不依赖服务端文案也能工作。
- **`error`（HTTP 状态短语）**：它是失败侧唯一还带状态色彩的字段，虽然可由状态码推导，
  但目前作为"无需查表的人话标识"保留；`code` 落地之后，它是第一个可以删的字段。
- **成功侧的 `traceId`**：现在只有失败响应带 `traceId`（成功响应只在 `x-request-id` 响应头里）。
  要不要进 body 取决于前端排障时会不会拿着成功响应的 id 去查日志 —— 头部其实已经够了。

已经做掉的（曾经列在这里）：

- **机器可读的错误码（`code`）** —— 见 §9.8。语义化的枚举 + 约束名映射表，
  并且编译期断言保证 `ErrorCode` 值对象覆盖共享联合类型的每个成员。
- **`traceId`** —— 见 §9.8。请求 id 中间件 + `AsyncLocalStorage`，同时进响应头、错误体和日志。

### 9.7 OpenAPI 投影（`/docs`）

契约是**运行时行为**（拦截器 + 过滤器），TypeScript 类型不会自动变成 OpenAPI，所以有一层
**手工投影**，全部集中在 `src/swagger/`（`src/contract/` 保持零 Swagger 依赖）：

| 文件 | 职责 |
| --- | --- |
| `setup-swagger.ts` | `buildDocument(app)`（**唯一构建入口**：`DocumentBuilder` + `extraModels` + 注入信封组件）与 `setupSwagger(app)`（`SwaggerModule.setup('docs', …)`） |
| `export-openapi.ts` | `pnpm openapi:export`：用同一个 `buildDocument()` 写出 `openapi/openapi.json` |
| `is-swagger-enabled.ts` | 启停规则纯函数 |
| `envelope.schema.ts` | 信封与 `errors[]` 的 schema 定义 + 失败示例（**唯一手写处**；结构由 e2e 的**双向守卫**与运行时对齐，枚举取值来自契约层） |
| `api-envelope.decorator.ts` | `@ApiOkEnvelope(dto, '…')` / `@ApiCreatedEnvelope(dto, '…')` —— 成功响应一行 |
| `api-errors.decorator.ts` | `@ApiEnvelopeErrors()`（类级挂 400/404/500）、`@ApiEnvelopeConflict()`（方法级挂 409） |

**双向守卫**（`openapi.e2e-spec.ts`）：拿一条真实的校验失败响应，逐条比对
`ERROR_DETAIL_SCHEMA.properties` —— 运行时多出 schema 没声明的键、或 schema 的 `required`
在运行时缺席，都会红。这是"契约层不能依赖 Swagger、结构只能手写"的等价安全网。

### 控制器里只留业务语义

这是本仓库对"Swagger 太吵"的答案（参考社区主流做法，底层用 Nest 官方文档推荐的
`getSchemaPath()` + `refs()` 泛型响应写法，包成薄装饰器）：

```ts
@Post('users')
@ApiOperation({ summary: '创建用户（body 走全局校验管道）' })
@ApiCreatedEnvelope(UserDto, '创建成功')
@ApiEnvelopeConflict()
create(@Body() dto: CreateUserDto) { return this.users.create(dto); }
```

三条约定：

1. **信封、`$ref`、状态码的拼装都在 `src/swagger/`** —— 控制器里不出现 `allOf` / `$ref` / 内联 `example`；
2. **示例只挂在 DTO 字段上**（`@ApiProperty({ example })`），不在每条路由上抄一遍 ——
   抄的示例既占地方，又会在字段改名后漂移（本次重构就是把这些删掉：`validation-demo.controller.ts` 235 → 151 行）；
3. **class-validator 与注释自动变 schema**（CLI 插件），所以没有 `@ApiQuery` / `@ApiBody`。

### 五个实测出来的关键点（都钉在 `openapi.e2e-spec.ts` 里）

1. **`$ref` 不会自动生成组件**：`SwaggerModule.createDocument()` 只为它**探测到的模型类**建
   `components.schemas`。所以：
   - 信封的 `ResponseEnvelope` / `ErrorEnvelope` / `ErrorDetail` 是**手工注入**的；
   - **只作为响应出现的 DTO**（`UserDto` 等）要列进 `setup-swagger.ts` 的 `RESPONSE_MODELS`，
     否则 `data.$ref` 指向一个不存在的组件 —— **而且按名字断言的测试依然全绿**（`$ref` 字符串没变）。
     这条已经用一条**通用守卫**兜住：把 `$ref` 全扫出来，任何一个在 `components.schemas` 里找不到就红。
     （这个坑是真实的：把 `@ApiResponse({ type: [UserDto] })` 换成手写 `schema` + `$ref` 之后，
     `type` 那个"顺带注册模型"的副作用就没了。）
2. **类级失败响应 + 方法级成功响应**：`exploreGlobalMetadata()` 在**类级**读 `@ApiResponse` 并 merge 进该控制器的每条路由，
   所以 400/404/500 写一次就够。**但方法级一旦有 `@ApiResponse`，`exploreApiResponseMetadata()` 会直接返回、不再与类级合并** ——
   所以别把 400 也写到方法上，否则那条路由会丢掉类级的全部失败响应。
3. **`@ApiTags()` 必须显式**：v11 的 `autoTagControllers` 默认 `false`，不打标签的话 UI 里全堆在 default 组。
4. **`setupSwagger()` 必须在 `listen()`/`init()` 之前调用**：`NestApplication.init()` 会注册
   "未匹配路由 → 404 失败信封"的钩子，之后再往 Express 上挂 `/docs-json` 就永远轮不到它（实测 404）。
5. **`type: [Dto]` 与手写 `items.$ref` 的语义不同**：前者是"整个响应是数组"，后者才是"信封里的 `data` 是数组"。
   所以 `data` 是数组时必须用 `{ type: 'array', items: { $ref } }`（`refs(dto)` 生成）。

#### 为什么大部分 schema 不用手写

`nest-cli.json` 里启用了 `@nestjs/swagger` 的 CLI 插件，它会读 DTO 上的 class-validator 装饰器与注释：

| DTO 上写的 | 文档里出现的 |
| --- | --- |
| `@Length(2, 20)` | `minLength: 2, maxLength: 20` |
| `@IsEmail()` | `format: 'email'` |
| `@Min(0) @Max(150)` | `minimum: 0, maximum: 150` |
| `@IsOptional()` | 不进 `required` |
| `/** 注释 */`（`introspectComments: true`） | `description` |

**测试里也要装同一套插件**：jest 走 ts-jest、在内存里编译，不经过 Nest CLI 的 AST 变换，
所以 `jest-e2e.json` 给 `ts-jest` 挂了 `astTransformers.before`，桥接文件是仓库根的
`jest-swagger-transformer.js`（官方写法，改配置要递增里面的 `version` 来让 jest 换缓存）。

**仍然显式写 `@ApiProperty` 的地方**（不靠插件推）：

- **枚举**（`role`）：实测插件在 Nest CLI 下能推出 `enum`，但在 ts-jest 下会因为解析不到跨文件导入的
  `UserRole` 而退化成 `{ type: 'object' }`。Schema 是对外契约，不能依赖"某个构建路径恰好能推出来"。
- **分页参数**：`PaginationQueryDto` 被所有列表接口复用，显式写死 schema 更不容易整体漂移；
  `sortBy` 的枚举还只有调用方（`createPaginationQueryDto([...])`）知道，而那个类是函数体内动态生成的。
- **信封**：契约层零 Swagger 依赖（`ErrorDetail` 现在是**纯类型**，定义在共享契约包里），
  所以信封结构只能在 `envelope.schema.ts` 手写；`code` / `location` 的**取值集合**仍从契约层取
  （`Object.values(ErrorCode)` / `ERROR_LOCATIONS`），结构则由 §9.7 开头那条**双向守卫**钉住。

**单一构建入口**：`buildDocument(app)` 是唯一一处 `DocumentBuilder` / `extraModels` / 信封组件注入。
`setupSwagger()` 和 `openapi.e2e-spec.ts` 都调它 —— 以前测试里自己又拼了一份，
于是入口改了 title 或 `extraModels` 而测试照样全绿（那种测试等于没测）。

**落盘产物**：`pnpm openapi:export` 用同一个 `buildDocument()` 写出 `openapi/openapi.json`，
给前端生成类型（`openapi-typescript` / `orval`）以及在 CI 里做破坏性变更检测（`oasdiff`）。

### 9.8 错误码 / 位置 / 请求 id

这三件事解决的是同一个问题：**让机器和排障的人都能不依赖文案地拿到信息**。

#### `code`：语义化，不是约束名

| 层 | 取值 | 例子 |
| --- | --- | --- |
| 顶层 `code` | 业务语义 | `VALIDATION_FAILED` / `EMAIL_ALREADY_EXISTS` / `USER_NOT_FOUND` / `UNAUTHENTICATED` / `INTERNAL_ERROR` |
| 字段级 `errors[].code` | **校验语义** | `REQUIRED` / `INVALID_TYPE` / `INVALID_FORMAT` / `INVALID_LENGTH` / `OUT_OF_RANGE` / `NOT_ALLOWED_VALUE` / `RESERVED_NAME` / `TOO_MANY_ITEMS` / `UNKNOWN_FIELD` / `UNKNOWN_CONSTRAINT` |

与认证相关的顶层 code 只有 `UNAUTHENTICATED`（401），命名对齐
[AIP-193](https://google.aip.dev/193)。**本仓库只做认证、没有授权层**，
所以没有 403 / `PERMISSION_DENIED`：

| 语义 | 状态码 | code | 谁抛 | `WWW-Authenticate` |
| --- | --- | --- | --- | --- |
| 没带凭证 / 格式不对 | 401 | `UNAUTHENTICATED` | `JwtAuthGuard` | ✅ `error="invalid_request"` |
| 凭证无效 / 已过期 | 401 | `UNAUTHENTICATED` | 同上 | ✅ `error="invalid_token"` |
| 登录时凭证不对 | 401 | `UNAUTHENTICATED` | `AuthService`（`InvalidCredentialsException`） | ❌ 刻意不带（那是"访问受保护资源"的语义） |

这些失败都**不**带 `errors[]`（粒度是整个请求，没有字段级明细可给）。
完整方案见 [`docs/authentication.md`](authentication.md)。

字段级 code 刻意**不用** class-validator 的约束名（`isInt` / `min` / `matches`）：
那是库的实现细节，换到 Zod 就全变了。中间隔一张 `VALIDATION_CONSTRAINT_CODES` 映射表，
对外只承诺语义 —— 换库只改表。

来源三处：

- 校验失败 → `createValidationExceptionFactory()` 直接给 `VALIDATION_FAILED` + 每条明细的字段级 code；
- 业务异常 → `class XxxException extends ApiException`（`code` + 文案 + 状态码绑一处）；
- 框架自己抛的异常 → **没有** code（硬塞一个由状态码推导出来的 code 会把
  "状态码只在状态行"这条设计又破坏掉）。

**`code` 不能改名**（改名等于破坏性变更），`message` 随便改。`ErrorCode` 的**类型**在
`packages/api-contract`（前后端共享），**值对象**在 `src/contract/validation/error-code.ts`，
两者之间有一句编译期断言：共享联合类型加了成员而值对象没跟上 —— 构建直接红。

#### `location`：同名不同源能分清

`field: "id"` 到底是 body 的 `id` 还是 path param 的 `id`？JSON:API 用
`source.pointer` / `source.parameter` 分开表达，我们也分开：

```
GET  /validation-demo/users/abc   → { field: "id", location: "param", code: "INVALID_TYPE" }
POST /validation-demo/users {id:…}→ { field: "id", location: "body",  code: "INVALID_TYPE" }
GET  /validation-demo/users?page=abc → { field: "page", location: "query" }
```

为什么必须**继承 `ValidationPipe`**（`ContractValidationPipe`）而不是改 `exceptionFactory`：
`exceptionFactory(errors)` 的入参只有 `ValidationError[]`，`ArgumentMetadata` 在
`transform()` 的局部作用域里 —— 工厂拿不到。`transform()` 手里同时有 `metadata.type`
和"校验失败会抛什么"，所以在那里做一次浅包装：只给 `errors[]` 加 `location`，
不改校验逻辑、不改状态码、不改文案；不是本仓库那种对象载荷的异常原样放行（交给过滤器规范化）。

#### `traceId`：响应、响应头、日志三点对齐

`RequestIdMiddleware` 每个请求做三件事：写 `AsyncLocalStorage`、回写 `x-request-id` 响应头、
失败时由过滤器读进 `traceId`。于是：

```bash
$ curl -si localhost:3000/validation-demo/users/999999 | grep -i -e x-request-id -e traceId
x-request-id: 97f26779-3a1c-4b39-bce4-9342397f9fe0
{"success":false,…,"traceId":"97f26779-3a1c-4b39-bce4-9342397f9fe0"}
# 日志里同一行：Unhandled exception on GET /… [97f26779-…]
```

客户端带 `x-request-id` 时**沿用**（跨服务链路才连得上），但只接受
`^[A-Za-z0-9._-]{8,128}$` 的值，不合法的换成服务端 UUID ——
响应头和日志里不该出现客户端可控的任意内容。

两个边界：

- **body 解析失败时没有 traceId**：中间件跑在 body-parser 之后，畸形 JSON 的 400
  走的是解析器的错误通道。所以 `traceId` 在 OpenAPI schema 里**不是** required 字段。
- 成功响应只有 `x-request-id` 响应头，没有 body 字段 —— 成功响应 shape 保持"只有 data/meta"。

### 依据

| 来源 | 用在哪 |
| --- | --- |
| [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) §15.3.1 / §15.1 | 200 的语义；以及为什么失败响应不该伪装成 200（可启发式缓存） |
| [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.txt) | 错误响应要携带 machine-readable details；原文明确 **"Consumers SHOULD NOT parse the `detail` member for information"** —— 字段定位要用结构化扩展成员；§5 不泄漏实现细节 |
| [Google AIP-193](https://google.aip.dev/193) | **"machine actors do not need to parse error messages to extract information"**；错误体与 HTTP 状态码的对应关系；`message` 一旦被依赖就不可改 |
| [Google AIP-158](https://google.aip.dev/158) | 分页 `limit` 超上限「coerce down」 |
| [JSON:API errors](https://jsonapi.org/format/#error-objects) | 字段定位用 `source: { pointer \| parameter }`；`data` 与 `errors` 不同时出现 |
| [nestjs-paginate](https://github.com/ppetzold/nestjs-paginate) | `meta` 字段命名与 `sortableColumns` 必填 |
| [OWASP](https://owasp.org/www-project-web-security-testing-guide/) | 错误响应不暴露堆栈 |

---

## 10. 三个会破坏契约的边界（都实测过）

契约测试最容易漏的不是"正常路径"，而是下面这三类**形状没变、语义已经错了**的情况。
每一次发现的过程与复现命令记在 [`docs/review-backlog.md`](review-backlog.md) §1。

### 10.1 `@IsOptional()` 会放行 `null`

class-validator 的官方语义是"值为 `null` **或** `undefined` 时跳过该属性上的**所有**校验"，
不是"字段可以不存在"。于是：

```http
PATCH /validation-demo/users/1  {"tags": null}
# 修复前：200，响应里 `tags: null` —— 而 UserDto.tags 是 string[]、OpenAPI 里是 required 的 array
# 现在：  400，errors: [{ field: "tags", location: "body", code: "INVALID_TYPE" }]
```

**运行时响应违反了自己发布的 schema**，而按"键集"断言的契约测试照不到它（键没变，值错了）。

两条规矩：

- 想表达"可以不传、但传了不能是 `null`" → `@IsOptionalNotNull()`（`ValidateIf(value !== undefined)`）；
- `PartialType` 派生的 Update DTO 必须显式 `PartialType(CreateUserDto, { skipNullProperties: false })`
  —— 这个选项的语义是**反着的**（`false` = 不跳过 null = null 也要过校验），默认值会再挂一遍
  `@IsOptional()`，把漏洞放回来；
- 如果某个字段的业务语义**就是**"传 null = 清空"，那就别用它：把类型写成 `T | null`、
  Swagger 标 `nullable: true`，并在 service 里显式处理。两种语义混用才是真正的坑。

### 10.2 归一化必须在校验/入库**之前**

```http
POST /validation-demo/users  {"email": "NEO@EXAMPLE.COM"}   # seed 里已有 neo@example.com
# 修复前：201 —— "全局唯一"被大小写绕过
# 现在：  409 EMAIL_ALREADY_EXISTS（比较前已 trim + toLowerCase）

POST /validation-demo/users  {"name": "  Neo  "}
# 修复前：原样入库（@Length 量的是含空格的原始串）
# 现在：  "Neo"
```

放在 DTO 的 `@Transform` 上（class-transformer 先于 class-validator 执行），
**不要**做成全局管道行为：webhook 的 `@RawBody()` 载荷、将来做签名校验的原始 body 都不能被改写。

### 10.3 全局增强器必须能重复注册

```json
// 某个 SharedModule 顺手又 imports: [ApiContractModule.forRoot()] 时的实测结果
{"success":true,"data":{"success":true,"data":{"ok":true,"dto":{"a":1}}}}
```

`APP_INTERCEPTOR` 会被 Nest 串成一条链，每个实例都跑一遍 `map()`。只把"只 import 一次"
写进文档是约束不住下一层模块作者的，所以让增强器**幂等**（`ENVELOPED` 非枚举标记）；
请求 id 中间件同理（请求对象上已有 id 就跳过）。`APP_FILTER` 不受影响
（`ExceptionsHandler` 命中第一个匹配的过滤器就返回）。

顺带一条**别踩**的坑：`forRoutes('*')` 在 Nest 11（Express 5 / path-to-regexp v8）下
直接抛 `TypeError: Missing parameter name`，要用 `'/{*splat}'`。
