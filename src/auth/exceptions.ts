import { HttpStatus } from '@nestjs/common';
import { ApiException, ErrorCode } from '@/contract';

/** `WWW-Authenticate` 里的 realm —— 只是给客户端一个可读的"这是哪个保护空间"。 */
export const BEARER_REALM = 'nestjs-start';

/**
 * RFC 6750 §3.1 的两个认证失败原因：
 *
 * - `invalid_request`：请求本身不合格（没带 `Authorization`、不是 Bearer、token 为空）；
 * - `invalid_token`：带了凭证，但它无效（过期、签名不对、结构损坏、载荷形状不对）。
 *
 * 分开的价值在于客户端能区分"我该去拿凭证"和"我该换凭证"。
 */
export type UnauthenticatedReason = 'invalid_request' | 'invalid_token';

const UNAUTHENTICATED_MESSAGE: Readonly<Record<UnauthenticatedReason, string>> =
  {
    invalid_request: 'Missing or malformed credentials',
    invalid_token: 'Invalid credentials',
  };

/**
 * 守卫用：**401 + `WWW-Authenticate`**。
 *
 * 为什么不用框架的 `UnauthorizedException`：它的载荷是
 * `{ statusCode, message, error }`，没有机器可读的 `code`，前端只能 parse 文案 ——
 * 那正是本仓库契约要避免的（文案可改、可 i18n，`code` 不能）。
 *
 * `reason` 同时进 `WWW-Authenticate` 头的 `error` 属性（RFC 6750）：
 * 头属于 HTTP 层，不往 body 里塞额外字段。
 */
export class UnauthenticatedException extends ApiException {
  constructor(reason: UnauthenticatedReason = 'invalid_request') {
    super(
      ErrorCode.UNAUTHENTICATED,
      UNAUTHENTICATED_MESSAGE[reason],
      HttpStatus.UNAUTHORIZED,
      {
        'WWW-Authenticate': `Bearer realm="${BEARER_REALM}", error="${reason}"`,
      },
    );
  }
}

/**
 * 登录失败：**401，但刻意不带 `WWW-Authenticate`**。
 *
 * 那个头是"访问受保护资源"的响应语义（告诉客户端怎么带凭证）；
 * 登录接口的 401 是"你给的凭证不对"，带上它只会误导客户端去重试同一个 token 流程。
 *
 * 文案对"用户不存在"与"密码不对"**完全一致**，见 `AuthService.login()`。
 */
export class InvalidCredentialsException extends ApiException {
  constructor() {
    super(
      ErrorCode.UNAUTHENTICATED,
      'Invalid username or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
