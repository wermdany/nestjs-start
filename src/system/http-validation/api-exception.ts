import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常的基类：把「给人看的 message + HTTP 状态码」绑在一处，并**可选地携带响应头**。
 *
 * ```ts
 * export class EmailAlreadyExistsException extends ApiException {
 *   constructor(email: string) {
 *     super(`email ${email} already exists`, HttpStatus.CONFLICT);
 *   }
 * }
 * ```
 *
 * ## 为什么载荷是 `{ message }` 对象而不是裸字符串
 *
 * `AppExceptionFilter` 读的是对象载荷：它能从 `errors` 取字段级明细、
 * 从 `message` 取概述。传裸字符串那条路径也支持（过滤器会用状态短语兜底），
 * 但对象形态让"概述 + 明细"能一起表达，语义更完整。
 *
 * ## 为什么**没有** `code`（刻意的取舍）
 *
 * 本类原本的第一个参数是 `code: ErrorCode`，它会被过滤器透出到失败信封，
 * 于是客户端能 `switch (body.code)` 而不必 parse `message` 文案。
 * 该字段已删除 —— 失败响应的大类判据改为 `error`（HTTP 状态短语）。
 *
 * ⚠️ 代价：同一状态码下的不同业务原因不再可机器区分（详见 `ErrorBody` 的注释）。
 * 这里保留的是**文案集中一处**这个好处：每个业务错误仍然有具名类，
 * 抛出点自解释，文案与状态码只定义一次。
 *
 * 失败的 HTTP 状态码仍然只由状态行表达（`super(..., status)`），
 * body 里不放数字状态码 —— 与 `docs/validation.md` §9.2 的分工一致。
 */
export class ApiException extends HttpException {
  /**
   * 需要额外写出的**响应头**（可选），目前只有一个消费者：401 的 `WWW-Authenticate`。
   *
   * 为什么头要挂在异常上：`HttpExceptionOptions` 只有 `cause` / `description`
   * （见 `@nestjs/common` 的 `http.exception.d.ts`），框架**没有**"由异常设置响应头"
   * 的入口。而 RFC 6750 要求 401 带 `WWW-Authenticate`，否则客户端不知道该怎么带凭证；
   * 由 `AppExceptionFilter` 统一写出是唯一不改契约形状的做法
   * （头属于 HTTP 层，body 里不重复表达）。
   *
   * ⚠️ `headers` 是 `code` 被删除后**唯一**无法用 message 替代的能力 ——
   * 它是 HTTP 层的语义，不是业务区分。**不要**顺手删掉这个参数。
   *
   * ⚠️ 头与响应体一样是对外可见的：**不要**放凭证、内部路径或策略细节。
   */
  constructor(
    message: string,
    status: HttpStatus,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super({ message }, status);
  }
}
