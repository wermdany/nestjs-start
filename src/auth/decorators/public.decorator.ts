import { SetMetadata } from '@nestjs/common';

/** 「这条路由不需要认证」的元数据 key（认证守卫用 `Reflector` 读）。 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * 把一条路由（或整个控制器）标记为**公开**。
 *
 * 全局认证守卫是 **fail-closed** 的：默认所有路由都要凭证，公开必须**显式声明**。
 * 所以"新加一个控制器、忘了想鉴权"的后果是 401（立刻可见），而不是静默对外开放。
 *
 * 读取用 `Reflector.getAllAndOverride`（方法级优先于类级），
 * 所以"整个控制器公开、但某条路由要凭证"可以靠方法级元数据覆盖。
 *
 * ⚠️ 它只声明元数据、不做任何判断；真正的放行发生在 `JwtAuthGuard` 里。
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
