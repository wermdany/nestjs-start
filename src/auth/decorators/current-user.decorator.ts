import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { getJwtPayload } from '../jwt-payload';
import type { JwtPayload } from '../jwt-payload';

/**
 * 取当前请求的身份载荷：
 *
 * ```ts
 * @Get('profile')
 * profile(@CurrentUser() me: JwtPayload) { … }          // 整个载荷
 * @Get('profile')
 * profile(@CurrentUser('sub') sub: string) { … }        // 按字段取
 * ```
 *
 * 为什么用参数装饰器而不是在 handler 里读 `req.user`：业务方法只表达"我需要谁"，
 * 不碰请求对象（更可测、更少平台耦合）；类型收窄集中在一处。
 *
 * ⚠️ 它**不做认证**：`@Public()` 路由上取值是 `undefined` ——
 * 所以字段选择器的参数类型要写成 `string | undefined` 才诚实（类型系统并不知道
 * "这条路由没有 @Public()"，保证值存在的是守卫）。
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, context: ExecutionContext) => {
    const payload = getJwtPayload(context.switchToHttp().getRequest());

    return data ? payload?.[data] : payload;
  },
);
