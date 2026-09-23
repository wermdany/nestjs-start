# 后续学习与实施清单（Learning Next）

> **这份文件解决一个问题**：仓库已经跑得比学习计划快很多，`docs/nestjs-learning-plan.md` 的复选框
> 却还停在起点。照旧按周表往下做会**重复劳动**（很多章节已有生产级实现），而真正缺的东西
> 又不在那份计划的显眼位置。本文按「**投入产出比**」重排了一遍：先回收已实现的知识，
> 再列真正没学的，最后给可独立合并的四个迭代。
>
> **定位**：不是替代 [nestjs-learning-plan.md](nestjs-learning-plan.md)，而是它的**补丁**——
> 那三份文档负责「是什么、为什么」，本文负责「**现在做什么、怎么验收**」。
>
> **实测基线**：2026-09-23，`pnpm test:e2e` → **4 suites / 107 tests 全绿**；`pnpm test` → **5 suites / 58 单测全绿**；
> `tsc --strict` → **32 处**（新写的 `src/auth/**` 与 `jwt` 配置贡献 **0**）。
>
> **进展**：§3.1 先实现了"静态 token + RBAC"，随后**被 JWT 登录模块整体替换**
> （现在只有认证、没有授权层）—— 见 [`docs/authentication.md`](authentication.md)。
> 单测基建（`jest.json` + `pnpm test` / `test:cov`）保留，属于 §3.2 的一部分。
> 下面保留**当时的实测记录**，作为"缺口是怎么被发现的"的对照。

---

## 0. 怎么用这份清单

| 层 | 含义 | 做法 |
| --- | --- | --- |
| **回收层**（§2） | 代码已有，计划里还空着 | **读实现 + 答自测题**，不要重做练习 |
| **T1 立刻做**（§3） | 缺一片关键能力，且有现成样板可抄 | 动手写，每项独立可合并 |
| **T2 接线即生效**（§4） | 配置契约已立好，只差消费者 | 成本最低，改 `main.ts` + 新模块 |
| **T3 下一层**（§5） | 需要新包或新抽象 | 按需，做前先看触发条件 |
| **跳过**（§6） | 本阶段不学 | 只记「什么时候该学」 |

进度用标准 GFM 复选框，和另外两份文档一致：

```bash
grep -c '^- \[x\]' docs/learning-next.md   # 已完成
grep -c '^- \[ \]' docs/learning-next.md   # 未完成
```

---

## 1. 现状体检（实测，不是估计）

### 1.1 已经有的（别再重学，去读代码）

| 能力 | 落点 | 对应计划章节 |
| --- | --- | --- |
| 统一响应信封（幂等、分页 symbol 标记） | [src/contract/response/](../src/contract/response/) | §2.8 |
| 统一错误信封（`code` / `location` / `traceId`） | [http-exception.filter.ts](../src/contract/validation/http-exception.filter.ts) | §2.5、§5.5 |
| 校验管道 + DTO + 约束名→语义 code 映射 | [contract-validation.pipe.ts](../src/contract/validation/contract-validation.pipe.ts)、[error-code.ts](../src/contract/validation/error-code.ts) | §2.6、§5.2 |
| 请求 id 中间件（AsyncLocalStorage → `traceId` + `x-request-id`） | [request-id.middleware.ts](../src/contract/observability/request-id.middleware.ts) | §2.4 |
| 动态模块 + options token + `forRootAsync` | [api-contract.module.ts](../src/contract/api-contract.module.ts) | §3.1–§3.3 |
| 配置层：5 namespace + 启动即校验 + 预留契约 | [src/config/](../src/config/)、[configuration.md](configuration.md) | §5.1 |
| Swagger 单一构建函数 + 悬空 `$ref` 守卫 + CLI 插件 | [src/swagger/](../src/swagger/) | §5.6 |
| 共享契约包（纯类型、零运行时导出） | [packages/api-contract/](../packages/api-contract/) | 计划外，超出原计划 |
| e2e：契约形状 + OpenAPI 文档 + 配置校验 | [jest-e2e.json](../jest-e2e.json)、三个 `.e2e-spec.ts` | §4 的 e2e 一半 |

### 1.2 确实还没有的（实测命令）

| 缺口 | 实测证据 |
| --- | --- |
| ~~**Guard / 鉴权**~~ | ✅ 已实现（`src/auth/`）—— 当时 `grep -rn "CanActivate\|APP_GUARD" src/` 是**零命中** |
| ~~**单元测试**~~ | ⚠️ 部分完成：`jest.json` + `pnpm test` / `test:cov` 已有（`src/auth/__tests__/`、`auth.config.spec.ts`）；覆盖率阈值与更广的覆盖仍缺 |
| **`strict`** | `npx tsc -p tsconfig.json --noEmit --strict` → **32 个错误**（明细见 §3.3） |
| **CI** | 无 `.github/` |
| **序列化层** | `grep -rn "ClassSerializerInterceptor\|@Exclude" src/` → **零命中** |
| **持久层** | service 直接持有 `Map`；[database.config.ts](../src/config/database.config.ts) 只是预留契约 |
| **平台层接线** | `helmet()` 已挂（[main.ts:28](../src/main.ts#L28)）；CORS / 限流 / shutdown hooks / 全局前缀 / 版本控制**都没接** |
| **格式化检查** | 只有 `pnpm format`（会改文件），没有 `--check` |

---

## 2. 回收层：这些章节已经"做过了"，改成读代码 + 自测

计划里的练习是写给**裸 starter** 的。本仓库已经把 §2.5 / §2.6 / §2.8 / §3.1–3.3 / §5.1 / §5.2 /
§5.5 / §5.6 做成了生产级实现——再做一遍练习是**降级**。正确的用法是：**读实现，然后回答自测题**。

### 2.1 读代码地图（按依赖顺序读，约 2 小时）

```text
packages/api-contract/src/index.ts        ← 先看"契约长什么样"（纯类型）
  ↓
src/contract/response/response-contract.ts ← 信封的类型与不变量
src/contract/response/response-envelope.interceptor.ts ← map() + 幂等 + 提前放行
  ↓
src/contract/validation/error-code.ts      ← 编译期穷尽性断言（§2.2 的重点）
src/contract/validation/http-exception.filter.ts ← 所有异常的唯一出口
  ↓
src/contract/api-contract.module.ts        ← 谁注册了什么、顺序如何（§2.10 的答案）
  ↓
src/app.module.ts                          ← 配置 → 契约 → 业务 的组装顺序
src/main.ts                                ← 入口只做五件事
```

### 2.2 练习任务

- [ ] 画出 [api-contract.module.ts:60-72](../src/contract/api-contract.module.ts#L60-L72) 的注册表，
      标出**每一项属于请求链路的哪一层**，与 [nestjs-learning-plan.md](nestjs-learning-plan.md) §2.10 的图逐行对齐。
- [ ] 解释 [error-code.ts:40-46](../src/contract/validation/error-code.ts#L40-L46) 那段
      `UncoveredErrorCode extends never ? true : never` 断言：**故意**往
      `packages/api-contract/src/index.ts` 的 `ErrorCode` 联合里加一个成员、不加值对象，
      跑 `pnpm build` 看它怎么失败，然后撤销。
- [ ] 解释 [response-envelope.interceptor.ts](../src/contract/response/response-envelope.interceptor.ts)
      为什么"包过就不再包"是**必须**的（提示：backlog §1.1 的双重信封实测）。
- [ ] 解释为什么 `@RawBody()` 是**参数级**豁免而不是 DTO 类型级标记
      （[raw-body.decorator.ts](../src/contract/validation/raw-body.decorator.ts)）。
- [ ] 回答 [nestjs-learning-plan.md:1076-1097](nestjs-learning-plan.md#L1076-L1097) 的 20 道自测题，
      答不上的记下来，只补那些。

**✅ 过关标准**：能不看代码说清「一个请求从进来到出去，依次经过哪些自有文件、每个文件负责什么」，
并指出失败路径在哪一步接管。

---

## 3. T1 · 立刻做

> ✅ §3.1 已完成（现为 **JWT 登录模块**）；剩下 §3.2（测试基座收尾）与 §3.3（`strict` + CI）。

### 3.1 ✅ 认证 —— 已实现（JWT 登录，替换掉了最初的静态 token + RBAC 版本）

📖 [docs.nestjs.com/security/authentication](https://docs.nestjs.com/security/authentication) ·
对应计划 §2.7 / §5.8 · **完整实现说明见 [`docs/authentication.md`](authentication.md)**

最终落地的是一个**只做认证**的模块（`src/auth/`）：

| 关注点 | 实现 | 关键决定 |
| --- | --- | --- |
| 登录 | `POST /auth/login`（`@Public()`） | 内存用户表（两个演示账号，**没有角色**）→ 校验密码 → `JwtService` 签发；失败 401，且"用户不存在"与"密码错"同形（防枚举） |
| 校验 | `JwtAuthGuard`（`APP_GUARD`，全局 fail-closed） | 除 `@Public()` 外都要 `Authorization: Bearer`；缺凭证 `invalid_request`、无效 / 过期 `invalid_token`（RFC 6750 的 `WWW-Authenticate`） |
| 身份 | `GET /auth/profile` + `@CurrentUser()` | 回显 token 里的 `sub` / `username` —— **token 里没有 roles / scope** |
| 配置 | `JWT_SECRET` / `JWT_EXPIRES_IN` | 开发有默认密钥（告警），**生产未配置或仍用默认值 → 拒绝启动**；摘要只显示 `secret:(默认｜已配置)` |

**演进过程**（保留为对照，说明"先做出来再看清楚"这件事的价值）：

1. 最初实现的是「静态 token + `@Roles()` RBAC + 资源级策略」，还带了 `AUTH_TOKENS` 配置
   与 `auth-demo` 演示模块（那时 `grep -rn "CanActivate\|APP_GUARD" src/` 是**零命中**，
   所以它是仓库里唯一"有零件（`UserRole` 枚举）却没装配"的地方）；
2. 随后按"用 JWT、内存写死用户、不设权限信息"的要求**整体替换**：删掉旧实现与
   `PERMISSION_DENIED` / `RESOURCE_NOT_FOUND` 两个 `code`，新增 JWT 登录模块。
   旧实现可从 git 历史（提交 `33d8dc4`）取回。

**还剩的部分**：限流 / 防撞库（`ThrottlerGuard`）与平台模块一起做 —— 见 §4，
那时会一起补 `TOO_MANY_REQUESTS` 这个 `ErrorCode`；角色 / 权限属于"授权层"，
触发条件写在 `docs/authentication.md` §10。

```bash
# 现在的验收
pnpm test && pnpm test:e2e
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json'   -d '{"username":"neo","password":"matrix"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")
curl -s -H "authorization: Bearer $TOKEN" localhost:3000/auth/profile   # 200 {sub,username}
curl -i localhost:3000/auth/profile                                     # 401 + WWW-Authenticate + traceId
```

---

### 3.2 测试基座 —— ⚠️ 已开工，还差收尾

📖 [Unit testing](https://docs.nestjs.com/fundamentals/unit-testing) · 对应计划 §4 · backlog §3.2

**为什么**：原来所有东西都靠 e2e 端到端验证，跑一次要起应用；一个纯函数（`codeOfConstraint`）
出错也得靠发 HTTP 才能发现，而且 `pnpm test` **直接失败**。

**已经做完的**（随 §3.1 一起落地）：

- [x] `jest.json`：`rootDir: "src"`、`testRegex: "\\.spec\\.ts$"`、`moduleNameMapper` 与
      [jest-e2e.json](../jest-e2e.json) 同一套别名。`\.spec\.ts$` 不会误伤 `*.e2e-spec.ts`
      （`spec` 前面是 `-` 不是 `.`），两条测试道天然隔离。
- [x] `package.json` 加了 `"test"` / `"test:cov"`。
- [x] 用**假 `ExecutionContext`**（`src/auth/__tests__/fixtures/`）+ **真的 `JwtService`**
      写了一批守卫单测；e2e 用应用自己的默认开发密钥端到端跑登录 → token → 受保护路由。

**还差的**：

- [ ] 给覆盖率加**阈值**（防止悄悄下降）。
- [ ] 补齐 backlog §3.2 点名的三个"最该被钉住"的单测：
      - [ ] `codeOfConstraint` 的映射（含未登记约束 → `UNKNOWN_CONSTRAINT`）；
      - [ ] `AppExceptionFilter` 对**数组型 `message`** 的规范化（backlog §1.3 的回归）；
      - [ ] `isSwaggerEnabled`（现在是靠 e2e 顺带测的，本质是纯函数）。
- [ ] 清掉文档里的失效引用（backlog §3.2 列了 5 处，例如 `plain-webhook.dto.ts` 指向不存在的
      `src/pipes/__tests__/validation-pipe.factory.spec.ts`）。
- [ ] 清掉文档里的失效引用（backlog §3.2 列了 5 处，例如 `plain-webhook.dto.ts` 指向不存在的
      `src/pipes/__tests__/validation-pipe.factory.spec.ts`）。

**顺手补的覆盖缺口**（实测发现）：`POST /validation-demo/webhooks/body` 与 `webhooks/plain`
**只有 Swagger 文档测试、没有行为级 e2e**——你现在改了 `webhooks/body` 的返回体，
92 条测试照样全绿，这正是"覆盖盲区"的实例。给它们补 2 条形状断言。

**验收**

```bash
pnpm test          # 单测通过（不再是 "Missing script"）
pnpm test:cov      # 覆盖率报告 + 阈值生效
pnpm test:e2e      # 仍然全绿
```

---

### 3.3 `strict` + CI + 格式化检查 —— 工程基座

📖 [tsconfig `strict`](https://www.typescriptlang.org/tsconfig#strict) · backlog §3.1 / §3.3

**实测份额**（`npx tsc -p tsconfig.json --noEmit --strict`，共 **33** 处；
本次新增的 `src/auth/**` 是 **strict-clean** 的，所以份额只从 32 涨到 33）：

| 文件 | 条数 | 主要错误码 | 修法 |
| --- | --- | --- | --- |
| `src/swagger/__tests__/openapi.e2e-spec.ts` | 11 | TS18048 / TS2532 / TS2769 / TS7053 | 局部 `??=`、收窄后断言、修 `expect` 的重载、给索引访问补类型 |
| `dto/webhook-response.dto.ts` | 6 | TS2564 | 明确赋值断言 `!` |
| `user.dto.ts` | 5 | TS2564 | 同上 |
| `dto/webhook.dto.ts` / `dto/create-user.dto.ts` | 3 / 3 | TS2564 | 同上 |
| `swagger/setup-swagger.ts` | 2 | TS18048 | `document.components ??= { schemas: {} }` |
| `dto/address.dto.ts` | 2 | TS2564 | `!` |
| `dto/user-id-param.dto.ts` | 1 | TS2564 | `!` |

> ⚠️ **不要**用 `strictPropertyInitialization: false` 一关了事——DTO 的 `TS2564` 是框架惯例，
> 官方示例就用 `name!: string;`。关掉它是把这层保护整体拆掉。

**练习任务**

- [ ] 按上表修完 33 处，`tsconfig.json` 打开 `"strict": true`，`pnpm build` + `pnpm test` + `pnpm test:e2e` 全绿。
      （`src/auth/**` 已经按 `strict` 写，不用返工。）
- [ ] 加 `"format:check": "prettier --check \"src/**/*.ts\" \"packages/**/*.ts\""`。
- [ ] `package.json` 加 `"packageManager": "pnpm@<当前版本>"` 固定包管理器。
- [ ] 新建 `.github/workflows/ci.yml`：`pnpm install --frozen-lockfile` → `lint` → `format:check`
      → `build` → `test` → `test:e2e`。
- [ ] 开一个 PR 验证 CI 真的会红（故意让 lint 失败一次），再修回来。

**验收**：`pnpm build` 无错误 + CI 全绿 + 故意引入的类型错误能让 CI 失败。

---

## 4. T2 · 接线即生效：`PlatformModule`（成本最低的一项）

📖 [CORS](https://docs.nestjs.com/security/cors) ·
[Helmet](https://docs.nestjs.com/security/helmet) ·
[Rate limiting](https://docs.nestjs.com/security/rate-limiting) ·
[Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events) ·
[Versioning](https://docs.nestjs.com/techniques/versioning) · backlog §3.5

**为什么成本最低**：`cors` / `throttle` 的**配置契约、默认值、启动期校验已经写好了**
（[platform.config.ts](../src/config/platform.config.ts)），只是"没有消费者"。
你只要读配置并接线，配置立刻从"预留"变"生效"。

**练习任务**

- [ ] 新建 `src/platform/platform.module.ts`，职责只放**平台层**（不塞进 `ApiContractModule`）：
      CORS、限流、shutdown hooks、全局前缀、版本控制。
- [ ] `app.enableCors({ origin: resolved.cors.origins, credentials: true })`，
      用 `curl -H 'Origin: http://example.com' -i` 观察 `Access-Control-Allow-Origin`。
- [ ] 装 `@nestjs/throttler` 并接线：`ThrottlerModule.forRootAsync({ inject: [ConfigService], ... })`
      + `{ provide: APP_GUARD, useClass: ThrottlerGuard }`；
      把 `THROTTLE_LIMIT=3` 写进 `.env`，`for i in {1..5}` 打，第 4 次应 **429**。
      - ⚠️ 装包前先确认 CJS 兼容性——`@nestjs/config` 就栽在 12.x 是 ESM-only（见 README 的踩坑记录）。
      - ⚠️ 429 也要进 `@ApiEnvelopeErrors()`，并且要给 `ErrorCode` 加 `TOO_MANY_REQUESTS`
        （契约的两个文件都要加：共享联合类型 + 服务端值对象，编译期断言会提醒你）。
      - ⚠️ `ThrottlerGuard` 也是 `APP_GUARD`：注册在 `AuthModule` **之后**，
        这样「没认证」优先于「请求太频繁」。
- [ ] `app.enableShutdownHooks()`，在一个 provider 上实现 `OnApplicationShutdown`，
      `Ctrl+C` 验证钩子被触发（不加这一行就不会触发——亲手验证一次）。
- [ ] **接线完成后**：删掉 [describe-config.ts:27-31](../src/config/describe-config.ts#L27-L31)
      `RESERVED_NAMESPACES` 里对应的项——那行启动日志是用来告诉你"哪些配置在空转"的，
      接完线不删它就变成假信息。
- [ ] 全局前缀 + URI 版本（`setGlobalPrefix('api')` + `enableVersioning`）：
      **先想清楚代价**——前端路径全变、`openapi/openapi.json` 必须重生成、已有 e2e 路径全改。
      建议单独一个提交，做完立刻跑 `pnpm openapi:export`。

**验收**

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/v1/validation-demo/users; done
# → 200 200 200 429 429
curl -s -D - -o /dev/null localhost:3000/ | grep -i 'strict-transport\|x-powered\|access-control'
```

---

## 5. T3 · 下一层能力（按需，先看触发条件）

### 5.1 序列化层（安全项，触发条件：出现第一个**敏感字段**）

📖 [Serialization](https://docs.nestjs.com/techniques/serialization) · 计划 §5.3

- [ ] 给一个 DTO 加 `password` 字段 + `@Exclude()`，挂 `ClassSerializerInterceptor`，
      验证它不出现在响应里。
- [ ] 想清楚它和**入参校验**的方向差异（一个管出、一个管入），以及它与
      `ResponseEnvelopeInterceptor` 的**执行顺序**（两个拦截器谁先包谁）。
- [ ] 说明为什么"序列化层缺失"在 backlog 里被标成「一旦出现 `password` 就会漏」。

**触发条件**：只要有任何一个字段不该给客户端，就立刻做，别等。

### 5.2 Repository 端口（上 DB 前最低成本的前置）

- [ ] 抽 `UsersRepository` **接口 + DI token**（`Symbol`），写出内存适配器，
      service 改成注入 token 而不是自己 `new Map`。
- [ ] 用 `overrideProvider(USERS_REPOSITORY).useValue(...)` 给每个 e2e `describe`
      注入干净实例——一次性解决 backlog §4 的「e2e 状态隔离」问题
      （现在用例共享同一个内存 `Map`，靠 `>=` 这类断言绕开顺序依赖）。
- [ ] 这三步做完，换 TypeORM / Prisma 时 **service 一行不用改**——这就是它的全部价值。

**触发条件**：打算上数据库之前，**必须**先做这一步。

### 5.3 缓存与 SSE（RxJS 的回报）

📖 [Caching](https://docs.nestjs.com/techniques/caching) ·
[Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events) · 计划 §5.7 / §5.10

- [ ] 装 `@nestjs/cache-manager`，给一个 `await sleep(1000)` 的路由对比开启 `CacheInterceptor` 前后的耗时；
      用 `CACHE_MANAGER` 手动实现「写操作后失效缓存」。
- [ ] 做一个 `@Sse('clock')` 每秒推一次时间——**这是 §2.8 学 RxJS 最好的回报**，
      也是理解 `Observable` 与 `Interceptor` 关系的最短路径。
- [ ] 实测 `@Sse()` 与响应信封的兼容性（已有实现里 `@Sse()` 被提前放行，验证一下真的没被包）。

### 5.4 结构化日志

📖 [Logger](https://docs.nestjs.com/techniques/logger) · backlog §3.6

- [ ] 把仓库里剩余的 `console.log` 换成 `Logger`（当前有一处在
      [validation-demo.controller.ts](../src/modules/validation-demo/validation-demo.controller.ts) 的未提交改动里）。
- [ ] 用 `app.useLogger()` 挂一个自定义实现，或直接评估 `nestjs-pino`：
      生产输出 JSON、本地 pretty、日志里自动带 `requestId`——与已有的 `traceId` 是同一件事。

### 5.5 OpenAPI 的长期维护（契约测试的完整形态）

📖 backlog §2.6 / §3.7 · 计划 §5.6

- [x] `setup-swagger.ts` 导出 `buildDocument()`，让 `setupSwagger()` 和
      文档测试**共用同一个构建函数**（已做；文档测试也搬到了 `src/swagger/__tests__/openapi.e2e-spec.ts`）。
- [ ] CI 里把 `GET /docs-json` 落成 `openapi/openapi.json` 并提交，
      用 `oasdiff` 检测**破坏性变更**（字段删除、类型收紧）。
- [ ] 加一条守卫：**每条路由都必须有 2xx 与类级失败响应**——新加路由忘挂
      `@ApiOkEnvelope` 时立刻红。这条正是 §3.2 里 `webhooks/body` 盲区的通用解。
- [ ] 用 `openapi-typescript` 从 `/docs-json` 生成客户端类型，
      让 `packages/api-contract` 那份手写契约与生成产物**对得上**——
      这是 backlog §2.7「契约类型无法共享给前端」的收尾。

---

## 6. 明确跳过（本阶段不学）

| 主题 | 什么时候学 |
| --- | --- |
| Database / TypeORM / Prisma / Mongoose | **先做 §5.2 的 Repository 端口**，再学 ORM（届时只需学映射 + 事务） |
| GraphQL | 需要 schema-first 接口时 |
| WebSockets（`@Sse()` 之外） | 需要双向推送时 |
| Microservices | 拆服务时 |
| CQRS / 事件溯源 | 业务复杂度上来后 |
| 消息队列（BullMQ） | 需要削峰 / 延迟任务时 |
| Deployment / Devtools | 准备上线时 |

> 这些全部建立在 §2–§5 之上；跳过它们不影响你写出一个完整、可测的 REST 服务。

---

## 7. 建议节奏（四个迭代，每个都能独立合并 + 独立验收）

| 迭代 | 内容 | 交付物 | 验收 |
| --- | --- | --- | --- |
| **迭代 1**（半天） | 回收层 §2 + 清掉未提交改动 | 一段说得清的"请求链路自述" | 20 道自测题 ≥ 17 对 |
| **迭代 2**（1–2 天） | §3.2 测试基座 + §3.3 `strict`/CI | `jest.json`、5 条单测、`strict: true`、CI 文件 | `pnpm test` / `build` / CI 全绿 |
| **迭代 3**（1 天） | ✅ §3.1 认证（已实现，最终形态是 JWT） + §4 平台模块 | `src/platform/`、429 进契约、`RESERVED_NAMESPACES` 清空 | 见下方"迭代 3 的验收" |
| **迭代 4**（按需） | §5 逐个触发 | 序列化层 / Repository 端口 / 缓存 / SSE / `openapi.json` 快照 | 各自章节的验收 |

**顺序理由**：迭代 2 先做，是因为**后面每一步都要靠它兜底**——Guard 和限流都要改
`ErrorCode` 联合类型，而 `strict` 与单测让这次改动可控。

> 实际发生的顺序略有不同：**§3.1（权限验证）先做了**，并顺手落地了单测基建的那一半
> （`jest.json` + `pnpm test`）。所以现在剩下的是 §3.2 的收尾（覆盖率阈值 + 三个点名单测）、
> §3.3（`strict` + CI）与 §4（平台模块，其中 429 需要再动一次 `ErrorCode`）。

---

## 8. 本仓库特有的坑（重学前先记牢）

这六条都是**这个仓库**已经踩过并修好的，换机器或重搭时最先撞上：

1. **绝不对 DTO / 模块写 `import type`** —— 类型导入会被运行时擦除，
   `emitDecoratorMetadata` 只能发出 `Object`，校验**静默失效**（README 有实测记录）。
2. **构建必须走 Nest CLI**（`pnpm build` / `pnpm start:dev`）——它会把 `@/...` 别名重写成相对路径；
   裸 `npx tsc` 产出的 `dist` 会在运行时 `MODULE_NOT_FOUND`。
3. **`@nestjs/config` 锁 `^4.0.4`** —— 12.x 是 ESM-only，本仓库是 CJS（`TS1479`）。
   装任何新包（throttler / cache-manager / pino）**先验证 CJS 兼容性**。
4. **Express 5 的裸 `*` 不合法** —— 中间件 / 路由通配符必须写 `*splat`，可选段写 `{*splat}`。
5. **pnpm 的 `allowBuilds` 值必须是布尔 `true` / `false`** —— 占位符字符串会被**静默忽略**，
   然后 install 报 `ERR_PNPM_IGNORED_BUILDS`。
6. **产物是 CJS**（`package.json` 无 `"type"` 字段）—— 相对导入**不要**写 `.js` 扩展名；
   一旦加 `"type": "module"`，规则反转，相对导入必须带 `.js`。
7. **`JWT_SECRET` 在生产环境是硬要求** —— 不配、或仍用源码里那个 `DEFAULT_JWT_SECRET`，
   进程都会拒绝启动。开发环境什么都不配能用（只告警），所以"本地能跑"不代表"部署能起"。

---

## 9. 自测问题（覆盖层用，全部答得上就可以进入 T1）

- [ ] 默写请求处理链的 7 个阶段，并在每一层标注「能拿到什么、不能拿到什么」。
- [ ] `@Module()` 四个字段各是什么？provider 不 `export` 会怎样？
- [ ] Guard / Middleware / Interceptor 三者区别？401 与 403 分别在什么场景返回？
- [ ] 管道校验失败抛什么异常、变成几号状态码、最终谁把它规范成响应体？
- [ ] `useClass` 与 `useExisting` 的区别？`forRoot` / `forFeature` / `forRootAsync` 的分工？
- [ ] 默认作用域是什么？REQUEST 作用域的性能代价？`forwardRef` 更好的替代方案是什么？
- [ ] `enableShutdownHooks()` 不做会怎样？
- [ ] 单元测试与 e2e 测试各自的 `Test.createTestingModule` 写法？`overrideProvider` 怎么用？
- [ ] 统一响应包装和统一错误响应分别用哪一层？为什么不能用中间件统一包装成功响应？
- [ ] `ValidationPipe` 的 `whitelist` 与 `forbidNonWhitelisted` 区别？
- [ ] 怎么把 `password` 从响应里永久剔除？
- [ ] 本仓库产物是 CJS 还是 ESM？判断依据是什么？
- [ ] 为什么 `import type { CreateUserDto }` 会让校验静默失效？
- [ ] 想给每个接口加限流，最少的代码改动是什么？（提示：`APP_GUARD`）
- [ ] 加了 `setGlobalPrefix('api')` + URI 版本后，有哪三处必须同步改？

---

## 附：一键验收命令

```bash
# 基线：改动前先跑一遍，确认自己是绿的
pnpm test:e2e && npx tsc -p tsconfig.json --noEmit --strict

# 迭代 2 的验收
pnpm test && pnpm test:cov && pnpm build

# 迭代 3 的验收（服务已启动）
B=http://localhost:3000
# 认证（已完成）
curl -s -X POST $B/auth/login -H 'content-type: application/json' -d '{"username":"neo","password":"matrix"}'
curl -i $B/auth/profile                                            # 401 UNAUTHENTICATED + WWW-Authenticate + traceId
curl -s -H "authorization: Bearer $TOKEN" $B/auth/profile          # 200 {sub,username}
# 平台层（待做）
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" $B/auth/profile; done   # 末两位 429
curl -s -D - -o /dev/null $B/ | grep -i 'x-powered\|strict-transport'   # 无 X-Powered-By
```

---

## 相关文档

- [`docs/nestjs-learning-plan.md`](nestjs-learning-plan.md)：Nest 框架基础路线（本文的覆盖层基准）。
- [`docs/review-backlog.md`](review-backlog.md)：一次复盘的问题清单与 §6 实施顺序（本文的 T1–T3 来源）。
- [`docs/configuration.md`](configuration.md)：环境变量契约、启动即校验、预留 namespace 的接线契约。
- [`docs/validation.md`](validation.md)：校验与响应契约的完整规则与「有意没做」的取舍。
