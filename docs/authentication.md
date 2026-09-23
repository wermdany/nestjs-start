# 认证（JWT 登录）

**一句话**：用户名 + 密码换一个 **JWT**，之后每个请求用 `Authorization: Bearer <token>` 表明身份；
守卫**全局 fail-closed**（除 `@Public()` 外都要凭证），token 里**只有身份、没有角色 / 权限**。

```bash
pnpm start:dev
B=http://localhost:3000/auth

# 1) 登录（内存里的演示账号：neo/matrix、trinity/zion）
TOKEN=$(curl -s -X POST $B/login -H 'content-type: application/json' \
  -d '{"username":"neo","password":"matrix"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.accessToken")

# 2) 带着 token 访问受保护路由
curl -s -H "authorization: Bearer $TOKEN" $B/profile     # {"success":true,"data":{"sub":"1","username":"neo"}}

# 3) 不带 / 带坏 token
curl -i $B/profile | sed -n '1p;/www-authenticate/Ip'    # 401 + WWW-Authenticate: … error="invalid_request"
```

> ⚠️ 这是**演示级**实现：用户表写死在内存、密码是明文、没有刷新令牌与吊销。
> 每一处妥协在 §7 与 §11 都写明了"生产要换成什么"。

---

## 1. 三件事，只做第一件

| 关注点 | 本仓库 | 说明 |
| --- | --- | --- |
| **认证** Authentication：你是谁 | ✅ 做 | 登录 + JWT 验签；失败 **401** `UNAUTHENTICATED` |
| 授权 Authorization：你能不能调这个接口 | ❌ 不做 | 没有角色 / 权限 / `@Roles()` —— token 里也没有这些声明 |
| 策略 Policy：你能不能动这一条数据 | ❌ 不做 | 需要授权层时才谈（§10 的升级路径） |

所以本模块的失败只有 **401** 一种（外加 400 参数不合法、404 路由不存在、500）。
"不做授权"是个明确的范围决定，不是遗漏：一旦把 `roles` 塞进 token，权限就冻结在签发那一刻，
那是需要单独设计的取舍。

## 2. 数据流

```text
POST /auth/login（@Public）
  ├─ 全局管道：LoginDto 校验（username 去空格+转小写；password 一个字都不改）
  ├─ AuthService.login()
  │    ├─ UsersService.findByUsername()        ← 内存表，无角色
  │    ├─ UsersService.verifyPassword()        ← SHA-256 + timingSafeEqual（常量时间）
  │    ├─ 失败 → 401 InvalidCredentialsException（"用户不存在"与"密码错"**同一响应**）
  │    └─ 成功 → JwtService.signAsync({ sub, username })
  └─ 200 { accessToken, tokenType: 'Bearer', expiresIn }（expiresIn = exp - iat）

GET /auth/profile（受保护）
  ├─ JwtAuthGuard（APP_GUARD，全局）
  │    ├─ @Public()？ → 放行（**不验签**）
  │    ├─ 取 Authorization: Bearer <token>        失败 → 401 invalid_request
  │    ├─ JwtService.verifyAsync(token)           失败 → 401 invalid_token（过期/签名/乱码统一）
  │    ├─ 载荷形状检查 isJwtPayload()              失败 → 401 invalid_token
  │    └─ req.user = payload；ALS.userId = sub
  └─ @CurrentUser() 取载荷 → 200 { sub, username }
```

## 3. 文件地图

| 文件 | 职责 |
| --- | --- |
| `src/auth/auth.module.ts` | `forRoot/forRootAsync`：把选项交给 `JwtModule`，注册全局 `APP_GUARD` |
| `src/auth/auth-options.ts` | `AuthOptions`（**就是** `JwtModuleOptions`）/ `AuthAsyncOptions` |
| `src/auth/auth.controller.ts` | `POST /auth/login`（`@Public()`）+ `GET /auth/profile`（受保护） |
| `src/auth/auth.service.ts` | 校验凭证 → 签发 token（唯一同时认识用户表与签名服务的地方） |
| `src/auth/users.service.ts` | 内存用户表（两个演示账号）+ 常量时间密码比较 |
| `src/auth/jwt-auth.guard.ts` | 全局认证守卫（fail-closed）+ `extractBearerToken()` |
| `src/auth/jwt-payload.ts` | `JwtPayload` 类型、`isJwtPayload()` 形状检查、`lifetimeSecondsOf()` |
| `src/auth/decorators/` | `@Public()` / `@CurrentUser()` |
| `src/auth/exceptions.ts` | `UnauthenticatedException`（401 + `WWW-Authenticate`）/ `InvalidCredentialsException`（401，不带该头） |
| `src/auth/dto/` | `LoginDto`（入参）/ `LoginResponseDto`、`ProfileDto`（响应模型） |
| `src/config/jwt.config.ts` | `JwtConfig { secret, expiresIn }`（`JWT_SECRET` / `JWT_EXPIRES_IN`） |

依赖方向：`src/auth/` **不认识 `@/config`** —— 配置 → 选项的映射在组合根
（`app.module.ts` 的 `jwtOptionsFactory`），所以它能被单独 import 进测试模块。

## 4. 接口契约

### `POST /auth/login`（`@Public()`，`@HttpCode(200)`）

```jsonc
// 请求
{ "username": "neo", "password": "matrix" }

// 200（登录是"读"语义，所以不是 POST 默认的 201）
{ "success": true,
  "data": { "accessToken": "eyJ…", "tokenType": "Bearer", "expiresIn": 3600 } }

// 401：凭证不对（**不区分**用户名不存在与密码错误，两者响应除 traceId 外逐字相同）
{ "success": false, "error": "Unauthorized", "message": "Invalid username or password",
  "code": "UNAUTHENTICATED", "traceId": "…" }

// 400：参数不合法（走既有全局管道，字段级明细带 location: "body"）
{ "success": false, "error": "Bad Request", "code": "VALIDATION_FAILED",
  "errors": [{ "field": "password", "location": "body", "code": "REQUIRED", "message": "…" }] }
```

- `username` 去首尾空格 + 转小写；**`password` 什么都不做**（首尾空格是密码的一部分）。
- 登录失败的 401 **不带** `WWW-Authenticate`：那个头是"访问受保护资源"的语义
  （告诉客户端怎么带凭证），用在登录上只会误导客户端去重试 token 流程。

### `GET /auth/profile`（受保护）

```jsonc
// 带 Authorization: Bearer <token>
{ "success": true, "data": { "sub": "1", "username": "neo" } }

// 无 / 坏 / 过期 / 载荷形状不对 → 401（键集里**没有** errors）
// 响应头：WWW-Authenticate: Bearer realm="nestjs-start", error="invalid_request|invalid_token"
{ "success": false, "error": "Unauthorized", "message": "Missing or malformed credentials",
  "code": "UNAUTHENTICATED", "traceId": "…" }
```

`sub` / `username` 是**载荷里唯一的两样东西**（加上库自动写的 `iat` / `exp`）。
`profile` 不查任何存储：token 有效本身就证明这些声明可信 —— 这就是"自描述"的含义。

## 5. 配置

| 变量 | 默认 | 校验 | 行为 |
| --- | --- | --- | --- |
| `JWT_SECRET` | `DEFAULT_JWT_SECRET`（**仅开发**） | 字符串 | 生产环境**未配置或仍用默认值 → 拒绝启动**；开发用默认值会告警 |
| `JWT_EXPIRES_IN` | `1h` | `^\d+[smhd]$`（`15m` / `1h` / `7d`） | 写进 token 的 `exp` |

启动摘要里只出现"默认 / 已配置"和有效期，**绝不输出密钥**：

```
[bootstrap] … swagger=on(http://localhost:3000) jwt=expires:1h,secret:(默认) cors=*(预留) …
```

完整规则见 [`docs/configuration.md`](configuration.md) §2「认证」。

## 6. 两个装饰器

| 装饰器 | 作用 | 备注 |
| --- | --- | --- |
| `@Public()` | 标记路由 / 控制器**不需要认证** | 全局守卫 fail-closed，所以公开必须显式声明；`getAllAndOverride` 让方法级优先于类级 |
| `@CurrentUser()` | 取载荷（或其中一个字段） | **不做认证**：`@Public()` 路由上取值是 `undefined`，所以 `@CurrentUser('sub')` 的参数类型要写成 `string \| undefined` |

业务控制器上**不需要** `@UseGuards`：守卫是全局的（`APP_GUARD`），
所以"新加路由忘了挂守卫"这个失效模式不存在 —— 反过来，忘了写 `@Public()` 会立刻 401。
仓库里 `validation-demo` 的两个控制器就是显式公开的例子（那里写清了"为什么它可以公开"）。

## 7. 安全边界

| 场景 | 行为 / 依据 |
| --- | --- |
| 无 `Authorization` / 非 Bearer / 空 token | 401 `invalid_request`（**不调用**验签） |
| 签名不对 / 结构损坏 / 已过期 / `notBefore` | 401 `invalid_token`，**统一**处理：不把库的错误细节回给客户端 |
| token 合法但载荷形状不对（缺 `sub` / `username`） | 401 `invalid_token` —— 形状检查在挂 `req.user` **之前**（`verifyAsync` 只保证签名是我们签的） |
| 用户名不存在 / 密码错误 | 同一个 401、同一句话（防止用户名枚举） |
| 密码比较的时序 | 两边先 SHA-256 再 `timingSafeEqual`（定长、不看长度与前缀） |
| 密码明文存储 | **已知的演示妥协**（代码里大声标注）：生产必须 bcrypt / argon2 加盐哈希 |
| 密钥进日志 | `describeJwt` 只输出 `secret:(默认｜已配置)`；错误信息、响应体里都不含密钥 |
| 生产用公开的默认密钥 | `validateEnv()` 直接拒绝启动（多行问题清单，无堆栈） |
| token 泄漏的后果 | 有效期内可冒充该用户；**没有**吊销机制 → 靠短有效期 + 刷新令牌（§10） |
| 用户被删 / 被禁用 | token 仍有效直到过期（守卫不查库，纯计算） |
| 暴力破解登录 | **不做**限流 / 账号锁定（见 §11） |
| `/docs` | 仍不受守卫保护（adapter 中间件提供，不经 handler）；生产靠 `ENABLE_SWAGGER` 关停 |

## 8. 为什么不引 Passport / CASL

| 方案 | 结论与理由 |
| --- | --- |
| `@nestjs/passport` | ⏸ 它的价值在**策略生态**（OAuth 几十种 provider、session、local 登录）。本期只有一种凭证（用户名 + 密码）与一种令牌（JWT），而它的默认 401 载荷不含 `code`，仍要覆写 `handleRequest` —— 换不到收益。**触发条件**：要接 Google / GitHub 登录或 session 时 |
| `@nestjs/jwt` | ✅ 采用。官方认证章现在的写法就是它（v11 文档已把认证章从 Passport 改成自建 `AuthModule` + JWT） |
| CASL（`@casl/ability`） | ⏸ 它装的是"策略层"（属性 / 多 action）。本期没有授权层，`roles` 也刻意没进 token。**触发条件**：出现"只能改自己的 / 已发布的不能删"这类规则时 |
| 自己手写 HMAC 签名 | ❌ 绝不：JWT 的坑（alg 混淆、`none`、时钟偏差、base64url 细节）不值得自己踩一遍，用官方库 |
| 守卫里 `return false` | ❌ 只会得到 `{ statusCode, message, error }`，会破坏本仓库的失败信封；官方也建议"想要不同响应就抛异常" |

## 9. 测试布局

| 文件 | 钉住什么 |
| --- | --- |
| `src/auth/__tests__/users.service.spec.ts` | 用户表查找、密码比较（含"不做 trim"）、表里没有角色字段 |
| `src/auth/__tests__/auth.service.spec.ts` | 签发成功（载荷只有身份、`expiresIn = exp - iat`）、密码错与用户不存在**同形**、密码不被 trim |
| `src/auth/__tests__/jwt-auth.guard.spec.ts` | `@Public()` 放行且不验签；401 的两种原因；过期 / 乱码 / 异密钥 / 载荷形状不对；成功挂 `req.user` + ALS `userId`；Bearer 解析规则 |
| `src/auth/__tests__/jwt-payload.spec.ts` | 形状检查与 `exp - iat` 的纯函数边界 |
| `src/auth/__tests__/auth.e2e-spec.ts` | 真应用上的完整闭环：登录 → 拿 token → 访问 profile；状态码 / 键集 / `WWW-Authenticate` / `traceId === x-request-id`；`@Public()` 白名单仍生效 |
| `src/config/__tests__/jwt.config.spec.ts` | 默认值、非法 `expiresIn` 被拒、生产缺密钥被拒、告警 |
| `src/swagger/__tests__/openapi.e2e-spec.ts` | 文档侧：路径清单、`auth` 标签、401 声明与示例键集一致 |

守卫的单测用**假 `ExecutionContext`**（`__tests__/fixtures/`）+ **真的 `JwtService`**（换个测试密钥）：
判定逻辑不该只能靠起 HTTP 才能验证，而"无效 token"也不该靠 stub 假装 —— 那条路径正是守卫存在的理由。

## 10. 升级路径

| 出现什么 | 换成什么 | 改动范围 |
| --- | --- | --- |
| 真实用户库 | `UsersService` 换成 `UsersRepository`（端口 + DB 适配器） | 只动 `users.service.ts` 的实现；`AuthService` 与守卫不动 |
| 明文密码 | bcrypt / argon2 加盐哈希（`verifyPassword` 内部改法） | 同上，一处 |
| 短有效期 + 续期 | refresh token（`POST /auth/refresh`）+ 刷新令牌表 | 新增一个端点与一处校验；守卫不变 |
| 主动吊销 / 登出 | 黑名单或"令牌版本号"（`ver` 声明 + 用户表里的当前版本） | 守卫要多查一次（从纯计算变成 I/O）—— 这是明确的取舍 |
| 角色 / 权限 | 回到 RBAC：`roles` 进 token 或查库 + `@Roles()` + `RolesGuard`（`APP_GUARD`，注册在认证之后） | 新增授权守卫与 `PERMISSION_DENIED`（403）这个 `code`；认证部分不动 |
| 细粒度策略 | CASL（属性 / 多 action），判定放业务层 | 与上面并存；守卫只看接口级准入 |
| 暴力破解 / 撞库 | `@nestjs/throttler` + 登录路由单独收紧 + 失败计数告警 | 平台模块的一次迭代；429 要加一个 `ErrorCode` |
| 多服务共享密钥 | RS256（私钥签名 / 公钥验签）+ `iss` / `aud` 校验 | 换 `JwtModule` 选项 + 守卫加 `verifyOptions` |

## 11. 有意没做 / 已知代价

**有意没做**（写清触发条件，而不是假装完备）：

- **角色 / 权限**：token 里只有 `sub` + `username`，没有 `roles` / `scope`；
- **刷新令牌、登出、吊销、多设备会话**：token 只在有效期内有效，过期就得重新登录；
- **注册、改密、找回密码、账号锁定**：用户表是写死的常量；
- **限流 / 防撞库**：登录接口和别的接口一样没有速率限制；
- **`iss` / `aud` / `jti`**：单服务、单受众场景下没有加（多服务共享密钥时必须加）；
- **密码哈希**：明文（演示），已在代码与文档双处标注。

**已知代价**：

- 守卫不查库 ⇒ "用户被删 / 被禁用"要到 token 过期才生效；
- 内存用户表 ⇒ 重启即回到两个演示账号；
- `expiresIn` 从 token 里读（`exp - iat`）⇒ 类型上是可选字段；正常路径一定存在（有单测与 e2e 钉住）；
- 演示账号写在 `UsersService` 里，`README` 与 `.env.example` 都注明了它们是**演示凭证**。

## 12. 相关文档

- [`docs/configuration.md`](configuration.md)：`JWT_SECRET` / `JWT_EXPIRES_IN` 的完整契约与启动即校验规则。
- [`docs/validation.md`](validation.md) §9：响应契约，以及 `code` / `location` / `traceId` 的分工。
- [`docs/learning-next.md`](learning-next.md)：本项在整体路线中的位置与后续迭代。
- [`docs/nestjs-learning-plan.md`](nestjs-learning-plan.md) §2.7 / §5.8：守卫与安全基础的概念基础。
