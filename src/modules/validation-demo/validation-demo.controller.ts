import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth';
import { RawBody } from '@/contract';
import {
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '@/swagger/api-envelope.decorator';
import {
  ApiEnvelopeConflict,
  ApiEnvelopeErrors,
} from '@/swagger/api-errors.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { PlainWebhookDto } from './dto/plain-webhook.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { WebhookDto } from './dto/webhook.dto';
import {
  ReceivedCheckedBodyDto,
  ReceivedPlainBodyDto,
  ReceivedRawBodyDto,
} from './dto/webhook-response.dto';
import { UserDto } from './user.dto';
import { ValidationDemoService } from './validation-demo.service';

/**
 * 这个控制器**没有任何** `@UsePipes`：所有校验都来自
 * `ApiContractModule.forRoot()` 注册的全局 `APP_PIPE`。
 *
 * Swagger 上的三条约定（见 docs/validation.md §9.7）：
 *
 * 1. **失败响应在类上**：`@ApiEnvelopeErrors()` 一次挂 400/404/500；
 * 2. **成功响应一行**：`@ApiOkEnvelope(dto, '…')` / `@ApiCreatedEnvelope(dto, '…')` ——
 *    信封、`$ref`、状态码的拼装都在 `src/swagger/`，控制器里不出现 `allOf` / `$ref` / 内联示例；
 * 3. **入参 schema 全自动**：`nest-cli.json` 里的 CLI 插件把 class-validator 装饰器与注释
 *    直接推导成 `minLength` / `format` / `description`，所以这里没有任何 `@ApiQuery` / `@ApiBody`。
 *
 * 一个必须知道的边界：方法级 `@ApiResponse` 一旦存在，`@nestjs/swagger` 就**不再合并类级失败响应**。
 * 所以别把 400 之类也写到方法上，否则那条路由会丢掉类级的全部失败响应。
 *
 * 认证：本控制器**整体 `@Public()`** —— 它是参数校验 / 响应契约的演练场，
 * 演示的是"入参怎么被校验、失败长什么样"，加一层认证只会挡住读者。
 *
 * ⚠️ 公开是**显式声明**，不是默认：全局认证守卫（`AuthModule` 的 `JwtAuthGuard`）
 * 是 fail-closed 的，不写这一行的话所有路由都会 401。需要认证的路由请放在别的控制器里
 * （见 `src/auth/auth.controller.ts` 的 `/auth/profile`），**不要**在这里去掉 `@Public()`
 * 再逐条加凭证 —— 那会让这个 demo 的用途变得含糊。
 */
@Public()
@ApiTags('validation-demo')
@ApiEnvelopeErrors()
@Controller('validation-demo')
export class ValidationDemoController {
  constructor(private readonly users: ValidationDemoService) {}

  @Post('users')
  @ApiOperation({ summary: '创建用户（body 走全局校验管道）' })
  @ApiCreatedEnvelope(UserDto, '创建成功')
  @ApiEnvelopeConflict()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get('users')
  @ApiOperation({
    summary: '分页查询用户',
    description:
      '分页元信息在信封顶层的 `meta`（不是 `data.meta`）：`totalItems` / `itemsPerPage` / `currentPage`。',
  })
  @ApiOkEnvelope([UserDto], '分页成功（`data` 是这一页的数据数组）')
  findAll(@Query() query: QueryUsersDto) {
    return this.users.findAll(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: '查询单个用户' })
  @ApiParam({ name: 'id', description: '用户 id，从 1 开始', example: 1 })
  @ApiOkEnvelope(UserDto, '查询成功')
  findOne(@Param() params: UserIdParamDto) {
    return this.users.findOne(params.id);
  }

  @Patch('users/:id')
  @ApiOperation({
    summary: '局部更新用户',
    description:
      '`UpdateUserDto` 由 `PartialType(CreateUserDto)` 生成：所有字段可选，但保留原校验规则。',
  })
  @ApiParam({ name: 'id', description: '用户 id', example: 1 })
  @ApiOkEnvelope(UserDto, '更新成功（只覆盖传入的字段）')
  @ApiEnvelopeConflict()
  update(@Param() params: UserIdParamDto, @Body() dto: UpdateUserDto) {
    return this.users.update(params.id, dto);
  }

  /**
   * 参数级豁免的对照组 · 上半：同一个 `WebhookDto` 走 `@Body()` ⇒ **默认校验**。
   * 缺必填字段会 400；多出来的未声明字段按当前默认配置被剥掉。
   */
  @Post('webhooks/body')
  @ApiOperation({ summary: 'webhook 对照 · @Body() 走默认校验' })
  @ApiCreatedEnvelope(ReceivedCheckedBodyDto, '校验通过并回显载荷')
  receiveCheckedPayload(@Body() payload: WebhookDto) {
    return { received: payload };
  }

  /**
   * 参数级豁免的对照组 · 下半：**同一个** `WebhookDto` 走 `@RawBody()` ⇒ 原样放行。
   *
   * 这就是「同一个 DTO，一条路由校验、一条不校验」——不需要复制 DTO，
   * 也不需要任何打在 DTO 类上的类型级标记。
   */
  @Post('webhooks/raw-body')
  @ApiOperation({
    summary: 'webhook 对照 · @RawBody() 参数级豁免',
    description:
      '同一个 `WebhookDto`，这条路跳过整个管道：未声明字段也会原样保留。',
  })
  @ApiCreatedEnvelope(ReceivedRawBodyDto, '原样回显（含未声明字段）')
  receiveRawBodyPayload(@RawBody() payload: WebhookDto) {
    return { received: payload };
  }

  /** DTO 上一个校验装饰器都没有 ⇒ 每个字段都算「未声明字段」⇒ 被 whitelist 剥成空对象。 */
  @Post('webhooks/plain')
  @ApiOperation({
    summary: 'webhook 对照 · 无装饰器的 DTO 会被剥成空对象',
    description:
      '开 `forbidNonWhitelisted` 时同样请求会变成 400（见 `docs/validation.md` §4.4）。',
  })
  @ApiCreatedEnvelope(ReceivedPlainBodyDto, '载荷被 whitelist 剥空')
  receivePlainPayload(@Body() payload: PlainWebhookDto) {
    return { received: payload };
  }

  /**
   * 刻意**不** `return` 任何东西的 handler，用来钉住"成功信封的形状不取决于 handler 写了什么"。
   *
   * 没有信封时它是个**空响应体**（`express-adapter` 的 `reply()` 遇到 `isNil` 会 `send()` 空体），
   * 前端连 `Content-Type` 都拿不到。挂了响应信封之后是
   * HTTP 201 + `{ "success": true, "data": null }` —— 仍是契约里那一个形状。
   *
   * 真的需要空体的接口用 `@HttpCode(204)` + `@NoEnvelope()`：只有两个一起用才会 `send()` 空体，
   * 否则 204 也会带 `{"success":true,"data":null}` 这样的 body。
   */
  @Post('no-content')
  @ApiOperation({ summary: '没有 return 值的 handler 也走信封' })
  @ApiCreatedEnvelope('null', '没有返回值时 `data` 为 `null`（不是空响应体）')
  returnNothing(): void {
    return undefined;
  }
}
