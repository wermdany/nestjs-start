import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InvalidCredentialsException } from './exceptions';
import { lifetimeSecondsOf } from './jwt-payload';
import type { JwtPayload } from './jwt-payload';
import { UsersService } from './users.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';

/**
 * 登录：用户名 + 密码 → JWT。
 *
 * 它是本模块里**唯一**同时认识"用户表"和"签名服务"的地方：
 * 守卫只验签（不查库）、用户表只认用户、控制器只转协议。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 校验凭证并签发访问令牌。
   *
   * ## 为什么失败时只有一个分支
   *
   * "用户不存在"和"密码不对"抛**同一个**异常、给**同一句**文案：
   * 否则登录接口就成了用户名枚举器（攻击者靠响应差异就能判断哪些用户名存在）。
   * 这也是为什么这里没有 `findOrFail()` 之类的"更友好"的写法。
   *
   * ## 载荷里只有身份
   *
   * `{ sub, username }` —— 没有角色、没有权限、没有前端可读的额外信息。
   * token 是**自描述**的：客户端想知道什么时候过期，解 `exp` 即可。
   */
  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = this.users.findByUsername(dto.username);

    if (!user || !this.users.verifyPassword(user, dto.password)) {
      throw new InvalidCredentialsException();
    }

    const payload: JwtPayload = { sub: user.id, username: user.username };
    const accessToken = await this.jwt.signAsync(payload);

    // 有效期从**刚签发的这个 token** 里读（`exp - iat`），而不是从配置再算一遍 ——
    // 读出来的值一定等于客户端手里那个 token 的真实寿命，不会和配置漂移。
    const expiresIn = lifetimeSecondsOf(this.jwt.decode(accessToken));

    return {
      accessToken,
      tokenType: 'Bearer',
      ...(expiresIn === undefined ? {} : { expiresIn }),
    };
  }
}
