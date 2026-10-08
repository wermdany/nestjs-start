/**
 * `nestjs-start` 的**线上契约（wire contract）**：成功 / 失败响应体、分页元信息、错误明细。
 *
 * ## 为什么这个模块是**零依赖叶子**
 *
 * 它只有类型，加一个纯常量与它的守卫函数 —— **不 import 任何东西**。
 * 于是它可以被任何层引用而不产生方向问题（`docs/architecture-review.md` §7 的层级表）：
 *
 * ```
 * http-contract ─┬─> http-response
 *                └─> http-validation ──> pagination
 * ```
 *
 * ⚠️ **不要**往这里加任何需要注入 / 需要 Nest 容器的东西。它一旦有依赖，
 * 上游所有模块都会被动获得那个依赖。
 *
 * ## 与旧 `packages/api-contract` 的关系
 *
 * 这里原本是一个 pnpm workspace 包（前后端共享）。项目改为纯后端后，
 * 包被内联回本文件 —— 形状定义与它的消费者重新在一起，少了一层
 * 「类型定义在别处、服务端 re-export」的间接。
 */

// ── 错误定位 ──────────────────────────────────────────────────────────────────

/** `errors[].location` 里字段路径的来源。同名不同源时（例如 body 和 param 都有 `id`）靠它区分。 */
export type ErrorLocation = 'body' | 'query' | 'param';

/** `errors[].location` 的合法取值（顺序即文档里的顺序）。 */
export const ERROR_LOCATIONS = ['body', 'query', 'param'] as const;

/**
 * 判断一个运行时值是不是合法的 `location`。
 *
 * 需要它是因为**跨信任边界**：异常载荷可能来自第三方管道 / 守卫 / 库，
 * 里面的 `location` 不能直接信。
 * `@nestjs/common` 的 `ArgumentMetadata.type` 还多一个 `'custom'`，那个不算 location。
 */
export function isErrorLocation(value: unknown): value is ErrorLocation {
  return (
    typeof value === 'string' &&
    (ERROR_LOCATIONS as readonly string[]).includes(value)
  );
}

// ── 失败响应 ──────────────────────────────────────────────────────────────────

/**
 * 字段级明细。失败响应（由 `AppExceptionFilter` 产出）里 `errors[]` 的元素：
 *
 * ```json
 * {
 *   "success": false, "error": "Bad Request",
 *   "message": "Request validation failed", "traceId": "0f3c...",
 *   "errors": [
 *     { "field": "address.city", "location": "body",
 *       "message": "city must be longer than or equal to 2 characters" }
 *   ]
 * }
 * ```
 *
 * | 字段 | 给谁用 |
 * | --- | --- |
 * | `field` | **权威定位**（嵌套用点号：`address.city`） |
 * | `location` | 这个路径来自 body / query / param（框架内建管道抛的错可能没有） |
 * | `message` | 终端用户（可 i18n、可改文案） |
 */
export interface ErrorDetail {
  field: string;
  message: string;
  location?: ErrorLocation;
}

/**
 * 失败响应体：`{ success: false, error, message, traceId?, errors? }`。
 *
 * ## 为什么**没有** `code`（刻意的取舍）
 *
 * 这里原本有一个机器可读的 `code`（如 `USER_NOT_FOUND` / `VALIDATION_FAILED`）。
 * 已删除，于是失败响应的**大类判据只有 `error`**（HTTP 状态短语）。
 *
 * ⚠️ **代价必须知道**：同一个状态码下的不同失败原因不再可机器区分。例如
 * 「用户不存在」（业务 404）与「路由未匹配」（框架 404）现在的响应体
 * **结构完全相同**，只剩 `message` 文案不同 —— 而客户端 parse 文案是
 * 本仓库一直警告的反模式（文案可改、可 i18n）。
 * 若将来需要恢复区分能力，加回的是 `code` 这个字段，**不要**靠约定 message 前缀。
 *
 * ## 为什么也**没有** `statusCode`
 *
 * 数字状态码只由 HTTP 状态行表达（过滤器调 `response.status(...)`），
 * 在 body 里冗余一份只多一个"和状态行漂移"的隐患。
 *
 * `errors` / `traceId` 是**可选**的：框架自身抛的错（未匹配路由的 404 等）没有字段级明细；
 * `traceId` 在真实 HTTP 请求里恒有（请求 id 中间件保证）。
 */
export interface ErrorBody {
  success: false;
  /** HTTP 状态短语（如 `Bad Request`）—— 失败响应的**唯一**大类判据。 */
  error: string;
  message: string;
  /** 把这次响应和日志对上的请求 id（同时回写在 `x-request-id` 响应头）。 */
  traceId?: string;
  errors?: ErrorDetail[];
}

// ── 成功响应 ──────────────────────────────────────────────────────────────────

/** 成功响应体：`{ success: true, data, meta? }`。 */
export interface SuccessBody<T> {
  success: true;
  /** handler 的返回值；分页时是**这一页的数据数组**。 */
  data: T;
  /** 附加元信息；目前只有分页结果会带（由 `buildPaginatedResult()` 标记后提到顶层）。 */
  meta?: unknown;
}

/**
 * 只需要记住这一个类型：`success` 是字面量类型 ⇒ `if (body.success)` 之后 TS 自动收窄。
 *
 * ```ts
 * if (!body.success) { toast(body.message); return; }
 * use(body.data);
 * ```
 */
export type ResponseBody<T = unknown> = SuccessBody<T> | ErrorBody;

// ── 分页 ──────────────────────────────────────────────────────────────────────

/**
 * 分页元信息。只保留三个**服务端才知道**的数（命名对齐 nestjs-paginate / JSON:API 风格）。
 *
 * 刻意不算 `totalPages`：它是 `Math.ceil(totalItems / itemsPerPage)`，客户端一行就能算；
 * 服务端多传一个可推导字段只多一个"和另外两个不一致"的地方。
 */
export interface PaginationMeta {
  /** 过滤之后的总条数（不是这一页的长度）。 */
  totalItems: number;
  /** 这一页的页大小（已按服务端上限截断）。 */
  itemsPerPage: number;
  /** 当前页码，从 1 开始。 */
  currentPage: number;
}

/** 列表接口的统一响应形状（`ResponseEnvelopeInterceptor` 会把它提到信封顶层）。 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}
