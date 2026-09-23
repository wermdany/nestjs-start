import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkEnvelope } from '@/swagger/api-envelope.decorator';
import {
  ApiEnvelopeErrors,
  ApiEnvelopeUnauthorized,
} from '@/swagger/api-errors.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { ProfileDto } from './dto/profile.dto';
import type { JwtPayload } from './jwt-payload';

/**
 * 认证接口：一条**公开**的登录 + 一条**受保护**的身份查询。
 *
 * | 路由 | 声明 | 谁能过 | 失败 |
 * | --- | --- | --- | --- |
 * | `POST /auth/login` | `@Public()` | 任何人（凭用户名密码换 token） | 401 凭证不对 / 400 参数不合法 |
 * | `GET /auth/profile` | 靠全局守卫 | 任何持有有效 token 的人 | 401 缺凭证 / 无效 / 过期 |
 *
 * 三条刻意的对照：
 *
 * 1. **控制器上没有 `@UseGuards`**：守卫是全局的（`AuthModule` 的 `APP_GUARD`），
 *    所以"新加路由忘了挂守卫"这个失效模式不存在 —— 反过来，公开要显式写 `@Public()`；
 * 2. **登录也是 `@Public()`，但它仍然会 401**：`@Public()` 说的是"不要求**已有**凭证"，
 *    不是说"永远成功"；
 * 3. **`profile` 不查存储**：它回显的就是 token 里的身份 —— JWT 是自描述的，
 *    验签由守卫完成，token 有效本身就证明了这些声明是可信的。
 *
 * 失败响应分两处声明：400/404/500 在类级（`@ApiEnvelopeErrors`），
 * 401 在 `@ApiEnvelopeUnauthorized` —— 后者不并进前者，因为公开控制器
 * （`validation-demo`）根本不可能 401，文档不该撒谎（见该装饰器的注释）。
 */
@ApiTags('auth')
@ApiEnvelopeErrors()
@ApiEnvelopeUnauthorized()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  // 登录是"读"语义：POST 默认的 201 会让人误以为创建了资源。
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '登录并签发 JWT',
    description:
      '库里的演示账号：`neo` / `matrix`、`trinity` / `zion`。' +
      '用户名去空格并转小写，**密码不做任何处理**（首尾空格是密码的一部分）。' +
      '凭证不对时统一返回 401 与同一句文案 —— 不区分"用户不存在"和"密码错"，避免用户名枚举。',
  })
  @ApiOkEnvelope(LoginResponseDto, '登录成功')
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.auth.login(dto);
  }

  @Get('profile')
  @ApiOperation({
    summary: '当前身份（需要 Bearer token）',
    description:
      '把 token 里的声明原样回显：`sub` + `username`。不含角色 / 权限 —— ' +
      '本模块只回答"你是谁"，不回答"你能不能"。',
  })
  @ApiOkEnvelope(ProfileDto, 'token 有效')
  profile(@CurrentUser() payload: JwtPayload): ProfileDto {
    return { sub: payload.sub, username: payload.username };
  }
}
