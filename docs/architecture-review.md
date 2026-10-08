# 架构评审：模块组合方式与「低耦合高内聚」审计

> 对象：本仓库 `src/`（91 个 `.ts`）与 `packages/api-contract`。
> 方法：**静态依赖图**（自写的 Tarjan SCC + 分层扇入扇出扫描）+ 通读源码/文档 + 交叉核对 README 的架构声明。
> 结论先行：**当前没有任何循环依赖（更好于多数同规模 Nest 仓库），分层大方向正确**
> （config / contract / auth 三者互不认识、由 `app.module.ts` 的工厂函数粘合）。
> 缺口不在"缺少解耦"，而在**两个未落地的缝**：`swagger` 层向上依赖了业务层，
> `contract` 层内部一个子目录把自己变成了"什么都装"的杂货铺。

---

## 0. 度量出来的事实

### 0.1 循环依赖：0

对 91 个源文件做强连通分量分解（`@/` 别名 + 相对路径 + `index.ts` 都解析）：

```
files: 91   cycles(SCC>1): 0
```

也就是说 README 里那条**最有价值的设计判断**（"模块内部互相引用走具体文件、桶只做门面、
绝不让桶参与循环"）确实被 100% 执行了。这是下面所有建议的前提：改动可以逐块进行，不需要先拆环。

### 0.2 分层依赖矩阵（只列跨层边）

| 上层 | 依赖的下层 | 评价 |
| --- | --- | --- |
| `src/app.module.ts` | auth, config, http-enhancers, observability, modules | ✅ 组合根，依赖所有层是它的职责 |
| `src/main.ts` | app.module, config, observability, **swagger** | ✅ 入口 |
| `src/observability/**` | **system/request-context**, config | ✅ 单向向下（原先反向依赖大桶，已修） |
| `src/auth/**` | **system/http-validation**, system/request-context | ✅ 单向向下 |
| `src/modules/validation-demo/**` | system/http-*, auth, **swagger/decorators** | ⚠️ 依赖 swagger 的声明式装饰器（见 §2.5，判定为正常依赖倒置） |
| `src/system/**` | 仅自身（`http-contract` / `request-context` 是零依赖叶子） | ✅ **零 Swagger 依赖**（`pagination` 除外，它按设计用 Swagger） |
| `src/http-enhancers.module.ts` | system/http-response, http-validation, request-context | ✅ 组合职责，所以住在 `src/` 根 |
| `src/swagger/**` | 仅 system/http-contract 的类型 | ✅ **已解耦**（见 §2.1） |
| `src/config/**` | swagger/is-swagger-enabled（纯函数） | 🟠 唯一的方向例外（见 §2.3） |

> ⚠️ **本节标题行与扇入数字是改造前的快照**。下面 §0.3 的 `src/contract/index.ts`
> 已经**不存在**了 —— 它被拆成 5 个精确子桶（`src/system/*/index.ts`），
> 扇入从"一个大桶 22 处"变成"四个精确桶"，这正是 §2.2 与 §7 想要的结果。

### 0.3 扇入 top（谁最被依赖）

```
22  src/contract/index.ts      ← 唯一的跨层门面，被 22 处引用
19  src/config/env.ts
11  src/config/index.ts
10  src/auth/index.ts
 9  src/auth/jwt-payload.ts
 7  src/observability/index.ts
 7  src/contract/response/response-contract.ts
```

`contract/index.ts` 是**全仓最大的耦合点**。这不必然是坏事（门面本来就该被广泛依赖），
但它意味着：**往 `contract/` 里塞任何东西，都会自动获得 22 个潜在消费者**。
下面 §2.2 的问题正是从这个门面漏出去的。

---

## 1. 当前的实际架构（以及它想变成什么）

```
main.ts / export-openapi.ts                ← 入口（两个，各自重复 4 行接线）
      │
app.module.ts                              ← 组合根（两个工厂函数把 config 映射成契约/认证选项）
      │
      ├── AppConfigModule        (config)      配置加载 + env 校验
      ├── ApiContractModule      (contract)   管道/过滤器/拦截器/请求 id
      ├── LoggingModule          (observability)
      ├── AuthModule             (auth)
      ├── ValidationDemoModule   (modules)     业务
      └── [Swagger 没做成模块]   (swagger)     入口里手工调用 setupSwagger()
```

`swagger` 是**唯一一个"不是模块"的层**，而它恰好是唯一一个依赖方向出错的层 —— 这不是巧合：
把它做成普通工具目录（而不是可组合的 Nest 模块），就没人来约束它"能认识谁"。

**这个仓库事实上已经在写 Contract-First + Feature-Module 了**，只是缺两块拼图：

| 社区成熟架构的构件 | 本仓库 | 状态 |
| --- | --- | --- |
| 共享线上契约包 | `packages/api-contract` | ✅ 已有且做得很好（零运行时导出 + paths 指向 `.d.ts`） |
| 契约运行时层（管道/过滤器/信封） | `src/contract/` | ✅ 已有，设计判断属第一梯队 |
| 配置层 + 启动期校验 | `src/config/` | ✅ 已有 |
| 可观测性（结构化日志 + traceId） | `src/observability/` | ✅ 已有 |
| 横切平台层（helmet/CORS/限流/前缀/版本） | 只在 `main.ts` 里 `app.use(helmet())` | ⬜ 缺（backlog §3.5 已规划 `PlatformModule`） |
| **文档层（零业务知识）** | `src/swagger/` 知道全部业务 DTO | 🔴 **反了** |
| 业务模块自描述（自带 tag / 响应模型） | `auth/`、`validation-demo/` 不自描述 | ⬜ 缺 |

缺口刚好就是后两行 —— 而且它们**是同一个问题的两面**。

---

## 2. 耦合问题清单（按严重度）

### 2.1 🔴 `swagger` 层反向依赖业务层 —— ✅ **已修复**

> **修复内容**（本节保留当时的分析原样，作为问题记录）：
>
> 1. 新增 `src/swagger/api-docs.options.ts`（`API_DOCS_OPTIONS` token、`ApiDocsOptions`、
>    `FeatureDocs`、`resolveApiDocsOptions`）与 `src/swagger/api-docs.module.ts`
>    （`ApiDocsModule.forRootAsync()` + `apiDocsOptionsFactory()`）；
> 2. `setup-swagger.ts` 删掉了全部业务 import 与 `RESPONSE_MODELS` / 硬编码 tag，
>    改为消费注入的 `options.tags` / `options.responseModels`；
> 3. 业务模块自描述：`src/auth/api-docs.ts`（`AUTH_DOCS`）与
>    `src/modules/validation-demo/api-docs.ts`（`VALIDATION_DEMO_DOCS`），
>    由 `app.module.ts` 的 `FEATURE_DOCS` 注入；
> 4. 新增两条 e2e 守卫（登记的模型必须在 `components.schemas`、每个 tag 必须有描述）
>    与一个选项映射单测 `api-docs.factory.spec.ts`。
>
> **验收**：`grep -rnE '@/(auth|modules)' src/swagger --include='*.ts' | grep -v __tests__` → 空；
> `pnpm openapi:export` 的产物与修复前**逐字节相同**（行为保持的重构）；
> 114 单测 + 119 e2e 全绿。

**证据**：`src/swagger/setup-swagger.ts:4-13`（修复前）

```ts
import { LoginResponseDto } from '@/auth/dto/login-response.dto';
import { ProfileDto } from '@/auth/dto/profile.dto';
import {
  IdsDto, ReceivedCheckedBodyDto, ReceivedPlainBodyDto,
  ReceivedRawBodyDto, StrictProbeResultDto,
} from '@/modules/validation-demo/dto/webhook-response.dto';
import { UserDto } from '@/modules/validation-demo/user.dto';
```

外加 `setup-swagger.ts:82-89` 把 `validation-demo` / `auth` 两个 tag 的**文案**也硬编码在这里。

**根因**：`@nestjs/swagger` 只为它**探测到的模型类**生成 `components.schemas`，
而出参模型只以 `$ref` **字符串**出现在路由 schema 里，框架不会逆向建组件。
于是 `RESPONSE_MODELS` 这张"响应模型注册表"必须**静态引用每个 DTO 类** ——
任何"集中登记表"的实现方式都必然把文档层绑到所有业务模块上。

**违反的原则**：
- 依赖倒置：底层基础设施（文档投影）不该认识上层策略（业务模型）。
- 开闭：**新增一个业务模块必须改 `src/swagger/`**，这正是 README:413 承诺"不必"的事
  （"加一个模块不必去改另一个模块的测试文件" —— 现在要改的是另一个模块**本身**）。
- 可拆卸：`validation-demo` 是**教学活文档**（README:393 明说），却成了 `swagger` 的编译期依赖 ——
  这个仓库想删掉教学模块时，会连带拽掉文档层。

**注意**：`auth` / `validation-demo` 的控制器**反向**依赖 `swagger` 的装饰器
（`@/swagger/api-envelope.decorator`），形成"业务 → 文档（声明） + 文档 → 业务（模型）"的**双向**关系。
虽然图上是无环的（走的是不同文件），但两个方向同时存在本身就是坏味道。

**为什么不能被现有的兜底测试发现**：`openapi.e2e-spec.ts` 的悬空 `$ref` 守卫能抓住
"忘了注册模型"，抓不住"注册表引用了错误的层"。

---

### 2.2 🟠 `contract` 层"零 Swagger 依赖"已经是文档谎言

**证据**：文档三处声明 vs 一处实际引用。

| 位置 | 声明 |
| --- | --- |
| `README.md:385` | `swagger/` OpenAPI 投影（**契约层保持零 Swagger 依赖**） |
| `README.md:409` | `src/contract/` 只管运行时行为；OpenAPI 投影一律放 `src/swagger/` |
| `src/contract/index.ts:17` | 契约层**不依赖任何 Swagger 包** |
| `src/contract/validation/error-contract.ts:39` | 契约层**不依赖任何 Swagger 包** |
| **`src/contract/pagination/pagination-query.dto.ts:1`** | **`import { ApiPropertyOptional } from '@nestjs/swagger';`** |

而且这不是"一个装饰器"的量级：`pagination-query.dto.ts` 里所有字段与 `createPaginationQueryDto()`
动态生成类的 `sortBy` 都挂了 `@ApiPropertyOptional`（第 28、40、80 行附近），
并在注释里**明确论证**了"必须显式写、不靠插件推断"。

**根因（比"忘了删"更深）**：`src/contract/pagination/` 从名字到内容都不是契约。
它是**一个跨切面的 HTTP 入参约定**：`page` / `limit` / `sortBy` 白名单 + 截断逻辑 + 分页响应拼装。
它落在 `contract/` 只是因为"信封和分页都是响应形状"这种**主题相似**，而不是**变化原因相同**
—— 这正是内聚的反面（cohesion by topic ≠ cohesion by reason-to-change）。

`contract/` 目录内部四个子目录的真实内聚度差异很大：

| 子目录 | 文件数 | 真实职责 | 内聚评价 |
| --- | --- | --- | --- |
| `response/` | 5 | 成功信封的**运行时**行为 | ✅ 高 |
| `validation/` | 12 | **失败侧**的建模 + 执行 | ✅ 中高（但见下） |
| `observability/` | 2 | 请求 id / 上下文 | ⚠️ 与 `observability/` 层同名，职责交叉 |
| **`pagination/`** | 2 | **跨切面入参约定**（且唯一引入 swagger） | 🔴 低（杂货） |

`validation/` 内部其实还横跨 4 种变化原因：错误建模（`error-contract` / `error-code` /
`error-location`）、校验执行（`contract-validation.pipe` / `validation-pipe.factory`）、
错误出口（`http-exception.filter`）、**断言与抛错工具**
（`is-optional-not-null.decorator` / `raw-body.decorator` / `is-not-reserved-name.validator` / `api-exception`）。
12 个文件 + 最被依赖的门面 = 将来最容易膨胀成"什么都往里放"的地方。

---

### 2.3 🟡 `config` 反向依赖 `swagger`（为了 14 行政策）

**证据**：`src/config/swagger.config.ts:2` → `@/swagger/is-swagger-enabled`。

`is-swagger-enabled.ts` 是一个**纯函数**（19-33 行），逻辑是"`ENABLE_SWAGGER` 显式优先，
否则看 `NODE_ENV`" —— 这是**配置政策**，不是文档投影。
它住在 `swagger/` 只是因为"第一个用它的地方在那里"。

后果：配置层（最底层、最被依赖）为了一个真值判断，被迫依赖一个会认识全部业务 DTO 的层。
虽然 TS 只解析到 `is-swagger-enabled.ts`（不会拖进 `setup-swagger.ts`），**运行时无代价**，
但它让"config 是最底层、不认识任何人"这条声明出现例外 —— 而架构约束一旦有例外就会持续劣化。

---

### 2.4 🟡 教学模块的类型漏进了生产层

`src/modules/validation-demo/` 的定位是"活文档：把每种校验行为都跑一遍"（README:393），
但它的产物被三段**生产路径**消费：

1. `src/swagger/setup-swagger.ts:6-13` —— 6 个 DTO 进 `RESPONSE_MODELS`（生产文档）；
2. `src/swagger/setup-swagger.ts:82-89` —— tag 文案；
3. `src/swagger/__tests__/openapi.e2e-spec.ts:201` —— 断言里写死 `/validation-demo/webhooks/raw-body`。

于是"删掉 demo，只留 auth"这个本应 10 分钟的操作，会连编译都过不去。

**附带的小不一致**：该模块把 DTO 分在两个地方 —— `dto/` 子目录（5 个）与
模块根（`user.dto.ts`、`exceptions.ts`）。`user.dto.ts` 是**出参**模型，
和 `dto/` 里那 5 个**入参** DTO 同处一室，读代码的人得先判断"这个是入参还是出参"。
（这个不一致本身无害，但和 §2.1 一起看：它说明出参模型在这个仓库里**没有明确的家**。）

---

### 2.5 🟡 业务模块被迫依赖文档装饰器

`auth/auth.controller.ts:?`、`validation-demo.controller.ts`、`validation-pipe-order.controller.ts`
都 `import ... from '@/swagger/api-envelope.decorator'`（共 5 处）。

严格说这是**依赖倒置的正常形态**（业务声明"我要什么文档形状"，由投影层实现），
所以**不建议改成"业务完全不提文档"** —— 那会退化成装饰器元数据扫描的重度魔法。
但当前形态有个可改进点：`@ApiOkEnvelope()` 混合了**两件事**：

- 业务意图：这是 200 + 这个模型；
- 文档实现：拼 `allOf` / `$ref` / `components.schemas`。

前者该由业务表达，后者该被 `swagger` 吸收。现在的写法把两者都放在 `swagger/` 的装饰器里，
业务侧写起来像"在写文档"，而不是"在描述接口"。属于**观感问题**，优先级低于 §2.1/§2.2。

---

### 2.6 ⬜ 两个入口重复接线（顺带的重复）

`main.ts:29-50` 与 `swagger/export-openapi.ts:31-44` 各自重复：
`validateEnv(process.env)` → `NestFactory.create(AppModule)` → 读配置。
`app-config.module.ts:59-61` 的注释已经承认这个代价（"每个入口都要记得调用一次"）。
等 `PlatformModule`（backlog §3.5）落地时，这块自然收敛成一个
`createApplication(): Promise<INestApplication>` 工厂，两个入口都调它。

---

## 3. 目标结构（推荐）

核心动作只有两个：**把 `swagger` 拆成"纯投影机制" + "由业务提供的文档清单"**，
以及**把 `pagination` 从 `contract` 里搬出去**。其余是顺路收敛。

```
main.ts / export-openapi.ts
      │  （都调用 createApplication()，接线只写一遍）
      ▼
app.module.ts  ← 组合根：唯一的粘合点
      │
      ├─ AppConfigModule          config         环境变量 → 六个 namespace（不认识任何人）
      ├─ PlatformModule           platform 🆕     helmet / CORS / 限流 / 前缀 / body limit
      │   └─ pagination/          🆕 从 contract 搬来（PaginationQueryDto / buildPaginatedResult）
      ├─ ApiContractModule        contract       信封 + 校验 + 错误出口（保持零 swagger、零 config）
      ├─ LoggingModule            observability  全局 logger + 访问日志
      ├─ ApiDocsModule            swagger 🆕     只接收 (extraModels, tags, info)，不认识业务
      ├─ AuthModule               auth           业务：导出 AUTH_DOCS
      └─ ValidationDemoModule     modules        业务：导出 VALIDATION_DEMO_DOCS
```

**关键设计**：`src/swagger/` 里**没有任何一行 `@/auth` / `@/modules`**。
"哪些模型要注册、有哪些 tag" 变成**数据**，由业务模块在自己的门面里导出，
组合根把它喂给 `ApiDocsModule`。这是标准的**依赖倒置**：

```ts
// src/auth/index.ts  ← 业务模块自描述（新增，~8 行）
import { LoginResponseDto } from './dto/login-response.dto';
import { ProfileDto } from './dto/profile.dto';

/** 本模块对 OpenAPI 的贡献：响应模型 + 标签文案。 */
export const AUTH_DOCS = {
  tag: { name: 'auth', description: '认证：`POST /auth/login` 换 JWT，`GET /auth/profile` 需 Bearer' },
  responseModels: [LoginResponseDto, ProfileDto],
} as const;
```

```ts
// src/swagger/api-docs.module.ts  ← 文档层（新增）：零业务 import
@Module({})
export class ApiDocsModule {
  static forRootAsync(options: ApiDocsAsyncOptions): DynamicModule { /* token: API_DOCS_OPTIONS */ }
}
```

```ts
// src/app.module.ts  ← 组合根：唯一知道"auth 的文档长什么样"的地方
import { AUTH_DOCS } from '@/auth';
import { VALIDATION_DEMO_DOCS } from '@/modules/validation-demo';

ApiDocsModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    serverUrl: config.getOrThrow<SwaggerConfig>('swagger').serverUrl,
    tags: [AUTH_DOCS.tag, VALIDATION_DEMO_DOCS.tag],
    responseModels: [...AUTH_DOCS.responseModels, ...VALIDATION_DEMO_DOCS.responseModels],
  }),
}),
```

**为什么选这个方案**（三个备选对比）：

| 方案 | 业务耦合 | 自动化 | 成本 | 评价 |
| --- | --- | --- | --- | --- |
| A. 现状（`swagger` 静态 import 全部业务 DTO） | 🔴 反向依赖 | 无 | 0 | 需要修 |
| **B. 业务导出 docs 描述符 + 组合根喂给 `ApiDocsModule`** | ✅ 单向（业务 → 文档描述符） | 新增模块需在组合根加一行 | 低（~60 行） | ✅ **推荐** |
| C. `DiscoveryService` 扫元数据自动收集 out-参模型 | ✅ 完全解耦 | 全自动 | 高（要读 `@ApiOkEnvelope` 的元数据 + 元组/数组形状） | 备选（见下） |

方案 B 与仓库现有风格**完全同构**：`app.module.ts:24-47` 已经在用
"业务模块不自报配置、由组合根注入"的工厂模式（`apiContractOptionsFactory` / `jwtOptionsFactory`）。
把 `AUTH_DOCS` 交给同一个组合根，是**同一套约定的延续**，不是引入新模式。

方案 C 的项目符号几乎相同（`@ApiOkEnvelope(UserDto, ...)` 已经携带了模型类），
理论上可以让 `ApiDocsModule` 用 `DiscoveryService` 扫描所有控制器上的元数据自动收集，
**业务模块一行都不用改**。但它需要把装饰器元数据契约化（`Reflect.getMetadata` 的键要成为公共 API）、
并处理元组 `[Type]` / `'null'` 这两种 `WrappedData` 形状 ——
建议**记入 `review-backlog.md` 的 P3**，等响应模型数量超过 ~20 个时再评估。
理由：方案 B 的成本是"新增模块时在组合根加一行"，而组合根本来就是干这个的地方。

**`ApiDocsModule` 落地后，`main.ts` 少一行、`export-openapi.ts` 少两行**：`setupSwagger()` 的调用
从入口移进模块（模块里用 `OnApplicationBootstrap` 钩子拿 `INestApplication`
—— Nest 支持在模块里注入 `HttpAdapterHost` / 通过 `NestFactory` 之外的方式拿 app，
但**这里有个真实的取舍**：`SwaggerModule.setup()` 需要 `INestApplication`，
模块里拿 app 需要额外绕路，而现状注释（`setup-swagger.ts:120-122`）已经论证过"没做成模块"的原因）。

> ⚠️ **修正建议**：把 `ApiDocsModule` 定位成**只做文档的选项容器**
> （`API_DOCS_OPTIONS` token + `buildDocument(app, options)` 的纯实现），
> `setupSwagger(app)` 的**调用点仍留在入口**。这样解耦目标 100% 达成
> （`src/swagger/` 不再 import 任何业务），而不用为"必须拿到 app 实例"引入新的绕路。
> 也就是说：**`ApiDocsModule` 存在的意义是承载 `extraModels` / `tags` 选项与配置映射，
> 不是承载 `SwaggerModule.setup()` 的调用**。

---

## 4. 分步重构清单（每步可独立合入、独立验证）

按「解耦收益 ÷ 风险」排序。每步都保持 0 循环依赖。

### ① `contract` 层：把 `pagination/` 搬出契约层（P0）—— ✅ **已实施**

> **实际落点与下面原方案的差异**：搬到了 `src/system/pagination/`（而不是 `src/platform/pagination/`），
> 因为同批改造引入了 `src/system/` 作为系统级模块的统一位置，分页是其中之一。
> 依赖方向是 `system/pagination → system/http-validation + system/http-response`。
> `PaginatedResult` / `PaginationMeta` 的类型**没有**留在包外 —— 包被整体删除，
> 它们与其它线上形状一起内联到了 `src/system/http-contract/`。
>
> **实际验收**：`grep -rn "@nestjs/swagger" src/system/http-contract src/system/http-response src/system/http-validation` → **0 行** ✅
> ⚠️ 原方案里的"openapi.e2e-spec.ts 全绿"这条验收**已不可用**（测试已删除）；
> 当时用 `pnpm openapi:export` 的产物 diff 代替（产物只变了预期的 `code` 删除）。

- 移动：`src/contract/pagination/{pagination-query.dto,paginated-result}.ts` → `src/system/pagination/`
- 修改 import：`is-optional-not-null.decorator` 从 `@/system/http-validation` 取
  （保留依赖方向 `pagination → http-validation`）
- 改消费方：`src/modules/validation-demo/dto/query-users.dto.ts`、`validation-demo.service.ts`
- **验收**：`grep -rn "nestjs/swagger" src/system/http-contract src/system/http-response src/system/http-validation` → **0 行**

> 这一步把"契约层零 Swagger 依赖"从**文档声明**变成**可被 grep 验证的不变量**。
> 已在 §6 加为守卫①，否则它会再次劣化（它就是被这样弄坏的）。

### ② `config` 层：把 `isSwaggerEnabled()` 搬回家（P0，14 行）—— ⬜ **未做（有意保留）**

> **决策：不搬。** 后端化改造后重新评估过：`src/swagger/is-swagger-enabled.ts` 是**纯函数、零 import**，
> 由 `src/config/swagger.config.ts` 单向引用 ⇒ **无环**。搬进 `config/` 的收益只是"消除一条方向例外"，
> 代价是同步改 `docs/configuration.md` 的表述与测试归属 —— 收益不抵成本。
> 这条例外已作为守卫③的已知白名单记录在 §6。
> **触发条件**：如果 `src/swagger/` 将来开始依赖 `src/config/`（那就真的成环了），就必须搬。

- 移动：`src/swagger/is-swagger-enabled.ts` → `src/config/is-swagger-enabled.ts`
- 依赖方向变成 `config → config`、`swagger → config`（若需要）；`config/swagger.config.ts:2` 改为 `./is-swagger-enabled`
- `src/swagger/index.ts`（若新增门面）re-export 它，保持现有 `@/swagger/is-swagger-enabled` 的消费方
  改动最小 —— 或者直接改这几处
- **验收**：`grep -rn "@/swagger" src/config` → 0 行；`log.config.spec.ts` / `config.e2e-spec.ts` 全绿；
  `is-swagger-enabled` 的 4 种组合断言（原本在 `openapi.e2e-spec.ts` 里）**保持在 `config/__tests__/`** ——
  被测对象的**归属**变了，测试文件也该跟着搬（README:413 的约定）。

### ③ `swagger` 层：引入 `API_DOCS_OPTIONS` + 业务自描述 —— ✅ **已实施**

> **实际落地**（与下面原方案的两处偏差）：
>
> 1. 业务自描述**没有**塞进 `src/auth/index.ts`（那会让模块门面为了文档反向依赖全部响应 DTO），
>    而是各自新建 `src/auth/api-docs.ts` / `src/modules/validation-demo/api-docs.ts`；
>    该模块本来没有 barrel，也不为文档新建一个。
> 2. `enabled` 也放进了 `ApiDocsOptions`（而不是只留在 `setupSwagger`）——
>    于是两个入口都只写 `setupSwagger(app, resolveApiDocsOptions(app))` 一行，
>    不必知道选项里有哪些字段。
>
> **实际验收**：`grep` 核心断言 0 行（排除 `__tests__`）；`openapi.json` **逐字节相同**；
> 114 单测（新增 7 条选项映射单测）+ 119 e2e（新增 2 条守卫）全绿。

原方案（保留作为记录）：

- 新增 `src/swagger/api-docs.module.ts`：`ApiDocsModule.forRootAsync()` → `API_DOCS_OPTIONS` token
  （形状照抄 `api-contract.module.ts:106-129`，仓库里已有可套用的模板）
- `src/swagger/setup-swagger.ts`：删掉 4-13 行全部业务 import、删掉 33-42 行 `RESPONSE_MODELS`
  与 82-89 行硬编码 tag，改为从 `API_DOCS_OPTIONS` 读 `{ responseModels, tags, serverUrl }`
- `src/auth/index.ts` 新增 `AUTH_DOCS`；`src/modules/validation-demo/` 新增 `VALIDATION_DEMO_DOCS`
  （或加一个 `validation-demo.docs.ts`，避免业务门面为了文档反向依赖全部响应 DTO）
- `src/app.module.ts`：新增 `ApiDocsModule.forRootAsync(...)`，把两个 `*_DOCS` 合起来
- `src/main.ts` / `export-openapi.ts`：`setupSwagger(app, options)` 的 options 改从
  `app.get(API_DOCS_OPTIONS)` 取（或继续由 `readResolvedConfig` 提供 `serverUrl` —— 两种都行，
  关键是**模型与 tag 从此不再由 swagger 层自己决定**）
- **验收**：
  - `grep -rn "@/auth\|@/modules" src/swagger` → **0 行**（本步的核心断言）
  - `openapi/openapi.json` 的 **diff 为空**（`pnpm openapi:export` 后 `git diff --stat openapi/`）
    —— 解耦**必须**是行为保持的重构，产物变了就说明搬错了
  - `openapi.e2e-spec.ts` 的悬空 `$ref` 守卫 + 路径清单全绿
  - **新增一条守卫**：往 `src/modules/` 加一个空模块并只在组合根注册，`pnpm build` 必须能过
    —— 这条直接钉住"新增业务模块不需要改 `src/swagger/`"

> 📌 **实施中发现的顺序陷阱**（值得记住）：`FEATURE_DOCS` 的数组顺序**同时**决定
> `components.schemas` 里显式登记模型的键顺序**和**顶层 `tags` 的顺序。
> 第一次实施时按 `[AUTH_DOCS, VALIDATION_DEMO_DOCS]` 排列，产物 diff 出 40 余行
> （语义相同、只是顺序不同）—— `openapi.json` 的逐字节断言正是靠这个抓出来的。
> 结论：**新模块一律追加到 `FEATURE_DOCS` 末尾**。

### ④ `validation-demo` 定位收口（P1，与 ③ 同批做）

- `user.dto.ts` 移进 `src/modules/validation-demo/dto/`（它现在是**出参**却和模块根的其他文件混放）
- 在模块门面注一句"本模块是**教学活文档**，其文档描述符由 `app.module.ts` 消费；
  删除本模块时需要同步删掉那里的 `VALIDATION_DEMO_DOCS` 一行" —— 让"可拆卸"变成**已知的一步操作**
- **验收**：`pnpm build` + `pnpm test:e2e` 全绿；`openapi.json` diff 为空

### ⑤ `PlatformModule`（P2，backlog §3.5 原计划）—— ✅ **CORS + 限流已实施**（其余待做）

> **实际落地**（`src/platform/`）：`PlatformModule.forRootAsync()` 提供 `PLATFORM_OPTIONS`
> 并挂 `ThrottlerGuard`；CORS 由入口 `app.enableCors(resolvePlatformOptions(app).cors)` 接线。
> 与原方案的两处偏差：
>
> 1. **CORS 没做成模块里的中间件** —— `cors` 不是本仓库的直接依赖（随
>    `@nestjs/platform-express` 传递安装），pnpm 严格 node_modules 下 `src/` 里 import 它会失败；
>    `app.enableCors()` 由 Nest 自己 require 它，零新增依赖（而且模块里的
>    `configure()` 中间件会排在 `RequestIdMiddleware` 之后，虽然仍早于路由，但没必要）。
> 2. **`helmet()` 仍留在 `main.ts:33`** —— 它本来就注册在路由之前（`NestFactory.create()`
>    不注册路由，`listen()` 才触发），没有必须搬的理由；搬进模块只会多一层间接。
>
> **实际验收**：`cors` / `throttle` 从 `RESERVED_NAMESPACES` 移除（启动摘要不再显示 `(预留)`）；
> 预检 204 + `Allow-Origin`；白名单模式带 `Allow-Credentials` + `Vary: Origin`；
> `THROTTLE_LIMIT=3` ⇒ `200 200 200 429 429`；429 进类级 `@ApiEnvelopeErrors()`（14 条路由全覆盖）；
> `NODE_ENV=production` + 通配来源 ⇒ 拒绝启动。
>
> **仍未做**：全局前缀 / URI 版本控制 / body limit（见 `docs/learning-next.md` §4.3）。

原方案（保留作为记录）：

`helmet` / CORS（`cors` namespace 已经有配置且标着"🅿️ 预留"）/ `throttler`
（`throttle` namespace 同样预留）/ 全局前缀 / body limit 集中一处，
并从 `describe-config.ts:32-36` 的 `RESERVED_NAMESPACES` 里删掉 `cors` / `throttle`。
**收益**：`config` 里那两个"预留"namespace 终于有消费者，启动摘要不再显示 `(预留)`。
**验收**：`grep -i x-powered-by` 为空；CORS 预检请求返回白名单头；429 进失败信封（`@ApiEnvelopeErrors` 补 429）。

### ⑥ 入口收敛：`createApplication()`（P3）

`src/bootstrap/create-application.ts`：`validateEnv` + `NestFactory.create` + `readResolvedConfig`
三个入口共用。`main.ts` 只剩 `helmet`/`listen`（或全部进 `PlatformModule` 后只剩 `listen`）。
**验收**：两个入口文件各自 < 40 行；`validateEnv` 只被调用 1 处。

---

## 5. 不要动的地方（重构时最容易误伤的优点）

1. **`contract` 内部走具体文件、桶只做门面** —— 0 循环依赖就是这么来的。§4 的每一步都必须维持这条。
2. **`success` 单判据 + 状态码只走 HTTP 状态行**；**分页用非枚举 symbol 标记**；**`@RawBody()` 参数级豁免**。
3. **`packages/api-contract` 零运行时导出 + paths 指向 `.d.ts`** —— §4① 只搬 `PaginationQueryDto`（服务端入参），
   `PaginatedResult` / `PaginationMeta`（线上形状）**留在包里**。别把两者一起搬。
4. **`app.module.ts` 的两个工厂函数**（配置 → 选项的映射放在组合根）—— §4③ 是**同一模式**的扩展，
   不是替换。
5. **"绝不对 DTO / 模块写 `import type`"** —— §4③ 新增的 `*_DOCS` 里装的是**类引用**，
   天然是值导入，不会踩这个坑；但迁移时别顺手写成 `import type`。
6. **`AppExceptionFilter` 的规范化逻辑**（数组型 message / `headersSent` 收口）—— §4 完全不碰它。

---

## 6. 把"声明"变成"可验证的不变量"（防止再次劣化）

本仓库最大的资产是**大量写进注释的架构声明**；最大的风险是**这些声明没有人自动检查**
（§2.2 就是这么坏的：文档说零依赖，代码里有一行 import 挂了很久没人发现）。

建议加一组极便宜的 CI 守卫（都是 `grep`，总耗时 < 1s）。

⚠️ **必须排除注释行**：本仓库的注释里大量引用这些规则本身
（例如 `src/auth/auth-options.ts:12` 就写着"`src/auth/` 里没有一行 `@/config`"），
裸 `grep` 会被自己的文档误伤 —— 上表是**实测过的加固版**（`grep -vE '^\S+:[0-9]+: *(\*|//|/\*)'`）：

```bash
# 排除注释行的通用过滤器
NOCOMMENT='^\S+:[0-9]+: *(\*|//|/\*)'

# ① 契约层零 Swagger 依赖 —— ✅ 已修复，现在 0 行（§2.2）
#    注意范围是 http-contract / http-response / http-validation 三个模块；
#    `system/pagination` **按设计**使用 @nestjs/swagger，不在守卫范围内
! grep -rnE "@nestjs/swagger" src/system/http-contract src/system/http-response \
    src/system/http-validation --include='*.ts' | grep -vE "$NOCOMMENT"

# ② 文档层零业务依赖（§4③ —— ✅ 已修复，现在 0 行）
! grep -rnE "@/auth|@/modules" src/swagger --include='*.ts' | grep -vE "$NOCOMMENT"

# ③ 配置层零上层依赖（config 不认识任何人）——当前 1 行（§2.3，纯函数，无环）
! grep -rnE "@/swagger|@/contract|@/auth|@/observability|@/modules|@/system|@/http-enhancers" \
    src/config --include='*.ts' | grep -vE "$NOCOMMENT"

# ④ 认证层不认识配置（README 的声明）——当前 0 行 ✅ 已成立
! grep -rn "@/config" src/auth --include='*.ts' | grep -vE "$NOCOMMENT"

# ⑤ 线上形状保持纯类型（原"共享契约包"，现已内联）——当前 0 行 ✅
#    零依赖叶子：不允许任何 import（除了同一模块内部的类型）
! grep -rnE "^import .* from '(@/|\.\.)" src/system/http-contract/index.ts

# ⑥ 门面桶不用 export *——当前 0 行 ✅ 已成立
! grep -rn "export \*" src/system/*/index.ts | grep -vE "$NOCOMMENT"

# ⑦ system 层是纯下层（§4 的目标）——当前 0 行 ✅
! grep -rnE "@/config|@/auth|@/modules|@/swagger|@/observability" src/system \
    --include='*.ts' | grep -vE "$NOCOMMENT"

# ⑧ 源码目录里没有编译产物 —— 当前 0 行 ✅（真实事故，见下）
#    `.js` 会被 Node/jest **优先于同名 `.ts`** 命中 ⇒ `pnpm start:dev` 静默跑旧产物
! find src scripts -name '*.js' -o -name '*.js.map' -o -name '*.d.ts' | grep .

# ⑨ 平台层不认识业务与其它系统层（§4⑤ 的声明）——当前 0 行 ✅
#    它只允许依赖 @/config（类型）与 @nestjs/*；`system/` 也不许反过来认识它
! grep -rnE "@/auth|@/modules|@/swagger|@/observability|@/system|@/http-enhancers" \
    src/platform --include='*.ts' | grep -vE "$NOCOMMENT"
```

**⑧ 是一次真实事故，值得单独记一段。**

后端化改造期间，`src/` 下出现过 **78 个 `.js` + 78 个 `.js.map`**，
目录结构与 `src/` 完全镜像。触发条件是临时的 `scripts/tsconfig.json`（当时还没有 `noEmit`）：
那个 project 的输入横跨 `scripts/` 与 `src/`，一旦 emit，**输出落点取决于 tsc 推断的 `rootDir`**
—— 推断错了就会把 `src/` 当输出目录。

它的危害不在"脏"，而在**静默改变运行时行为**：Node 解析 `./foo` 时优先命中 `foo.js`，
于是 `pnpm start:dev` / jest 会跑编译产物、源码改了却不生效，且没有任何报错。
（对 `pnpm start:prod` 无影响 —— 那条路走 `dist/`。）

两道防线（缺一不可）：

1. **根因侧**：`scripts/tsconfig.json` 里 `noEmit: true` —— 让它**根本不能 emit**；
2. **检出侧**：`.gitignore` 忽略 `{src,scripts}/**/*.{js,js.map,d.ts,d.ts.map}` ——
   避免这类产物在 `git status` 里刷屏、掩盖真正的改动。

> ⚠️ 我**没能精确复现**当初的落点（当前配置下 `nest build` / 两个 `tsc` 都不再往 `src/` 写）。
> 所以上面是"根据配置与现象做的归因"，不是逐步复现的结论。防线按"宁可挡住"设，
> 并且防线① 让那个路径不再可达。

**当前实测结果**（**后端化改造后重新逐条跑过**；括号里是第一次审计时的原始观察）：

| 守卫 | 现状 | 结论 |
| --- | --- | --- |
| ① 契约层 → swagger | **0 行**（原 1 行） | ✅ §2.2 已修复：`pagination` 搬出契约层 |
| ② swagger → 业务 | **0 行**（原 4 行） | ✅ §2.1 已修复 |
| ③ config → 上层 | **1 行**（`swagger.config.ts:2`，指向一个不 import 任何东西的纯函数） | 🟠 §2.3（未修，方向无环） |
| ④ auth → config | 0 行 | ✅ 声明成立 |
| ⑤ 线上形状纯类型 | 0 行 | ✅ 声明成立（原"契约包纯类型"） |
| ⑥ 无 `export *` | 0 行 | ✅ 声明成立 |
| ⑦ system 纯下层 | 0 行 | ✅ 新增守卫，声明成立 |
| ⑨ platform 不认识业务 | 0 行 | ✅ 新增守卫（§4⑤ 落地时补） |

也就是说：**原有 6 条声明里 3 条被违反** —— ② 与 ① 已修掉，只剩 ③（那是**无环的有意例外**）。
这恰好说明"多数声明靠自律能维持，但少数（新目录、新层）必然会漂移"。
加固后的守卫能让剩下的违规变成 CI 红灯，而不是等下一次人工审计。
比新增一个 ESLint 插件（`eslint-plugin-boundaries` / `import/no-restricted-paths`）更贴合现状：
仓库已经在用注释表达这些规则，用一个几行的 shell 脚本就能把它们变成**会红的规则**。
（若将来层数继续增加，再迁移到 `import/no-restricted-paths`。）

> ⚠️ **测试删除后，② 那条守卫的说明过期了**：它原先要 `grep -v __tests__`，因为测试必须
> import 业务自描述才能断言"登记的模型确实进了 `components.schemas`"。
> 现在测试已全部删除（见 `README` §"测试"），所以不再需要那个排除 —— 但也意味着
> **这条断言目前没有人执行**，只能靠人跑上面的 grep。

---

## 7. 一句话总结

> **✅ 实施完成（后端化改造）**：下面两个"要修的东西"都已修掉，
> 且目录从 `src/contract/` 重组为 `src/system/*`。本节的职责表已更新为**现状**。
> 另外两处与本节原本无关、但同批完成的变更：删除了错误码 `code`（见 `README` §"响应契约"）
> 与 `packages/api-contract`（见 §4②）。

**结构不需要推倒重来。** 0 循环依赖、组合根集中粘合、线上形状单一定义 —— 这三件事已经做对了，
比"加一个 PlatformModule"重要得多。当时真正要修的是两个具体的方向错误：

- **`swagger` 层不该认识业务**（§2.1）—— ✅ 已用"业务导出 docs 描述符 + 组合根注入"修，
  和仓库已有的 `apiContractOptionsFactory` 是同一套约定；
- **`contract/pagination` 不该叫契约**（§2.2）—— ✅ 已搬到 `src/system/pagination/`，
  "零 Swagger 依赖"这条从文档声明变成了 §6 的可执行守卫。

改完之后，每个模块的边界都能用一句话说清，并且这句话**能被脚本验证**（守卫见 §6）：

| 模块 | 一句话职责 | 不允许做的事 |
| --- | --- | --- |
| `system/http-contract` | 线上形状（纯类型 + `ERROR_LOCATIONS`） | **零 import**（叶子） |
| `system/request-context` | 请求 id / 用户上下文（AsyncLocalStorage） | 不认识 http-*、不认识日志 |
| `system/http-response` | 成功信封的运行时（拦截器 + 幂等标记） | 不认识 config / 业务 |
| `system/http-validation` | 失败信封 + 入参校验的运行时 | 不引 swagger、不认识 config / 业务 |
| `system/pagination` | 跨业务复用的分页入参 + 结果构造 | 不认识 config / 业务 |
| `config` | 环境变量 → 类型化 namespace | 不认识任何其它层（唯一例外：`swagger/is-swagger-enabled` 这个纯函数） |
| `observability` | 日志（全局 logger + 访问日志 + 滚动文件） | 不认识业务 |
| `swagger` | 运行时契约 → OpenAPI 投影 | **不认识业务**（模型与 tag 由组合根注入） |
| `platform` | 平台层：限流守卫 + CORS/限流选项投影 | 不认识业务；只有 `platform.options.ts` 的**类型**引用 `@/config` |
| `scripts` | 构建期脚本 | 不参与 HTTP 运行时 |
| `auth` / `modules/*` | 业务能力 + 自描述 docs 描述符 | 不 import 别人的内部文件 |
| `http-enhancers.module.ts` | 组合三个全局增强器 | 不写业务逻辑 |
| `app.module.ts` | **唯一**知道"谁和谁拼在一起"的地方 | 不写业务逻辑 |
