/**
 * 认证模块（`src/auth/`）的**对外门面**。
 *
 * 与 `src/contract/index.ts`、`src/config/index.ts` 同一套规矩：
 * 模块内部互相引用走**具体文件**（`auth.module.ts` 里写 `./jwt-auth.guard`），
 * 门面只做**显式具名导出**、不用 `export *`。
 *
 * 四层能力：
 *
 * 1. **声明**：`@Public()` / `@CurrentUser()` —— 业务侧唯一要碰的东西；
 * 2. **判定**：`JwtAuthGuard` —— 全局注册（`APP_GUARD`），业务侧不用挂；
 * 3. **签发**：`AuthService` + `UsersService`（内存用户表）；
 * 4. **协议**：`AuthController`（`POST /auth/login`、`GET /auth/profile`）。
 */

// ── 模块与选项 ────────────────────────────────────────────────────────────────
export { AuthModule } from './auth.module';
export type { AuthAsyncOptions, AuthOptions } from './auth-options';

// ── 守卫与载荷 ───────────────────────────────────────────────────────────────
export { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard';
export {
  getJwtPayload,
  isJwtPayload,
  lifetimeSecondsOf,
  JWT_PAYLOAD_PROP,
} from './jwt-payload';
export type { AuthenticatedRequest, JwtPayload } from './jwt-payload';

// ── 签发 ─────────────────────────────────────────────────────────────────────
export { AuthService } from './auth.service';
export { UsersService } from './users.service';
export type { DemoUser } from './users.service';

// ── 声明式装饰器 ─────────────────────────────────────────────────────────────
export { IS_PUBLIC_KEY, Public } from './decorators/public.decorator';
export { CurrentUser } from './decorators/current-user.decorator';

// ── 异常 ─────────────────────────────────────────────────────────────────────
export {
  BEARER_REALM,
  InvalidCredentialsException,
  UnauthenticatedException,
} from './exceptions';
export type { UnauthenticatedReason } from './exceptions';
