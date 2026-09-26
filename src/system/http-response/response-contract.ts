/**
 * 全站响应契约。核心只有一条：**body 里只放 HTTP 层给不了的东西**。
 *
 * 形状本身定义在 `@nest-start/api-contract`（前后端共享的那一份）：
 * 这里只保留**服务端运行时**才需要的东西（两个 symbol 标记），并把类型转出来。
 *
 * ```jsonc
 * // 成功：{ success, data, meta? }
 * { "success": true, "data": { "id": 1 } }
 * { "success": true, "data": [ ... ],
 *   "meta": { "totalItems": 3, "itemsPerPage": 50, "currentPage": 1 } }
 *
 * // 失败：{ success, error, message, code?, traceId?, errors? }
 * { "success": false, "error": "Bad Request", "message": "Request validation failed",
 *   "code": "VALIDATION_FAILED", "traceId": "3f1c9a4e-…",
 *   "errors": [ { "field": "name", "location": "body", "message": "name must be a string",
 *                 "code": "INVALID_TYPE" } ] }
 * { "success": false, "error": "Not Found", "message": "user 999999 not found",
 *   "code": "USER_NOT_FOUND", "traceId": "3f1c9a4e-…" }
 * ```
 *
 * 字段规则（`ResponseBody<T>` 就是成功/失败两者的可判别联合）：
 *
 * | 字段 | 恒有？ | 内容 |
 * | --- | --- | --- |
 * | `success` | 是 | **唯一判据**。`true` 必有 `data`，`false` 必有 `error` + `message` |
 * | `data` | 仅成功 | handler 的返回值；分页时是**这一页的数据数组** |
 * | `meta` | 仅成功、仅有元数据时 | 分页元信息（`totalItems` / `itemsPerPage` / `currentPage`） |
 * | `error` | 仅失败 | HTTP 状态短语，如 `Bad Request` |
 * | `code` | 仅失败、仅有语义时 | **机器判据**（前端 `switch` 它，不要 parse `message`） |
 * | `traceId` | 仅失败（真实 HTTP 请求里恒有） | 请求 id，同时回写在 `x-request-id` 响应头 |
 * | `message` | 仅失败 | 人类可读说明 |
 * | `errors` | 仅失败、仅有字段级明细时 | `{ field, location?, message, code? }[]` |
 *
 * 三条刻意为之的取舍：
 *
 * - **数字状态码不放进 body**（不管是 200 还是 404）。它由 HTTP 状态行表达，
 *   前端从 `res.status`（axios 是 `error.response.status`）拿即可；在 body 里再冗余一份，
 *   既没有信息增量，又埋了"body 与状态行漂移"的隐患。这是 RFC 9110 的分工：状态码属于 HTTP 层。
 * - **成功响应没有 `message`**。成功文案该由前端按接口 / `data` 自己出（前端有 i18n、设计规范）；
 *   后端下发文案只会让它变成事实上的对外契约，改一个字都变成破坏性变更。
 * - **失败响应有 `message`**：它是人话说明，是 `errors[]` 之外唯一的可读信息，前端要拿它 toast；
 *   但**判据是 `code`**，`message` 可以随便改（含 i18n）而不算破坏性变更。
 *
 * 两条实现上的约定：
 *
 * - **成功侧**由 `ResponseEnvelopeInterceptor` 包（`APP_INTERCEPTOR`）。
 * - **失败侧**由 `AppExceptionFilter` 产出（`APP_FILTER`），HTTP 状态码由它按异常设置。
 *   handler 抛异常时成功信封根本不参与，所以永远不会出现"既带 data 又带 error"的响应。
 */
export type {
  ErrorBody,
  ErrorDetail,
  ErrorLocation,
  ResponseBody,
  SuccessBody,
} from '@nest-start/api-contract';

/**
 * 标记「这是分页结果」的私有 symbol。
 *
 * 用属性名做标记：`buildPaginatedResult()` 把它写成**非枚举**属性，
 * 于是它对 `JSON.stringify` 完全隐形（零线上开销、wire 形状不变），
 * 但 `ResponseEnvelopeInterceptor` 能可靠识别分页结果、把 `data` / `meta` 提到信封顶层。
 *
 * **为什么不用结构判断**（`'data' in value && 'meta' in value`）：
 * 领域对象里合法出现 `data` / `meta` 字段时会被误判成分页结果，字段被静默提到顶层 —— 契约就变了。
 * 标记法不存在这种误判。
 */
export const PAGINATED_RESULT = Symbol('PAGINATED_RESULT');

/**
 * 标记「这个对象已经是一个响应信封」的私有 symbol（同样是**非枚举**，wire 形状不变）。
 *
 * 存在的理由只有一个：**让信封幂等**。
 *
 * `ApiContractModule` 的 `APP_*` provider 是挂在模块上的，而模块可以被 import 多次
 * （典型的坑：某个 `SharedModule` 自己也 `imports: [ApiContractModule.forRoot()]`）。
 * Nest 会把整张模块图里所有 `APP_INTERCEPTOR` 实例收进同一条拦截器链，于是 `map()` 跑两次：
 *
 * ```json
 * {"success":true,"data":{"success":true,"data":{…}}}   // ← 契约被破坏
 * ```
 *
 * 只把"注册一次"写进文档是不够的（下一层模块的作者看不到），所以让拦截器自己判断：
 * 已经带标记的返回值原样放行。`AppExceptionFilter` 侧无此问题 ——
 * Nest 的 `ExceptionsHandler` 命中第一个匹配的过滤器就返回。
 */
export const ENVELOPED = Symbol('ENVELOPED');
