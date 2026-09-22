import type { ErrorBody } from '@nest-start/api-contract';

/**
 * 失败侧契约。**形状本身定义在 `@nest-start/api-contract`**（前后端共享的那一份），
 * 这里只补本地语境的说明与一个更贴合"错误侧"阅读习惯的别名。
 *
 * 失败响应由 `AppExceptionFilter` 产出：
 *
 * ```json
 * {
 *   "success": false,
 *   "error": "Bad Request",
 *   "message": "Request validation failed",
 *   "code": "VALIDATION_FAILED",
 *   "traceId": "3f1c9a4e-…",
 *   "errors": [
 *     { "field": "address.city", "location": "body", "code": "INVALID_LENGTH",
 *       "message": "city must be longer than or equal to 2 characters" }
 *   ]
 * }
 * ```
 *
 * 各字段的分工：
 *
 * | 字段 | 给谁用 |
 * | --- | --- |
 * | HTTP 状态行 | 代理 / 缓存 / 监控（**数字状态码只在状态行里**） |
 * | `error` | HTTP 状态短语（无需查表的人话标识） |
 * | `code` | **机器判据**：前端 `switch` 这个，不要 parse `message`；框架自身抛的错可能没有（可选） |
 * | `traceId` | 把响应和日志对上的请求 id（同时回写在 `x-request-id` 响应头） |
 * | `message` | 人类可读说明 |
 * | `errors[].field` | **前端映射到表单字段**（嵌套用点号：`address.city`） |
 * | `errors[].location` | 这个路径来自 `body` / `query` / `param` —— 同名不同源时才分得清 |
 * | `errors[].message` | 终端用户（可 i18n） |
 *
 * ⚠️ 这里**没有** `statusCode`：数字状态码只由 HTTP 状态行表达（过滤器调 `response.status(...)`），
 * 在 body 里冗余一份只多一个"和状态行漂移"的隐患。见 `docs/validation.md` §9.2。
 *
 * 契约层**不依赖任何 Swagger 包**：OpenAPI 里的投影（`$ref` / schema）全部在 `src/swagger/`，
 * 用那里的 e2e 守卫（schema 属性 ↔ 运行时错误明细）保证两边不漂移。
 */
export type {
  ErrorBody,
  ErrorDetail,
  ErrorLocation,
} from '@nest-start/api-contract';

/**
 * 失败响应形状的**本地别名**：与 `../response/response-contract.ts` 的 `ErrorBody` 是同一个类型。
 *
 * 保留这个名字是因为过滤器 / 校验工厂读起来需要"错误侧"的本地上下文，
 * 而 `ResponseBody` 是"整体契约"的入口。两者同源 ⇒ 不存在两个定义漂移的可能。
 */
export type ApiErrorBody = ErrorBody;
