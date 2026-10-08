# 日志（Observability）

**一句话**：Nest 默认的 `ConsoleLogger` 被换成本仓库自己的结构化 logger —— **每一行都自动带 `traceId` 与 `userId`**，
同时写 stdout 与**本地滚动文件**（NDJSON）。

```bash
pnpm start:dev                 # 默认就落盘：logs/app.log

# 触发一次请求，然后按 traceId 把这条请求的所有日志捞出来
RID=$(curl -s -o /dev/null -D - localhost:3000/validation-demo/users/1 \
      | awk -F': ' '/x-request-id/{print $2}' | tr -d '\r')
grep "$RID" logs/app.log | jq -c '{level,msg,userId}'
```

---

## 1. 接管了什么，没接管什么

| 通道 | 谁产生 | 是否被接管 |
| --- | --- | --- |
| 框架内部日志（`NestFactory` / `InstanceLoader` / `Mapped {…} route`） | Nest | ✅ |
| `new Logger(Ctx)` 与 `Logger.log()` 静态调用 | 业务代码 | ✅（`Logger` 在**输出时**才解析全局实现，所以提前创建的实例也会走新 logger） |
| `console.*` | 手写的 | ❌ → 用 `no-console` 规则**禁止**（`eslint.config.mjs`，`src/` 当前零残留） |
| 进程级 `uncaughtException` / `unhandledRejection` | Node | ❌ → `installLogger()` 里单独挂（`uncaughtException` 记 `fatal` → flush → 退出码 1） |

## 2. 接线：两个安装点 + 一个顺序问题

```text
main.ts 顶层  installLogger()      ← 覆盖 validateEnv()（早于 NestFactory.create）的日志
LoggingModule(provider 工厂)       ← 覆盖任何用 AppModule 组装的进程（e2e / openapi:export / 将来的 worker）
                                   installLogger() 幂等：先来的创建，后来的复用
app.enableShutdownHooks()          ← Ctrl+C / SIGTERM 才会触发 onApplicationShutdown（flush + 关流）
```

⚠️ 本仓库的 `validateEnv(process.env)` 是 `bootstrap()` 的**第一行**（[main.ts:24](../src/main.ts#L24)），
所以只写 `app.useLogger()` 的话，**配置告警与配置错误仍然是默认格式** —— 而那正是启动阶段最该结构化的一批。
`installLogger()` 放在模块顶层就是为了它。

| 文件 | 职责 |
| --- | --- |
| [log-line.ts](../src/observability/log-line.ts) | **纯函数**：级别过滤、行构建、脱敏、序列化（可单测） |
| [log-file.writer.ts](../src/observability/log-file.writer.ts) | 滚动文件写入器：串行写入、按大小/跨天滚动、保留 N、降级、flush |
| [app-logger.ts](../src/observability/app-logger.ts) | `LoggerService` 实现：stdout + 文件双写、自动注入上下文 |
| [install-logger.ts](../src/observability/install-logger.ts) | 全局安装（幂等）+ 进程级兜底 |
| [logging.module.ts](../src/observability/logging.module.ts) | 接线模块：安装 + 访问日志中间件 + 关闭时 flush |
| [request-log.middleware.ts](../src/observability/request-log.middleware.ts) | 访问日志（`method` / `url` / `status` / `durationMs`） |

## 3. 一行日志长什么样

文件里**永远**是 NDJSON（一行一条 JSON）；dev 的 stdout 是同样内容的一行摘要：

```jsonc
// logs/app.log
{"time":"2026-09-23T13:22:47.685Z","level":"debug","msg":"profile read","context":"AuthController",
 "traceId":"b0664b9a-…","userId":"1","sub":"1"}

// 终端（pretty）
2026-09-23T13:22:47.685Z DEBUG [b0664b9a-…] [AuthController] profile read userId=1 sub=1
```

| 字段 | 恒有 | 说明 |
| --- | --- | --- |
| `time` | ✅ | ISO 8601（UTC） |
| `level` | ✅ | `verbose` … `fatal` |
| `msg` | ✅ | **稳定短句**（变量一律进字段） |
| `context` | 有则 | 类名；Nest 会把 `new Logger(Ctx)` 的 context 作为最后一个参数追加进来 |
| `traceId` | 请求内 | **等于** 响应头 `x-request-id`、失败信封里的 `traceId` |
| `userId` | 认证后 | JWT 的 `sub`（守卫写进请求上下文，logger 自动取） |
| `stack` | error/fatal 且带异常时 | 堆栈**只进日志**，绝不进响应 |
| `method` / `url` / `status` / `durationMs` | 访问日志 | 由中间件提供 |
| 其它 | 调用方传入 | 键名命中 `authorization\|cookie\|password\|secret\|token` → `[redacted]`（递归、循环引用安全、超长截断） |

**排障链**：用户报错 → 抄响应里的 `traceId` → `grep` 一条命令拿到这次请求的全部日志（含 `userId`）。
这条链是本仓库做日志的全部目的，所以有 e2e 专门钉住 `traceId` 与响应头一致。

## 4. 落盘策略

| 项 | 行为 |
| --- | --- |
| 位置 | `LOG_DIR`（默认 `logs/`，不存在自动创建）+ `LOG_FILE`（默认 `app.log`） |
| 格式 | NDJSON；**pretty 只作用于 stdout**（机器产物不该因人而异） |
| 滚动 | `size + 新行 > LOG_MAX_BYTES`（默认 10MB）**或**跨 UTC 天 → `app.log → app.1.log → app.2.log …` |
| 保留 | `LOG_MAX_FILES`（默认 5，不含活动文件）；更老的直接删除 |
| 命名 | 序号插在扩展名前（`app.1.log`）—— 这样它仍然匹配 `.gitignore` 的 `*.log`；另外 `.gitignore` 也整目录忽略了 `logs/` |
| 写入 | **串行**（promise 链）：滚动与写入不交错，`flush()` 天然可 await |
| 持久性 | **不逐行 fsync**：`kill -9` 可能丢最后几条；正常退出由 `close()` 收尾（有 e2e 断言"关闭日志是最后一行"） |
| 失败降级 | 目录建不出来 / 没权限 / 磁盘满 → **降级为只写 stdout** + 一条 stderr 警告，**不拦启动、不重试** |
| 多进程 | 本实现假设**单进程写单文件**。多实例请让每个进程写自己的文件（例如 `LOG_FILE=app-${pid}.log`）或交给采集器 |
| 测试 | `NODE_ENV=test` 默认 **不落盘**（`LOG_TO_FILE=false`）且级别 `warn`；`logging.e2e-spec.ts` 显式打开并写临时目录 |

## 5. 怎么写才算"合格"

级别判据（选错的两种典型：把 400 打成 `error` 让告警失真；把内部错误降成 `warn` 让告警不响）：

| 级别 | 用在哪 |
| --- | --- |
| `fatal` | 进程级未捕获异常（`uncaughtException`） |
| `error` | 需要**人介入**的失败（5xx、上游挂了、数据不一致） |
| `warn` | 异常但**已处理**或即将退化（登录被拒、降级、重试后成功） |
| `log` | 状态变化与**审计**（启动、用户创建、登录成功、关闭） |
| `debug` / `verbose` | 只有排障时才需要的细节（生产默认不输出） |

六条硬规则：

1. **`msg` 稳定、变量进字段** —— `grep 'user created'` 能统计，变量拼进去就不能了；
2. **错误传异常对象**（或至少 `stack`），不要只传 `error.message`；
3. **不要 `log-and-throw`** —— 业务代码负责抛，`AppExceptionFilter` 负责记（否则同一次失败记两遍）；
4. **敏感值永不入日志** —— 不 log 整个 `headers` / `dto` / 实体；logger 的脱敏只是最后一道兜底；
5. **高频路径不逐条打** —— 循环/批处理改成"聚合计数 + 抽样明细"；
6. **一条日志一件事** —— 别把开始/结束/耗时/计数塞进同一行（它们的消费方式不同）。

本仓库的现成范例（`docs/logging.md` 说的规则，在代码里都能指到）：

| 位置 | 级别 | 示范 |
| --- | --- | --- |
| [validation-demo.service.ts](../src/modules/validation-demo/validation-demo.service.ts) `create` | `log` | 审计：稳定 msg + `{userId, role, tagCount}`，**不记 email 等 PII** |
| 同上 `findAll` | `debug` | 排障细节：默认不输出；记的是"这次查询的样子"，不是每条记录 |
| [auth.service.ts](../src/auth/auth.service.ts) `login` 失败 | `warn` | 只记 `username`：**不记密码**，也不记"用户是否存在"（那是枚举结果） |
| 同上 成功 | `log` | 审计：`{sub, username}`，**不含 token** |
| [auth.controller.ts](../src/auth/auth.controller.ts) `profile` | `debug` | 调用点**不写** `userId`，由守卫 + logger 自动注入 |
| [validation-demo.controller.ts](../src/modules/validation-demo/validation-demo.controller.ts) `/boom` | `error` | 5xx：响应只有通用文案，`stack` 只在日志里 |
| 每个请求 | `log`/`warn`/`error` | 访问日志：状态码决定级别（4xx=`warn`、5xx=`error`） |

**400 / 401 / 404 为什么不记 `error`**：那是调用方的问题，把它们记为 `error` 会让告警被扫描器刷爆、也会放大日志量。
本仓库的取舍是"默认不记 + 靠 `LOG_LEVEL=debug` 看细节 + 靠指标看 4xx 率"。

## 6. 测试布局

| 文件 | 钉住什么 |
| --- | --- |
| `src/observability/__tests__/log-line.spec.ts` | 级别矩阵、字段注入（含 ALS 缺席时用字段兜底）、保留字段不可覆盖、脱敏、截断、循环引用、pretty/JSON |
| `src/observability/__tests__/log-file.writer.spec.ts` | 目录自动创建、按大小滚动、保留数、`maxFiles=0`、重启续写、跨天滚动（注入时钟）、写失败降级、`close()` 后不再接受新行 |
| `src/config/__tests__/log.config.spec.ts` | 三套环境默认值、六个变量、非法值被拒、`LOG_FILE` 含路径分隔符被拒 |
| `src/observability/__tests__/logging.e2e-spec.ts` | 真应用：访问日志带 `traceId`（与响应头一致）、`profile read` 的 `userId` 由 ALS 注入、登录成功**没有** `userId`、登录失败不记密码、`/boom` 的 error 行带 `stack` 而响应体没有、脱敏、`LOG_LEVEL` 过滤、关闭时 flush |

`src/observability/__tests__/quiet-logger.setup.ts` 是**单测道**的 setup：把默认 logger 压到 `error`，
免得业务日志把 `pnpm test` 的输出淹掉（e2e 道由 `LoggingModule` 按 `LOG_LEVEL` 管，不受影响）。

## 7. 验收

```bash
pnpm lint && pnpm test && pnpm test:e2e && pnpm build

# 落盘 + 字段
LOG_LEVEL=debug pnpm start:dev &
curl -s -o /dev/null localhost:3000/validation-demo/users/1
tail -1 logs/app.log | jq -c '{level,msg,traceId,userId}'

# traceId 关联（响应头 → 日志）
RID=$(curl -s -o /dev/null -D - localhost:3000/validation-demo/users/1 | awk -F': ' '/x-request-id/{print $2}' | tr -d '\r')
grep "$RID" logs/app.log | jq -c '{level,msg}'

# 5xx：日志有 stack，响应没有
curl -s localhost:3000/validation-demo/boom | jq 'has("stack")'          # false
grep '"level":"error"' logs/app.log | tail -1 | jq -r '.stack' | head -2

# 脱敏（应为空）
grep -E "matrix|Bearer |dev-only-insecure" logs/app.log && echo "❌ 泄漏" || echo "✅ 无泄漏"

# 滚动：把上限调小，造几次请求
LOG_MAX_BYTES=3000 LOG_MAX_FILES=2 LOG_LEVEL=debug pnpm start:dev &
ls logs/            # app.log + 最多 app.1.log / app.2.log

# 优雅关闭：Ctrl+C 后最后一行是 shutting down，且文件完整
```

## 8. 非目标与升级路径

**非目标**：日志采集/上报（Loki / ELK / OTel）、metrics 与 tracing、采样与限流、多进程聚合、日志查询 UI、
把日志写进数据库（明确排除）。

**升级路径**：需要采集器、访问日志采样或多输出目标时，换 `nestjs-pino` ——
本仓库的字段规范（§3）、脱敏规则、`traceId` 对齐与测试布局都可以照搬，
只需注意两件事：① 让 pino 的 `genReqId` 读我们已有的 `requestId`（**别搞两套请求 id**）；
② 我们的 `extra.fields` 脱敏是 pino `redact` 覆盖不到的部分，要保留。

## 9. 相关文档

- [`docs/configuration.md`](configuration.md)：`LOG_*` 的完整契约（校验、默认值、摘要）。
- [`docs/validation.md`](validation.md) §9：响应契约 —— `traceId` 与失败信封的关系。
- [`docs/authentication.md`](authentication.md)：`userId` 是从哪来的（JWT 的 `sub`）。
- [`docs/learning-next.md`](learning-next.md)：本项在整体路线中的位置。
