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
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}
