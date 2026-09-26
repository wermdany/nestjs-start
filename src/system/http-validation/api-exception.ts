import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './error-code';

/**
 * 业务异常的基类：把「**机器可读的 code** + 给人看的 message + HTTP 状态码」绑在一处。
 *
 * ```ts
 * export class EmailAlreadyExistsException extends ApiException {
 *   constructor(email: string) {
 *     super(ErrorCode.EMAIL_ALREADY_EXISTS, `email ${email} already exists`, HttpStatus.CONFLICT);
 *   }
 * }
 * ```
 *
 * 为什么载荷写成 `{ code, message }` 对象而不是字符串：`AppExceptionFilter` 会把对象载荷里的
 * `code` 透出到失败信封，于是前端可以 `switch (body.code)`，**不需要 parse `message` 文案**。
 * 一旦客户端开始依赖文案，文案就变成事实上的契约、以后改一个字都是破坏性变更
 * （AIP-193 对此有明确警告）。
 *
 * 失败的 HTTP 状态码仍然只由状态行表达（`super(..., status)`），body 里不放数字状态码 ——
 * 与 `docs/validation.md` §9.2 的分工一致。
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
   * ⚠️ 头与响应体一样是对外可见的：**不要**放凭证、内部路径或策略细节。
   */
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super({ code, message }, status);
  }
}
