# AGENTS.md

> **给 AI 编码代理（以及新同事）的仓库说明书。**
> 这份文件讲**怎么在这里正确干活**；人类可读的项目介绍、接口示例、设计取舍见 [`README.md`](README.md)。
> 两者是分工关系，不是复述关系 —— 遇到冲突时以**代码和 `package.json` 为准**。

**最后校准：2026-10-08**（对应分支 `master`，工作区有未提交的 P0 修复，见 §6）

---

## 1. 这是什么

一个**纯后端**的 NestJS 11 + TypeScript 起步模板（`pnpm`，CommonJS）。它的重点不是 CRUD，而是把四件事做扎实，改动时**不要破坏它们**：

| 关注点 | 落点 | 一句话 |
| --- | --- | --- |
| 响应契约 | `src/system/http-contract/` + `http-response/` | 成功/失败都是**一个信封**，包两层会被幂等拦截 |
| 配置即校验 | `src/config/` | 启动第一件事是 `validateEnv()`，坏配置**拒绝启动**，不是运行时报错 |
| 可观测性 | `src/observability/` | 全局 logger 双写（stdout + 本地滚动文件），每行自动带 `traceId` / `userId` |
| 认证与限流 | `src/auth/`、`src/platform/` | 认证 **fail-closed**（除 `@Public()` 全要 token）；限流守卫排在认证之后 |

**没有数据库。** `src/config/database.config.ts` 是**预留** namespace（含连接契约但无消费者）。

---

## 2. 命令（唯一可信来源：`package.json` 的 `scripts`）

```bash
pnpm install            # 必须先装依赖；包管理器钉死 pnpm（packageManager: pnpm@11.8.0）
pnpm run start:dev      # ★ 开发服务器（watch + 热重载）—— 由开发者手动启动，见下
pnpm build              # 构建 → dist/main.js
pnpm typecheck          # tsc --noEmit × 2 个 project（src + scripts）
pnpm lint               # eslint（type-aware，带 --fix，覆盖 src/ 与 scripts/）
pnpm format:check       # prettier --check（本地修复用 pnpm format）
pnpm openapi:export     # 重新生成 openapi/openapi.json（该文件提交进仓库）
pnpm start:prod         # 跑 dist/main.js
```

### 🔴 运行时验证：打开发者手动启动的热重载服务器

**开始做任何测试/验证前，默认已经有一个热重载的测试服务器在跑。** 它由**开发者手动**启动：

```bash
pnpm run start:dev
```

```
http://localhost:3000        ← 测试服务器地址
```

它带 watch：**源码一改就自动热重载**，所以改完不需要重新起服务，直接打接口即可。

**所有修改与验证都应直接打这个端口**，不要退化成"只跑通编译就算完"：

```bash
curl -s http://localhost:3000/validation-demo/users | jq
curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"neo","password":"matrix"}' | jq      # 演示账号见 src/auth/users.service.ts
```

- **受保护路由要带 `Authorization: Bearer <token>`**：除 `@Public()` 之外全部 fail-closed，
  未认证拿到 **401 是预期行为**，不是 bug（`/validation-demo/*` 与 `POST /auth/login` 是 `@Public()`，可直接打）。
- `/docs` 是 Swagger UI（非 production 默认开启），`/docs-json` 是同一份文档的 JSON。
- 触发限流会得到 **429**，形状与其它失败一致（需调小 `THROTTLE_LIMIT` 才能复现）。

> ⚠️ **这是开发者的服务器**：不要 kill 它、不要换端口、不要在它上面跑压测或长时间循环请求。
> AI 也**不要自己去起**服务（会和开发者那份抢 3000，且沙箱里未必绑得上端口）。

#### 验证结果不符合预期时，先查服务器，不要先怀疑自己

第一反应应该是**确认这个服务器还活着、以及代码有没有真的被 watch 吃到**：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 通不通
lsof -nP -iTCP:3000 -sTCP:LISTEN                                  # 谁在占着 3000
```

出现下面任一种情况，就**请开发者重启**（`pnpm run start:dev`）后再验一遍：

- 连不上 / 连接被拒（进程已退出或根本没起）；
- 返回的是**改动前**的旧行为（热重载没吃上、watch 卡死、进程假死）；
- 换了环境变量 / `.env`（**watch 不会重载配置**，必须重启进程才会重新读）。

确认过服务器是新的时候，再去怀疑自己的改动。

### 改动后的**验收基线**（五项全绿才算完）

```bash
pnpm typecheck && pnpm build && pnpm lint && pnpm format:check && pnpm openapi:export
```

只要动了**对外可见的形状**（DTO 字段、装饰器、路由、响应结构、模块的 `api-docs.ts`），就必须跑 `pnpm openapi:export` 并把 `openapi/openapi.json` 的 diff **一起提交** —— 它是破坏性变更检测的基准快照。

改了**行为**的改动，除了这五项，还要按上一节**打 `http://localhost:3000` 实测一遍**并附上命令与响应。

### ⚠️ 测试当前跑不了

```bash
pnpm test         # ⚠️ 会失败："没有测试可跑" —— 这是预期，不是配置坏了
pnpm test:e2e     # ⚠️ 同上
```

本仓库在结构调整期**有意清空了全部 16 个测试文件**，`jest.json` / `jest-e2e.json` / 相关 devDependencies **保留完好**，补回测试时可直接用。详见 §6。

---

## 3. 架构地图与依赖方向

```
src/main.ts                  入口：installLogger() → validateEnv() → create → helmet → CORS
                             → shutdownHooks → Swagger → listen
src/app.module.ts            ★ 组合根：唯一的"胶水"层（把配置投影成各层选项）
src/http-enhancers.module.ts ApiContractModule：全局 PIPE / FILTER / INTERCEPTOR + 请求 id 中间件

src/system/                  系统级增强器，全部平铺，目录顺序 = 层级顺序
  http-contract/             第 1 层｜零依赖叶子：线上形状（纯类型 + ERROR_LOCATIONS）
  request-context/           第 1 层｜零依赖叶子：AsyncLocalStorage（getRequestId / setRequestUserId）
  http-response/             第 2 层｜依赖 http-contract：信封拦截器、@NoEnvelope()
  http-validation/           第 2 层｜依赖 http-contract + request-context：管道/过滤器/异常基类
  pagination/                第 3 层｜依赖上面两者：PaginationQueryDto、buildPaginatedResult()

src/config/       配置层，对外只有 index.ts（env.ts 是变量名常量 + 校验 + validateEnv）
src/auth/         认证层，对外只有 index.ts（JWT + 全局 APP_GUARD，fail-closed）
src/observability/  日志：安装 logger、双写、滚动文件、访问日志
src/swagger/      OpenAPI 投影，★ 零业务依赖
src/platform/     平台层：Throttler + CORS 选项（与"响应形状"刻意分开）
src/modules/      业务模块（当前只有 validation-demo，是"活文档"）
scripts/          ★ 构建期脚本，与 src/ 同级，**不进 dist/、不属于 HTTP 服务**
```

**依赖方向是单向的，这是这个仓库最重要的不变量**（改动时先问：我是往哪个方向加边？）：

- 叶子层 `http-contract` / `request-context` **不 import 任何东西** —— 所以任何层都能引用它们。
  `request-context` 必须独立成叶子：`observability` 与 `http-validation` **同时**需要它，
  曾经它和日志模块放在一起导致互相引用成环。**不要把它合并回 `src/observability/`。**
- `config` / `http-*` / `auth` / `platform` **互不认识**：全部只被 `app.module.ts` 的工厂函数粘起来。
  唯一的方向例外是 `config → swagger/is-swagger-enabled`（一个不 import 任何东西的纯函数）。
  好处是每层都能**单独 import 进测试模块** —— `src/auth/` 里没有一行 `@/config`。
  所以：**想让某层读到配置，就在组合根加一个 `*OptionsFactory`**，不要在该层里 `inject ConfigService`。
- `src/swagger/` **不认识任何业务**：响应模型与 tags 由业务模块自己在 `<module>/api-docs.ts` 里以
  `FeatureDocs` 描述，由组合根的 `FEATURE_DOCS` 注入。新增业务模块**不需要改 `src/swagger/` 任何文件**。
- 平台层（限流/CORS）与契约层（响应形状）**刻意分开**：两者的 `APP_GUARD` 注册顺序有语义 ——
  `PlatformModule` 排在 `AuthModule` **之后** ⇒ 未认证 + 超限返回 **401 而不是 429**。
  代价是"匿名刷受保护路由不计入限流"，取舍写在 `src/platform/platform.module.ts` 的注释里。

> 上面这些**声明**有一组 `grep` 守卫可以机器验证（含"契约层零 Swagger 依赖"），见
> [`docs/architecture-review.md`](docs/architecture-review.md) §6。

---

## 4. 必须遵守的约定

### 🔴 DTO / 模块绝不用 `import type`

**这是最容易造成"静默失效"的一条。** `import type` 会被运行时擦除，`emitDecoratorMetadata` 只能发出
`Object`，而 `Object` 在 `ValidationPipe` 的跳过名单里 —— 结果是**校验静默失效（400 变 201，无任何报错）**。

```ts
// ❌ 校验会静默失效
import type { CreateUserDto } from './dto/create-user.dto';
// ✅
import { CreateUserDto } from './dto/create-user.dto';
```

### 🔴 `strict` 是开启的，不要降级

`tsconfig.json` 里 `"strict": true`（修复成本只有 22 个机械错误，已全部修完）。
DTO 的属性用**明确赋值断言 `!`** 解决 TS2564：

```ts
name!: string;   // ✅
// ❌ 不要用 strictPropertyInitialization: false —— 会连带关掉所有其他类的这项保护
```

### 🔴 日志不许用 `console.*`

ESLint 里 `no-console` 是 **error**。走 `new Logger(Ctx)` 或 `AppLogger` ——
否则那行日志不带 `traceId` / `userId`，也不落盘（见 [`docs/logging.md`](docs/logging.md)）。

### 导入与导出

- **`@/*` 别名**（→ `src/*`）用于跨目录；同目录 / 同模块内用相对路径。
- **模块内部互相引用走具体文件，绝不走桶**（桶永远不参与循环依赖）。
- 消费方按需走**精确子桶**：`import { ApiException } from '@/system/http-validation'`。
- **子桶只做显式具名导出，不用 `export *`** —— 它会在同名时静默遮蔽，且暴露面失控。

### 新增业务模块的标准动作

1. 建 `src/modules/<name>/`，写 `api-docs.ts` 导出 `FeatureDocs`（tag + 响应模型自描述）；
2. 在 `app.module.ts` 的 `FEATURE_DOCS` 里**追加**这一项；
3. ⚠️ **只能追加到末尾** —— 数组顺序会原样带进 `components.schemas` 的键顺序与顶层 `tags` 顺序，
   插到中间会让 `openapi.json` 的 diff 变得不可读（不影响 OpenAPI 语义，但影响 review）；
4. 需要配置就加一个 `*OptionsFactory`，**不要在模块里 inject ConfigService**。

### 响应契约

- 成功/失败都是**同一个信封**；信封拦截器是**幂等**的（已包过不再包），重复 `forRoot()` 不会套两层。
- **失败响应里没有 `code` 字段** —— 这是**刻意的**取舍（错误分类落在 HTTP 状态码 + `errors[]`）。
  代价是前端无法区分"同一状态码下的不同失败原因"。**不要再顺手加回来**，除非先改
  `src/swagger/setup-swagger.ts` 的描述与 `openapi.json` 快照。

---

## 5. 已知陷阱（都真实踩过）

### 构建

- **不要直接 `npx tsc -p tsconfig.build.json`**：裸 `tsc` **不重写 `paths` 别名**
  （那是 Nest CLI 在 emit 前做的），`dist` 里会残留 `@/...`，运行时报 `MODULE_NOT_FOUND`。
  **构建一律走 `pnpm build` / `nest build`。**
- **`scripts/` 必须留在根 `tsconfig.json` 的 `exclude` 里**：它与 `src/` 的公共祖先是仓库根，
  一旦进入同一个 program，`rootDir` 会从 `src` 漂移成仓库根 ⇒ 产物变 `dist/src/main.js` ⇒ `start:prod` 失效。
- **`scripts/tsconfig.json` 的 `noEmit: true` 是硬性要求**：它的输入横跨 `scripts/` 与 `src/`，
  一旦 emit 会在 `src/` 里生成镜像的 `.js` / `.js.map`，而 `.js` 会被 Node/jest **优先于同名 `.ts` 命中**
  ⇒ `pnpm start:dev` 静默跑编译产物、改了源码不生效。真实发生过（78 个 `.js`）。
- **`helmet` 是运行时依赖**，必须留在 `dependencies`（曾误放进 `devDependencies`，
  `pnpm install --prod` 后 `node dist/main` 找不到模块）。

### 本机 / 沙箱环境

- **`nest build` 的 `deleteOutDir: true` 会一次性删掉 `dist/` 下几百个文件**，
  可能被沙箱的批量删除保护拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
  绕过方式：先把 `dist` 移到 `/tmp` 再构建。
- **AI 自己起的服务可能绑不上端口**（沙箱限制，表现为 `curl localhost:3000` 连接被拒）。
  所以**不要自己起服务** —— 运行时验证走 §2 那条路：由**开发者手动** `pnpm run start:dev`，
  AI 打 `http://localhost:3000` 验证（含"不通过时先查服务器再怀疑自己"的排查顺序）。
- **`pnpm openapi:export` 是服务器不可用时的兜底**（也是验收基线的固定一项）：它会完整启动
  `AppModule` 的 DI 图并生成文档，能查出绝大多数启动期 / 依赖注入 / 装饰器问题，
  配合 `typecheck` + `build` + `lint` 足够。它走独立的 ts-node 进程，与开发服务器互不干扰。
- `.workbuddy/` 目前**未被 `.gitignore` 忽略**，会出现在 `git status` 里。**待用户决策，不要擅自加**。

---

## 6. 当前状态与未完成项

**已落地**（均有实测验收）：配置层 + 启动即校验、幂等信封、`errors[].location`、`traceId`、
全局 logger + 滚动文件 + 日志脱敏、JWT 认证（fail-closed）+ `@Public()`、helmet / CORS / Throttler /
shutdown hooks、Swagger 单一构建函数 + `openapi.json` 快照、`strict` 全量开启、`format:check`、
`packageManager` 字段、文档漂移清理。

**工作区有未提交改动**：`master` 上有约 20 个修改过的文件（P0 修复）+
`docs/optimization-plan.md`、`.workbuddy/` 两个未跟踪项。**动手前先看 `git status` / `git diff`**，
别把别人的半成品当成基线，也别把未提交的改动"顺手格式化"进你的 diff。

**明确没做**（按投入产出比排序，见 [`docs/optimization-plan.md`](docs/optimization-plan.md)、
[`docs/learning-next.md`](docs/learning-next.md)）：

1. **测试 + CI**：当前**零测试、零 CI**（无 `.github/`）。计划是首批 3 个单测 + 覆盖率阈值 +
   CI（`lint → typecheck → build → test → oasdiff` 破坏性变更检测）。
2. **上线前项**：全局路由前缀 + 版本、body limit 显式化。
3. **接 DB 前的模式改造**：Repository 端口（把 `ValidationDemoService` 的内存表抽象掉）、序列化层。

**待修的已知缺陷**（专项审查结论，尚只记录在工作日志，未落到 `docs/`）：

- 🔴 `src/auth/auth.service.ts:42` 的 `if (!user || !this.users.verifyPassword(...))` 有**用户名枚举时序侧信道**
  —— 短路求值让"用户不存在"时完全跳过哈希计算，实测约 **2.2 倍耗时差**（2.65ms vs 1.20ms）。
  注释声称"避免枚举"，但统一文案掩盖不了耗时。修法：用户不存在时也走一次 dummy hash。
- 🟠 `ThrottlerModule` 6.7.1 的存储是**进程内 Map** ⇒ 多副本部署时限流被均摊失效、高基数 IP 下内存增长快；
  且**未设 `trust proxy`** ⇒ 反代后所有用户共享一个限流桶。
- 🟡 `verifyAsync` 未显式钉死 `algorithms: ['HS256']`（当前不是可利用漏洞，但属廉价加固）。
- 🟠 性能热点：`RotatingLogFileWriter.append` 的 promise 链串行化 + 每行两次 `Buffer.byteLength`；
  `AppLogger.write` 每条日志 `JSON.stringify` 两次；`/validation-demo/*` 是 `@Public()` 且 debug 级别默认输出。

> ⚠️ [`docs/review-backlog.md`](docs/review-backlog.md) §6 的勾选清单**已部分过期**
> （②`strict`、⑦平台模块实际已完成但未勾选）。以 `docs/optimization-plan.md` 和 §6 上文为准。

---

## 7. 改动前先读哪一份

| 你要动什么 | 先读 |
| --- | --- |
| 响应格式 / 校验 / 错误信封 | [`docs/validation.md`](docs/validation.md)、`README.md` §响应契约 |
| 环境变量 / 配置 namespace / 启动校验 | [`docs/configuration.md`](docs/configuration.md) |
| 认证 / 守卫 / 白名单 / JWT | [`docs/authentication.md`](docs/authentication.md) |
| 日志 / 脱敏 / 滚动策略 | [`docs/logging.md`](docs/logging.md) |
| 模块边界 / 依赖方向不变量 | [`docs/architecture-review.md`](docs/architecture-review.md) |
| 下一步做什么 | [`docs/learning-next.md`](docs/learning-next.md)、[`docs/optimization-plan.md`](docs/optimization-plan.md) |
| 接数据库 | [`docs/database-learning-plan.md`](docs/database-learning-plan.md)（四周计划，命令均已实测） |

---

## 8. 给代理的工作方式

1. **先读后改**：动手前跑 `git status`，并读你要改的那个文件**顶部的注释块** ——
   本仓库的注释大量记录"为什么这么写、曾经怎么踩坑"，比代码本身信息量大。**不要"顺手优化"掉这些注释。**
2. **有疑问就问，不要猜。** 尤其是：要不要动 `openapi.json`、要不要改对外契约、要不要碰测试。
3. **改完必跑 §2 的验收基线**，并在汇报时给出**每条命令的实际结果**（不是"应该没问题"）。
   改了行为的还要按 §2「运行时验证」**打 `http://localhost:3000` 实测**；验证不通过时，
   **先确认服务器是活的、且吃到了最新代码**，再怀疑自己的改动。
4. **最小 diff**：不要为了"顺手"重排 JSON 键、批量格式化无关文件、重命名既有符号 ——
   这个仓库的 diff 可读性是被刻意维护的，`FEATURE_DOCS` 的顺序注释就是为此存在。
5. **注释用现在时讲事实**。曾经有一批注释"用现在时声称某个守卫存在"，而它早已被删除 ——
   这种漂移比没有注释更糟。**删除代码时，一并清理/改写引用了它的注释。**
6. **`README.md` 与 `docs/` 是交付物的一部分**：改了行为就同步改对应文档，
   尤其是 `README.md` 的「目录结构」「常用脚本」两张表。
