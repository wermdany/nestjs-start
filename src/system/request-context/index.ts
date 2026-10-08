/**
 * 请求上下文（request id / userId）的**对外门面**。
 *
 * ## 这个模块为什么是**零依赖底座**
 *
 * 它只依赖 `node:async_hooks` 与 `@nestjs/common`（`RequestIdMiddleware`）。
 * 于是它可以被任何层依赖而不产生方向问题 —— 尤其是 `observability`（日志）与
 * `http-validation`（异常过滤器）**都**需要它，而两者互不认识。
 *
 * ## 历史：它曾经造成过一处循环依赖
 *
 * 本模块原先住在 `src/contract/observability/`，与 `src/observability/`（日志）
 * **同名不同物**。而当时：
 *
 * ```
 * src/contract/validation/http-exception.filter.ts → ../observability/request-context
 * src/observability/app-logger.ts                  → @/contract（经大桶反取 getRequestContext）
 * ```
 *
 * 于是 `validation` 与 `observability` 互相引用。把它提成独立的底座模块后，
 * 依赖方向变成单向：`observability → request-context`、`http-validation → request-context`。
 * ⚠️ 不要把它合并进 `src/observability/`（日志）—— 会立刻把那个环改回来。
 *
 * 规矩与其它模块一致：模块内部互相引用走**具体文件**，本桶只做对外门面。
 */

export { RequestIdMiddleware } from './request-id.middleware';
export { REQUEST_ID_HEADER, REQUEST_ID_PROP } from './request-id.middleware';

export {
  getRequestContext,
  getRequestId,
  runWithRequestContext,
  setRequestUserId,
} from './request-context';
export type { RequestContext } from './request-context';
