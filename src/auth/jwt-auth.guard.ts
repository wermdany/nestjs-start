import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { setRequestUserId } from '@/contract';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { UnauthenticatedException } from './exceptions';
import { isJwtPayload, JWT_PAYLOAD_PROP } from './jwt-payload';
import type { AuthenticatedRequest, JwtPayload } from './jwt-payload';

/**
 * `Authorization: Bearer <token>`（RFC 6750 §2.1）。
 *
 * scheme 按 RFC 7235 是**大小写不敏感**的，所以用 `i`；
 * token 用 `\S+`：含空格的凭证本身就不合法，不如在解析处就拒掉。
 */
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * 从 `Authorization` 头里取 Bearer token；不是 Bearer / 为空时返回 `undefined`。
 *
 * 单独导出是为了可测：解析规则（大小写、多余空格、数组头）值得有自己的用例。
 */
export function extractBearerToken(
  value: string | string[] | undefined,
): string | undefined {
  // Express 对重复的 `Authorization` 头会给出数组；取第一个（HTTP 上它本就该唯一）。
  const header = Array.isArray(value) ? value[0] : value;

  return header?.match(BEARER_PATTERN)?.[1];
}

/**
 * **认证守卫**：`@Public()` 放行 → 解析 Bearer → 验签 → 挂 `req.user`。
 *
 * ## 它是全局的，而且是 fail-closed
 *
 * 注册为 `APP_GUARD`（`AuthModule` 里），所以**新加的路由自动受保护**；
 * 免认证必须写 `@Public()`。于是"忘了想鉴权"的后果是 401（不可用，立刻被发现），
 * 而不是"悄悄对全世界开放"（不可见，直到出事）。
 *
 * ## 它为什么抛出而不是返回 `false`
 *
 * 返回 `false` 时 Nest 只会回 `{ statusCode, message, error }`，那会破坏本仓库的
 * 失败信封（`code` / `traceId` 都没了）。官方文档对此的说法也是"想要不同响应就抛异常"。
 *
 * ## 它不查用户表
 *
 * 只验签 + 检查载荷形状。这样每次请求都是纯计算（没有 I/O），
 * 代价是"用户被删/被禁用后 token 仍然有效直到过期" —— 真实系统靠短有效期 +
 * 刷新令牌解决（见 `docs/authentication.md` 的升级路径）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthenticatedException('invalid_request');
    }

    let payload: unknown;

    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    } catch {
      // 过期、签名不对、结构损坏都走到这里，**统一**给 invalid_token：
      // 不把库的错误细节回给客户端（也就不用回答"这个 token 是不是过期了"）。
      throw new UnauthenticatedException('invalid_token');
    }

    if (!isJwtPayload(payload)) {
      throw new UnauthenticatedException('invalid_token');
    }

    this.attach(request, payload);

    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /**
   * 把载荷挂到请求对象上，并把 `sub` 写进请求级上下文。
   *
   * 写 `userId` 的好处是日志/审计能按人查（`traceId` + `userId` 在同一个
   * `AsyncLocalStorage` 里）；用户名与其它声明不进日志 —— 它们会变，
   * 而且容易诱导出"按声明过滤日志"这种错误的排查方式。
   */
  private attach(request: AuthenticatedRequest, payload: JwtPayload): void {
    request[JWT_PAYLOAD_PROP] = payload;
    setRequestUserId(payload.sub);
  }
}
