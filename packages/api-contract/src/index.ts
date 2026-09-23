/**
 * `nestjs-start` 的**线上契约（wire contract）**：成功 / 失败响应体、分页元信息、错误码。
 *
 * 这个包刻意**只有类型、没有任何运行时导出**（没有类、没有 `enum`、没有 `const`）：
 *
 * 1. 服务端可以把它当**类型来源**用，编译后 import 会被完全擦除 ——
 *    所以 `dist/` 里不会残留对它的引用，`pnpm start:prod` 不需要先构建它；
 * 2. 前端 / BFF / 其它语言的手写 SDK 可以照这份定义对齐，不必反向阅读 Nest 代码；
 * 3. 契约改了，两边**同时**编译失败，而不是等到线上发现字段对不上。
 *
 * ⚠️ 一旦往这里加入任何**运行时值**（`enum`、`const`、类），第 1 条立刻失效，
 * 服务端就必须先构建本包再启动。要加值对象请放在服务端的 `src/contract/` 里
 * （例如 `ErrorCode` 的值对象在 `src/contract/validation/error-code.ts`，
 * 并有编译期断言保证它覆盖下面这个联合类型的每一个成员）。
 */

// ── 错误码 ────────────────────────────────────────────────────────────────────

/**
 * 机器可读的错误码。
 *
 * 为什么不是 HTTP 状态码：数字状态码属于 HTTP 层（`res.status` 就有），
 * 这里要回答的是"**为什么**失败"，那是状态码回答不了的
 * （409 可能是邮箱重复，也可能是别的冲突）。
 *
 * 为什么不用 class-validator 的约束名（`isInt` / `min`）当 code：
 * 那是**库的实现细节**，换到 Zod / 自研校验就全变了。下面的取值是按**语义**分的，
 * 换库只需要改映射表（`VALIDATION_CONSTRAINT_CODES`）。
 *
 * ⚠️ 这些字符串是**对外契约**：可以新增，不能改名（改名等于破坏性变更）。
 */
export type ErrorCode =
  /** 顶层：入参校验失败（明细在 `errors[]`）。 */
  | 'VALIDATION_FAILED'
  /** 顶层：业务冲突（demo：邮箱已存在）。 */
  | 'EMAIL_ALREADY_EXISTS'
  /** 顶层：资源不存在（demo：用户不存在）。 */
  | 'USER_NOT_FOUND'
  /** 顶层：未捕获的内部错误（细节只进日志）。 */
  | 'INTERNAL_ERROR'
  /**
   * 顶层：**未认证**（HTTP 401）—— 缺凭证、头格式不对、凭证无效或已过期。
   *
   * 命名对齐 AIP-193 的 `UNAUTHENTICATED`（"你是谁"）。
   * 本仓库当前只做到认证，没有授权层，所以没有 `PERMISSION_DENIED`（403）这个成员；
   * 将来加角色/权限时再按同样的方式新增（`code` 可以新增、不能改名）。
   */
  | 'UNAUTHENTICATED'
  // ── 下面是**字段级** code（`errors[].code`），按校验语义划分 ──
  /** 必填但没有值（`@IsDefined` / `@IsNotEmpty`）。 */
  | 'REQUIRED'
  /** 类型不对（`@IsString` / `@IsInt` / `@IsArray` ...）。 */
  | 'INVALID_TYPE'
  /** 格式不对（`@IsEmail` / `@Matches` ...）。 */
  | 'INVALID_FORMAT'
  /** 长度不在允许区间（`@Length`）。 */
  | 'INVALID_LENGTH'
  /** 数值超出允许区间（`@Min` / `@Max`）。 */
  | 'OUT_OF_RANGE'
  /** 取值不在白名单（`@IsIn` / `@IsEnum`）。 */
  | 'NOT_ALLOWED_VALUE'
  /** 命中了保留字（自定义校验器 `@IsNotReservedName`）。 */
  | 'RESERVED_NAME'
  /** 元素个数超限（`@ArrayMaxSize` / `@ArrayMinSize`）。 */
  | 'TOO_MANY_ITEMS'
  /** DTO 上没有声明这个字段（`forbidNonWhitelisted: true` 时由 `whitelistValidation` 报出）。 */
  | 'UNKNOWN_FIELD'
  /** 未映射到已知语义的约束（兜底，出现它说明该补映射表了）。 */
  | 'UNKNOWN_CONSTRAINT';

// ── 失败响应 ──────────────────────────────────────────────────────────────────

/** `errors[]` 里字段路径的来源位置。同名不同源时（例如 body 和 param 都有 `id`）靠它区分。 */
export type ErrorLocation = 'body' | 'query' | 'param';

/**
 * 字段级明细。失败响应（由 `AppExceptionFilter` 产出）里 `errors[]` 的元素：
 *
 * ```json
 * {
 *   "success": false, "error": "Bad Request", "code": "VALIDATION_FAILED",
 *   "message": "Request validation failed", "traceId": "0f3c...",
 *   "errors": [
 *     { "field": "address.city", "location": "body", "code": "INVALID_LENGTH",
 *       "message": "city must be longer than or equal to 2 characters" }
 *   ]
 * }
 * ```
 *
 * | 字段 | 给谁用 |
 * | --- | --- |
 * | `field` | **权威定位**（嵌套用点号：`address.city`） |
 * | `location` | 这个路径来自 body / query / param（框架内建管道抛的错可能没有） |
 * | `code` | 机器判据（前端 `switch`，不要去 parse `message`） |
 * | `message` | 终端用户（可 i18n、可改文案） |
 */
export interface ErrorDetail {
  field: string;
  message: string;
  location?: ErrorLocation;
  code?: ErrorCode;
}

/**
 * 失败响应体：`{ success: false, error, message, code?, traceId?, errors? }`。
 *
 * `code` / `errors` 是**可选**的：框架自身抛的错（未匹配路由的 404 等）没有业务语义，
 * 硬塞一个由状态码推导出来的 code 只会把"状态码只在状态行"这条设计又破坏掉。
 * `traceId` 在真实 HTTP 请求里恒有（请求 id 中间件保证），单元测试里可能缺席。
 */
export interface ErrorBody {
  success: false;
  /** HTTP 状态短语（如 `Bad Request`）—— 无需查表的人话标识。 */
  error: string;
  message: string;
  code?: ErrorCode;
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
 * 前端只需要记住这一个类型：`success` 是字面量类型 ⇒ `if (body.success)` 之后 TS 自动收窄。
 *
 * ```ts
 * if (!body.success) { toast(body.message); switch (body.code) { ... } return; }
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
