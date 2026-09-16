import type { ErrorDetail } from '../validation/error-contract';

/**
 * 全站响应契约。核心只有一条：**body 里只放 HTTP 层给不了的东西**。
 *
 * 只要请求真的走完了 Nest 的请求管线，响应体就一定是下面两种之一 ——
 * 前端用 `success` 一个字段判断成败，不需要看状态码。
 *
 * ```jsonc
 * // 成功：{ success, data, meta? }
 * { "success": true, "data": { "id": 1 } }
 * { "success": true, "data": [ ... ],
 *   "meta": { "totalItems": 3, "itemsPerPage": 50, "currentPage": 1 } }
 *
 * // 失败：{ success, error, message, errors? }
 * { "success": false, "error": "Bad Request", "message": "Request validation failed",
 *   "errors": [ { "field": "name", "message": "name must be a string" } ] }
 * { "success": false, "error": "Not Found", "message": "user 999999 not found" }
 * ```
 *
 * 字段规则（`ResponseBody<T>` 就是这两者的联合）：
 *
 * | 字段 | 恒有？ | 内容 |
 * | --- | --- | --- |
 * | `success` | 是 | **唯一判据**。`true` 必有 `data`，`false` 必有 `error` + `message` |
 * | `data` | 仅成功 | handler 的返回值；分页时是**这一页的数据数组** |
 * | `meta` | 仅成功、仅有元数据时 | 分页元信息（`totalItems` / `itemsPerPage` / `currentPage`） |
 * | `error` | 仅失败 | HTTP 状态短语，如 `Bad Request` |
 * | `message` | 仅失败 | 人类可读说明 |
 * | `errors` | 仅失败、仅有字段级明细时 | `{ field, message }[]`，`field` 是权威定位 |
 *
 * 三条刻意为之的取舍：
 *
 * - **数字状态码不放进 body**（不管是 200 还是 404）。它由 HTTP 状态行表达，
 *   前端从 `res.status`（axios 是 `error.response.status`）拿即可；在 body 里再冗余一份，
 *   既没有信息增量，又埋了"body 与状态行漂移"的隐患。这是 RFC 9110 的分工：状态码属于 HTTP 层。
 * - **成功响应没有 `message`**。成功文案该由前端按接口 / `data` 自己出（前端有 i18n、设计规范）；
 *   后端下发文案只会让它变成事实上的对外契约，改一个字都变成破坏性变更。
 * - **失败响应有 `message`**：它是人话说明，是 `errors[]` 之外唯一的可读信息，前端要拿它 toast。
 *
 * 两条实现上的约定：
 *
 * - **成功侧**由 `ResponseEnvelopeInterceptor` 包（`APP_INTERCEPTOR`）。
 * - **失败侧**由 `AppExceptionFilter` 产出（`APP_FILTER`），HTTP 状态码由它按异常设置。
 *   handler 抛异常时成功信封根本不参与，所以永远不会出现"既带 data 又带 error"的响应。
 */

/** 成功响应体：`{ success: true, data, meta? }`。 */
export interface SuccessBody<T> {
  success: true;
  data: T;
  /** 附加元信息；目前只有分页结果会带（由 `buildPaginatedResult()` 标记后提到顶层）。 */
  meta?: unknown;
}

/** 失败响应体：`{ success: false, error, message, errors? }`，与 `AppExceptionFilter` 的产出逐字对齐。 */
export interface ErrorBody {
  success: false;
  /** HTTP 状态短语（`node:http` 的 `STATUS_CODES`，如 `Bad Request`）。 */
  error: string;
  /** 人类可读说明（校验失败时是固定概述，细节在 `errors[]`）。 */
  message: string;
  /** 字段级明细，只有校验类错误才有。 */
  errors?: ErrorDetail[];
}

/**
 * 前端只需要记住这一个类型：`ResponseBody<User>` 在 `success === true` 时 `data` 就是 `User`。
 *
 * 它是**可判别联合**（`success` 是字面量类型），所以 `if (body.success)` 之后 TS 自动给出 `data`，
 * 否则自动给出 `error` / `message` / `errors`。
 */
export type ResponseBody<T = unknown> = SuccessBody<T> | ErrorBody;

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
