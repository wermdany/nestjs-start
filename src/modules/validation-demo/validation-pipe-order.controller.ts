import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  ParseArrayPipe,
  Post,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createValidationPipe } from '@/contract';
import { ApiOkEnvelope } from '@/swagger/api-envelope.decorator';
import { ApiCreatedEnvelope } from '@/swagger/api-envelope.decorator';
import { ApiEnvelopeErrors } from '@/swagger/api-errors.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { IdsDto, StrictProbeResultDto } from './dto/webhook-response.dto';

/**
 * 「全局 + 局部」两级管道的可观测证据。
 *
 * 管道的执行顺序是 `[...global, ...class, ...method, ...param]` 再按 `reduce` 串联，
 * 所以全局管道**永远第一个跑**，局部管道只能看到它放行之后的值。
 *
 * 失败响应由类级 `@ApiEnvelopeErrors()` 统一声明（见 `validation-demo.controller.ts` 的注释）。
 */
@ApiTags('validation-demo')
@ApiEnvelopeErrors()
@Controller('validation-demo/pipe-order')
export class ValidationPipeOrderController {
  /**
   * 局部管道**真正生效**的场景。
   *
   * `@Body() ids: number[]` 的 metatype 是内置类型 `Array`，而
   * `ValidationPipe.toValidate()` 会跳过 `[String, Boolean, Number, Array, Object, Buffer, Date]`，
   * 所以全局管道根本不管它 —— 正好交给这个方法级管道。
   * `["1", "2"]` → `[1, 2]`；`["a"]` → 400。
   */
  @Post('ids')
  @UsePipes(new ParseArrayPipe({ items: Number }))
  @ApiOperation({
    summary: '局部 ParseArrayPipe 生效（全局管道跳过内置类型 Array）',
    description:
      '请求体是 JSON 数组：`["1","2"]` → `{ ids: [1,2] }`；`["a"]` → 400。',
  })
  @ApiCreatedEnvelope(IdsDto, '转换成功')
  parseIds(@Body() ids: number[]) {
    return { ids };
  }

  /**
   * 故意保留的**反例**：给 DTO 参数再挂一个「错误码 422」的 ValidationPipe。
   *
   * 非法 body 时全局管道已经先抛 **400** 了，这个方法级配置永远不会被触发；
   * 合法 body 时全局的 `whitelist` 也已经把未声明字段剥掉了。
   * 也就是说：对 DTO 参数，局部 `ValidationPipe` 既不能放松也不能加严。
   * 想知道能不能绕过校验，走 `POST /validation-demo/webhooks/raw-body`。
   */
  @Post('strict')
  @UsePipes(
    createValidationPipe({
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  @ApiOperation({
    summary: '反例：局部管道配 422 也没用（全局管道先跑）',
    description:
      '非法 body 仍然是 **400**，不是 422 —— 全局管道的 400 先抛出了。',
  })
  @ApiCreatedEnvelope(StrictProbeResultDto, '合法 body 原样回显')
  strictOverride(@Body() dto: CreateUserDto) {
    return {
      received: dto,
      note: 'global pipe runs first, see docs/validation.md',
    };
  }

  /**
   * **不是**本仓库校验管道抛的异常长什么样。
   *
   * Nest 内建 / 第三方管道与守卫的**传统载荷**是 `{ statusCode, message: string[], error }`
   * —— `message` 是**字符串数组**。`AppExceptionFilter` 会把它规范化成：
   *
   * ```json
   * { "success": false, "error": "Bad Request",
   *   "message": "title must be a string",              // 兜底成第一条明细
   *   "errors": [ { "field": "(request)", "message": "title must be a string" },
   *               { "field": "(request)", "message": "title too long" } ],
   *   "traceId": "…" }                                   // 注意：没有 code（来源没有语义）
   * ```
   *
   * 没有这一层规范化的话，`message` 会退化成状态短语 `"Bad Request"`、`errors` 整个消失。
   */
  @Get('array-message')
  @ApiOperation({
    summary: '反例：数组型 message 的异常也会被规范化进 errors[]',
    description:
      '抛 `new BadRequestException([...])`（Nest 内建管道的传统形状），观察 `errors[]` 不丢明细。',
  })
  @ApiOkEnvelope('null', '永远不会成功 —— 这里只是把失败形状做成活文档')
  arrayMessage(): never {
    throw new BadRequestException(['title must be a string', 'title too long']);
  }
}
