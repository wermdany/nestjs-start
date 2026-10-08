import { HttpStatus } from '@nestjs/common';
import { ApiException } from '@/system/http-validation';

/**
 * 业务异常：把每个业务错误的 **文案 + HTTP 状态码**集中一处。
 *
 * 做成具名类而不是在 service 里随手 `new ConflictException(...)` 的好处：
 * 抛出点自解释、两者集中一处、以后要给某个错误单独加行为（附加字段、不同的状态码）有地方可加。
 *
 * 继承 `ApiException` 之后，失败信封里的形状是：
 *
 * ```json
 * { "success": false, "error": "Conflict",
 *   "message": "email neo@example.com already exists", "traceId": "…" }
 * ```
 *
 * ⚠️ 注意**没有** `code`：本仓库已刻意移除它，于是「邮箱重复」与「其它冲突」
 * 都只能靠 `error`（都是 `Conflict`）或 `message` 文案区分。
 * 这是已知取舍，见 `ErrorBody` 的注释与 `docs/validation.md` §9.6。
 * 数字状态码仍然只活在 HTTP 状态行里（见 `docs/validation.md` §9.2）。
 */

export class EmailAlreadyExistsException extends ApiException {
  constructor(email: string) {
    super(`email ${email} already exists`, HttpStatus.CONFLICT);
  }
}

export class UserNotFoundException extends ApiException {
  constructor(id: number) {
    super(`user ${id} not found`, HttpStatus.NOT_FOUND);
  }
}
