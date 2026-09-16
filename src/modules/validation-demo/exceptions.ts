import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * 业务异常：集中定义每个业务错误的**文案**。
 *
 * 做成具名类而不是在 service 里随手 `new ConflictException(...)` 的好处：
 * 抛出点自解释、文案集中一处、以后要给某个错误单独加行为（附加字段、
 * 不同的状态码、或引入机器可读的错误码）有地方可加。
 *
 * ⚠️ 当前契约**没有**机器可读的 `code`，所以前端区分"邮箱重复"和"其它冲突"只能靠
 * `message` 文案（数字状态码只在 HTTP 状态行里）。见 `docs/validation.md` §9.4。
 */

export class EmailAlreadyExistsException extends ConflictException {
  constructor(email: string) {
    super(`email ${email} already exists`);
  }
}

export class UserNotFoundException extends NotFoundException {
  constructor(id: number) {
    super(`user ${id} not found`);
  }
}
