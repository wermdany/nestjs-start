import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '@/contract';

/**
 * 业务异常：把每个业务错误的 **code + 文案 + HTTP 状态码**集中一处。
 *
 * 做成具名类而不是在 service 里随手 `new ConflictException(...)` 的好处：
 * 抛出点自解释、三者集中一处、以后要给某个错误单独加行为（附加字段、不同的状态码）有地方可加。
 *
 * 继承 `ApiException` 之后，失败信封里会多一个**机器可读的 `code`**：
 *
 * ```json
 * { "success": false, "error": "Conflict", "code": "EMAIL_ALREADY_EXISTS",
 *   "message": "email neo@example.com already exists", "traceId": "…" }
 * ```
 *
 * 于是前端 `switch (body.code)` 就能区分"邮箱重复"和"其它冲突"，
 * **不需要 parse `message` 文案** —— 文案可以随时改、可以 i18n，`code` 不能。
 * 数字状态码仍然只活在 HTTP 状态行里（见 `docs/validation.md` §9.2）。
 */

export class EmailAlreadyExistsException extends ApiException {
  constructor(email: string) {
    super(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      `email ${email} already exists`,
      HttpStatus.CONFLICT,
    );
  }
}

export class UserNotFoundException extends ApiException {
  constructor(id: number) {
    super(
      ErrorCode.USER_NOT_FOUND,
      `user ${id} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
