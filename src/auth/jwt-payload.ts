/**
 * JWT 的载荷：**只有身份**。
 *
 * 刻意不含 `roles` / `permissions` / `scope`：本模块只回答"你是谁"，
 * 不做"你能不能"。要加权限是另一件事（见 `docs/authentication.md` 的升级路径），
 * 而一旦放进去，每个 token 的权限就冻结在签发那一刻 —— 那是需要单独设计的取舍。
 */
export interface JwtPayload {
  /** 主体（用户）id —— JWT 的注册声明 `sub`，`jsonwebtoken` 约定为字符串。 */
  sub: string;
  /** 用户名：进日志与界面时不必再查一次用户表。 */
  username: string;
  /** 签发时间（由库自动写入）。 */
  iat?: number;
  /** 过期时间（由库自动写入）。 */
  exp?: number;
}

/**
 * 载荷挂在请求对象上的字段名。
 *
 * 用 **`user`** 而不是 `payload`：这是 Passport / `@nestjs/passport` 的既有约定，
 * 将来真的换成 Passport 时它填的是同一个槽位，业务代码不用改。
 */
export const JWT_PAYLOAD_PROP = 'user';

/**
 * 认证之后请求对象的最小形状。
 *
 * 用**局部接口**而不是 `declare global`：全局增强会和将来引入的
 * `@types/passport` 抢同一个 `user` 字段的类型，报错的地方离现场很远。
 */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  [JWT_PAYLOAD_PROP]?: JwtPayload;
}

/**
 * 形状检查：**在把载荷挂到 `req.user` 之前**跑一次。
 *
 * 为什么需要它：`verifyAsync()` 只保证"这个 token 的签名是我签的"，**不保证**
 * "载荷长得像我以为的样子"（例如密钥被别处拿去签了另一种载荷）。
 * 不检查就把 `unknown` 当 `JwtPayload` 用 —— 那是拿类型断言当安全边界。
 */
export function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { sub, username } = value as Record<string, unknown>;

  return (
    typeof sub === 'string' &&
    sub.length > 0 &&
    typeof username === 'string' &&
    username.length > 0
  );
}

/** 从请求对象上取载荷；未认证、或字段形状不对时返回 `undefined`。 */
export function getJwtPayload(request: unknown): JwtPayload | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }

  const candidate = (request as Record<string, unknown>)[JWT_PAYLOAD_PROP];

  return isJwtPayload(candidate) ? candidate : undefined;
}

/**
 * 从一个**已解码**的载荷里读出有效期秒数（`exp - iat`）。
 *
 * 为什么用 `exp - iat` 而不是把配置传进 service：token 本来就是自描述的 ——
 * 读出来的值一定等于客户端手里那个 token 的真实寿命，不会和配置漂移。
 * 读不出来（没有 `exp` / `iat`）时返回 `undefined`，由调用方决定怎么表达"不知道"。
 */
export function lifetimeSecondsOf(decoded: unknown): number | undefined {
  if (typeof decoded !== 'object' || decoded === null) {
    return undefined;
  }

  const { iat, exp } = decoded as { iat?: unknown; exp?: unknown };

  if (typeof iat !== 'number' || typeof exp !== 'number') {
    return undefined;
  }

  const seconds = exp - iat;

  return seconds > 0 ? seconds : undefined;
}
