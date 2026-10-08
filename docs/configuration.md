# 配置（Configuration）

一个入口、一份契约、**启动即校验**：环境变量不合法，进程直接拒绝启动并一次性列出全部问题。

```bash
cp .env.example .env     # 可选：不建也能跑（一切都有默认值）
pnpm start:dev
```

启动时会打一行摘要（**不含任何密码，也不含 JWT 密钥**）：

```
[bootstrap] env=development port=3000 host=(默认: 全部网卡) swagger=on(http://localhost:3000) jwt=expires:1h,secret:(默认) log=debug,file=logs/app.log cors=* throttle=60s/100 db=memory(预留)
```

> `(预留)` 表示这个 namespace **还没有消费者** —— 配置契约已经立好并参与校验，
> 但接线还没做（现在只剩 B1 数据库）。接线后请把
> `src/config/describe-config.ts` 的 `RESERVED_NAMESPACES` 里对应项删掉。
> `cors` / `throttle` **曾经也带这个后缀**：A2 的 `src/platform/` 落地后它们有消费者了。
> `jwt` **不是**预留：它已经有消费者（`AuthModule`），但摘要里**只说明密钥是"内置默认"
> 还是"已配置"**，以及有效期 —— 密钥本身永不出现。

---

## 1. 文件与加载顺序

`src/config/`：

| 文件 | 职责 |
| --- | --- |
| `env.ts` | **env 的单一事实来源**：变量名/默认值常量、类型转换、校验类、`validateEnv`、告警规则 |
| `app.config.ts` / `swagger.config.ts` / `platform.config.ts` / `jwt.config.ts` / `log.config.ts` / `database.config.ts` | 六个文件的 **7 个 namespace**（`app` / `swagger` / `cors` / `throttle` / `jwt` / `log` / `database`，其中 `platform.config.ts` 出 `cors` 与 `throttle` 两个），每个都先导出**纯函数** `read*Config(env)`，再用 `registerAs()` 包一层 |
| `describe-config.ts` | `readResolvedConfig()` / `formatConfigSummary()` / `redactUrl()` |
| `app-config.module.ts` | `AppConfigModule`（`ConfigModule.forRoot`）+ `resolveEnvFilePaths()` / `shouldIgnoreEnvFile()` |
| `index.ts` | 门面桶（显式具名导出，与 `src/system/*/index.ts` 各模块门面同一套规矩） |

`.env` 文件**按优先级从高到低**（先命中的生效）：

```
.env.${NODE_ENV}.local   ← 个人覆盖
.env.local               ← 个人覆盖（test 环境跳过）
.env.${NODE_ENV}         ← 环境级默认值
.env                     ← 团队默认值
```

- `NODE_ENV` 未设时按 `development` 拼路径（不会出现 `.env.undefined`）。
- `NODE_ENV=test` 时**完全不读 env 文件** —— 测试结果不该依赖开发者本机有没有 `.env`。
- `.gitignore` 忽略 `.env` 与 `.env.*`，但 `!.env.example` 例外（模板必须入库）。

---

## 2. 变量表

### 应用

| 变量 | 默认 | 校验 | 消费者 |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | 只能是 `development` / `test` / `production` | 各处环境判断 |
| `PORT` | `3000` | 1..65535 的整数 | ✅ `main.ts` |
| `HOST` | 未设 | 字符串 | ✅ `main.ts`（未设时**不传** host，保持 Node "绑定全部网卡"的默认行为） |
| `STRICT_VALIDATION` | `false` | 恰好 `true` / `false` | ✅ `app.module.ts` → 契约层 `forbidNonWhitelisted` |
| `ENABLE_ENVELOPE` | `true` | 恰好 `true` / `false` | ✅ `app.module.ts` → 契约层响应信封 |

### 配置怎么影响契约层

`app.module.ts` 里的 `apiContractOptionsFactory` 是**唯一的粘合点**：

```ts
export function apiContractOptionsFactory(config: ConfigService): ApiContractOptions {
  const { strictValidation, envelope } = config.getOrThrow<AppConfig>('app');
  return { forbidNonWhitelisted: strictValidation, envelope };
}

@Module({
  imports: [
    AppConfigModule,
    ApiContractModule.forRootAsync({ inject: [ConfigService], useFactory: apiContractOptionsFactory }),
    ValidationDemoModule,
  ],
})
```

| 环境变量 | 效果 | 实测 |
| --- | --- | --- |
| `STRICT_VALIDATION=true` | 多一个未声明字段 → 400（默认被静默剥掉） | `POST /users` 带 `extra` → 400 + `errors[].field="extra"` |
| `ENABLE_ENVELOPE=false` | 成功响应是 handler 裸返回值 | `GET /users/1` → `{"id":1,...}`，没有 `success` |
| 同上 | **失败侧不受影响** | `GET /users/999999` → 仍是 `{success:false, error:"Not Found", message:"user 999999 not found"}` |

映射放在组合根（而不是 `src/config/` 或 `src/system/http-*`）是刻意的：
`config` 不该认识契约、`contract` 不该认识配置，把两者粘起来是 `app.module.ts` 的职责。
它被单独导出成函数，测试里可以直接断言映射结果。

### 认证（JWT 登录）

认证用的两件事：**签名密钥**与**有效期**。它们是 `AuthModule` 唯一的配置输入。

| 变量 | 默认 | 校验 | 消费者 |
| --- | --- | --- | --- |
| `JWT_SECRET` | `DEFAULT_JWT_SECRET`（**仅开发**） | 字符串；**生产环境未配置或等于默认值 → 拒绝启动** | ✅ `app.module.ts` → `AuthModule`（`jwtOptionsFactory`） |
| `JWT_EXPIRES_IN` | `1h` | `^\d+[smhd]$`（`15m` / `1h` / `7d`） | ✅ 同上（写进 token 的 `exp`） |

```bash
# 生产环境必须显式配置，例如：
JWT_SECRET=$(openssl rand -base64 48)
JWT_EXPIRES_IN=1h
```

- **没有"安全的空默认值"**：默认密钥写在源码里，等于公开 —— 所以生产环境**拒绝启动**
  而不是"warning 一下继续跑"。开发环境用默认值只告警（启动摘要里也能看到 `secret:(默认)`）。
- 密钥短于 32 字符 → 告警（只提示，不拦启动）。
- 映射同样发生在组合根（`app.module.ts` 的 `jwtOptionsFactory`），理由与上面那段相同：
  选项的形状就是 `JwtModuleOptions`，`src/auth/` 里没有一行 `@/config`。

> 演示账号（写死在 `src/auth/users.service.ts`，仅用于把登录流程跑通）：
> `neo` / `matrix`（`sub=1`）、`trinity` / `zion`（`sub=2`）。
> 这是**演示级**实现：密码明文、无刷新令牌、无吊销 —— 见
> [`docs/authentication.md`](authentication.md) §7 / §11。

### 日志（Observability）

日志自己有六个变量 —— 它们是"日志写到哪、写多细、留多久"的全部旋钮。

| 变量 | 默认 | 校验 | 说明 |
| --- | --- | --- | --- |
| `LOG_LEVEL` | dev=`debug`、test=`warn`、prod=`log` | `verbose` / `debug` / `log` / `warn` / `error` / `fatal` | 输出阈值（低于它的直接丢弃） |
| `LOG_TO_FILE` | 非 test=`true`、test=`false` | 恰好 `true` / `false` | 是否同时写本地文件 |
| `LOG_DIR` | `logs` | 非空字符串 | 目录（不存在自动创建） |
| `LOG_FILE` | `app.log` | 非空、**不含路径分隔符** | 活动文件名；目录只能由 `LOG_DIR` 管 |
| `LOG_MAX_BYTES` | `10485760`（10MB） | ≥0 的整数（0 = 只按天滚动） | 超过即滚动 |
| `LOG_MAX_FILES` | `5` | 0..100 的整数 | 保留的历史文件数（不含活动文件） |

- 落盘内容是 **NDJSON**（一行一条 JSON）；dev 的 stdout 是同一内容的一行摘要，`pretty` 由
  `NODE_ENV` 推导（非 production 才开），**不是**环境变量。
- **测试环境默认不落盘**：既不污染仓库，也不让写盘拖慢用例（原先有一条专门的 `logging.e2e-spec.ts`
  会显式打开并写到临时目录 —— 测试已全部删除）。
- 启动摘要里会带上 `log=debug,file=logs/app.log`（不落盘时是 `file=off`）——
  这是运维第一眼要看的东西：日志没在写，别的排障手段都会打折扣。

> 完整规范（字段、滚动策略、失败降级、多进程注意、怎么写才算合格的日志）见
> [`docs/logging.md`](logging.md)。

### 接口文档

| 变量 | 默认 | 校验 | 消费者 |
| --- | --- | --- | --- |
| `ENABLE_SWAGGER` | 由规则决定 | **不校验** | ✅ `main.ts` → `setupSwagger` |
| `SWAGGER_SERVER_URL` | `http://localhost:3000` | 合法 URL | ✅ `main.ts` → `setupSwagger` |

`ENABLE_SWAGGER` 的规则仍住在 `src/swagger/is-swagger-enabled.ts`（4 种组合原先有 e2e 钉住，测试已删除）：

| `ENABLE_SWAGGER` | `NODE_ENV` | 结果 |
| --- | --- | --- |
| `'true'` | 任意 | 开 |
| `'false'` | 非 production | 关 |
| 未设 | `production` | 关 |
| 未设 | 其它 | 开 |

> 只认**恰好** `'true'` / `'false'`。`'1'` / `'yes'` 这类"含糊真值"**不算显式**，按未设处理
> —— 而不是报错。这与其它新布尔变量（严格）是**刻意的不对称**：这条规则先于本模块存在、
> 原先已被 e2e 钉住（测试已删除），改成报错属于行为变更；新变量则一律从严。

### 平台层（✅ A2 已接线：`src/platform/`）

| 变量 | 默认 | 校验 | 消费者 |
| --- | --- | --- | --- |
| `CORS_ORIGINS` | `*` | 逗号分隔、逐项非空；**生产环境含 `*` ⇒ 拒绝启动** | `platformOptionsFactory()` → `toCorsOptions()` → `main.ts` 的 `app.enableCors()` |
| `THROTTLE_TTL_SECONDS` | `60` | 大于 0 的整数 | 同上 → `toThrottlerOptions()`（**换算成毫秒**）→ `PlatformModule` 的 `ThrottlerGuard` |
| `THROTTLE_LIMIT` | `100` | 大于 0 的整数 | 同上（窗口内**允许**的请求数：`3` ⇒ 第 4 次 429） |

> 两个变量的**政策**（通配来源不带凭证、秒→毫秒）写在
> `src/platform/platform.options.ts`，不在配置层 —— 配置层只管"形状与取值域"。
> 实测见 [README §配置](../README.md#配置) 与 `docs/learning-next.md` §4。

### 数据库（🅿️ 预留，B1 接线）

| 变量 | 默认 | 校验 |
| --- | --- | --- |
| `DATABASE_DRIVER` | `memory` | `memory` / `postgres` / `mysql` / `sqlite` |
| `DATABASE_URL` | 未设 | 字符串（**不用 `@IsUrl`**：sqlite 是 `file:` 形式） |
| `DATABASE_HOST` | 未设 | driver≠memory 且无 `url` 时**必填** |
| `DATABASE_PORT` | postgres 5432 / mysql 3306 | 1..65535 的整数 |
| `DATABASE_USER` | 未设 | 同 `HOST` 的必填规则（sqlite 豁免） |
| `DATABASE_PASSWORD` | 未设 | 字符串；**永不进日志** |
| `DATABASE_NAME` | 未设 | 同 `HOST`（sqlite 时是文件路径） |
| `DATABASE_SCHEMA` | 未设 | 字符串 |
| `DATABASE_SSL` | `false` | 恰好 `true` / `false` |
| `DATABASE_POOL_SIZE` | `10` | 1..100 的整数 |
| `DATABASE_LOGGING` | `false` | 恰好 `true` / `false` |
| `DATABASE_SYNCHRONIZE` | `false` | 恰好 `true` / `false`；**生产为 `true` 直接拒绝启动** |
| `DATABASE_MIGRATIONS_RUN` | `false` | 恰好 `true` / `false` |

---

## 3. 启动即校验：致命 vs 告警

**致命**（`validateEnv` 抛 `EnvValidationError` → 进程不启动，一次性列出全部问题）：

- 任何变量的**形状**不合法（类型 / 枚举 / 区间 / 布尔字面量）；
- `JWT_EXPIRES_IN` 格式不对（不是「数字 + `s`/`m`/`h`/`d`」，例如 `forever` / `1 hour`）；
- **`NODE_ENV=production` 时 `JWT_SECRET` 未配置**，或显式等于源码里那个公开的默认值
  —— 两种都等于"没有签名"，所以直接拒绝启动；
- `LOG_LEVEL` 不是六个合法级别之一、`LOG_TO_FILE` 不是恰好 `true`/`false`、
  `LOG_MAX_BYTES` / `LOG_MAX_FILES` 越界，或 `LOG_FILE` 里带了路径分隔符
  （目录只能由 `LOG_DIR` 管 —— 否则 `LOG_FILE=../../etc/hosts` 这种写法会静默写到意外的地方）；
- 数据库**跨字段**不成立：`driver ≠ memory` 且既没有 `DATABASE_URL`，又缺 `HOST` / `USER` / `NAME`
  （sqlite 只要求 `NAME`）；
- `NODE_ENV=production` 且 `DATABASE_SYNCHRONIZE=true` —— 让 ORM 自动改表是数据事故，
  生产请用 `DATABASE_MIGRATIONS_RUN=true` 走迁移；
- **`NODE_ENV=production` 时 `CORS_ORIGINS` 未设或含 `*`** —— 两个独立理由：
  浏览器规范禁止 `Access-Control-Allow-Origin: *` 与凭证同时出现（通配来源等于
  "永远不能带 Cookie"），而它本身就是"没有来源边界"。
  ⚠️ 这条**曾经只是告警**（那时 CORS 还没接线），A2 落地后升级为致命。

**告警**（只打 `WARN [ConfigModule]`，不拦启动）：

- 生产环境 `DATABASE_LOGGING=true`（SQL 可能带出敏感数据）；
- 生产环境 `ENABLE_SWAGGER=true`（会暴露完整接口文档）；
- `DATABASE_DRIVER=memory` 却配了 `DATABASE_PASSWORD` —— 典型的"以为它在生效"；
- 非生产环境在用**内置的开发默认 `JWT_SECRET`**（任何人都能用它伪造 token）；
- `JWT_SECRET` 短于 32 个字符（HMAC 密钥太短容易被暴力猜）。

实测：

```bash
$ PORT=abc node dist/main
[bootstrap] ERROR 配置校验失败，进程不会启动：
  - PORT: PORT 必须是 1..65535 之间的整数（收到 "abc"）
$ echo $?     # 1（无堆栈）

$ NODE_ENV=staging DATABASE_POOL_SIZE=999 DATABASE_SSL=yes node dist/main
[bootstrap] ERROR 配置校验失败，进程不会启动：
  - NODE_ENV: NODE_ENV 只能是 development / test / production 之一（收到 "staging"）
  - DATABASE_SSL: DATABASE_SSL 只能是 'true' 或 'false'（收到 "yes"）
  - DATABASE_POOL_SIZE: DATABASE_POOL_SIZE 必须是 1..100 之间的整数（收到 "999"）
```

---

## 4. 数据库配置的**预留契约**（B1 必须遵守）

现在没有任何 ORM，但接线时的决定已经定好了：

1. **`url` 优先**：`url` 存在时，`host` / `port` / `username` / `password` / `name` 一律忽略。
   实现映射时先判断 `url`（这也是云厂商只给一个连接串的现实）。
2. **`port` 已经算好**：未显式设置时按驱动给默认值（postgres 5432 / mysql 3306）。
   B1 **不要**再写一遍"没有端口就用 5432"。
3. **`memory` 是默认驱动**：不设任何 `DATABASE_*` 也能启动；一旦把 driver 改成别的，
   缺字段会在**启动期**失败，而不是第一次查询时。
4. **`synchronize` 生产禁用**：校验器已经拦住 `production + true`。
5. **`password` 是敏感字段**：任何日志、健康检查、调试接口都不得打印；
   打印连接目标请用 `redactUrl()` / `formatConfigSummary()`。

B1 的接入点长这样（示意）：

```ts
// 未来：src/modules/persistence/persistence.module.ts
PersistenceModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const database = config.getOrThrow<DatabaseConfig>('database');
    // 1) database.url 优先  2) 否则用离散字段 + 已补好的 port
    ...
  },
});
```

---

## 5. 为什么这么设计（以及不这么做会怎样）

### 5.1 校验**不走** `ConfigModule.forRoot({ validate })`

因为它同时踩了三个坑（都实测过）：

1. `ConfigModule.forRoot()` 是 **async** 的 ⇒ 校验异常变成 Promise rejection；
2. 它在**模块定义时**执行 ⇒ 任何 import 到配置模块的代码都会触发校验，失败点取决于 import 顺序；
3. 那个 rejection 由 Nest 内部的 `ExceptionHandler` 接手 —— **只有一行带堆栈的 ERROR**，
   既不 reject `NestFactory.create()`，也不进 `bootstrap().catch`。

所以改为**入口显式调用**：

```ts
// src/main.ts
async function bootstrap(): Promise<void> {
  validateEnv(process.env);              // ← 第一件事
  const app = await NestFactory.create(AppModule);
  ...
}
bootstrap().catch((error) => {
  if (error instanceof EnvValidationError) {
    Logger.error(error.message, undefined, 'bootstrap');   // 多行清单，不带堆栈
    process.exitCode = 1;
    return;
  }
  ...
});
```

代价：**每个会创建应用的入口都要记得调用一次**。目前有两个：
`src/main.ts` 与 `scripts/export-openapi.ts`（原 `src/swagger/export-openapi.ts`）。新增入口（serverless handler、worker）时照着加。

### 5.2 用 `class-validator`，不引 zod / Joi

- 本仓库的**入参校验**已经是 class-validator —— 环境变量是第二处用它，
  同一个心智模型、同一套错误文案风格，零新增校验依赖；
- `@nestjs/config` 原生支持 `validate: (config) => config`，接自己的实现最直接；
- 代价：env 里一切都是字符串，数字/布尔要显式声明（`@Type(() => Number)` / `@IsIn(['true','false'])`）。

想换 zod 的话只需替换 `env.ts` 里的 `EnvironmentVariables` + `validateEnv`，
`read*Config()` 与所有消费者都不用动（它们只依赖返回值类型）。

### 5.3 默认值只有一处

默认值都是 `env.ts` 里的导出常量（`DEFAULT_PORT` / `DEFAULT_DATABASE_DRIVER` / …），
被**校验器与读取函数共同 import**。`validateEnv()` **不注入默认值**，只判断"给了的值"合不合法
—— 于是不会出现"校验说 3000、读取说 8080"这种漂移。

### 5.4 读整个 namespace，不读扁平键

```ts
const app = config.getOrThrow<AppConfig>('app');     // ✅ 类型是我们自己定义并测试过的
const port = config.get('PORT');                     // ❌ 拿到的是原始字符串，第二套读取方式
```

不用 `{ infer: true }`：那依赖 `ConfigService` 的泛型推导，而手写接口 + 显式泛型
让**测试断言的就是同一份类型**。

### 5.5 敏感值处理

`redactUrl()` 把连接串里的 username / password 换成 `***`；`formatConfigSummary()`
对离散字段只输出 `driver@host:port/name`。密码与 **JWT 密钥**都不进启动摘要、不进错误信息、
不进 OpenAPI 文档：

- `describeJwt()` 只输出"是默认值还是已配置"与有效期（`jwt=expires:1h,secret:(默认)`）；
- 与 JWT 相关的启动期问题只说"哪个变量不对"，**绝不复述密钥内容**；
- 日志本身也做了脱敏：字段名命中 `authorization` / `cookie` / `password` / `secret` / `token`
  的值会被替换成 `[redacted]`（递归生效），而且是"最后一道兜底" —— 规范要求不把整个
  `headers` / `dto` 丢进日志（见 [`docs/logging.md`](logging.md) §5）。

---

## 6. 加一个新环境变量（清单）

1. 在 `src/config/env.ts` 加**默认值常量**（如有）；
2. 在 `EnvironmentVariables` 里加字段 + 校验装饰器（中文 `message`，讲清"应该是什么"）；
3. 需要跨字段规则就加进 `findCrossFieldProblems()`；只告警就加进 `configWarnings()`；
4. 在对应的 `read*Config(env)` 里读出来（用 `toInt` / `toBoolean` / `toOptionalString` …）；
5. 在 `.env.example` 里写下说明（含默认值与注意事项）；
6. 测试重建后，在 `src/config/__tests__/config.e2e-spec.ts` 里补：**默认值**、**非法值被拒**、**边界**
   （该文件与全部测试一起被删除，目前 `pnpm test` 无测试可跑）；
7. 更新本文件第 2 节的表。

---

## 7. 相关文档

- [`docs/authentication.md`](authentication.md)：`JWT_SECRET` / `JWT_EXPIRES_IN` 的消费者（登录 + 守卫）。
- [`docs/logging.md`](logging.md)：`LOG_*` 的消费者（日志接管 + 本地滚动文件）。
- [`docs/review-backlog.md`](review-backlog.md) §3.4：这一项的来源与验收方式。
- [`docs/validation.md`](validation.md) §9：响应契约（配置错误也走同一套失败信封吗？——
  见 §5.1：配置错误发生在请求之前，所以它不进 HTTP 契约，直接以非零退出码结束进程）。
