import { ApiProperty } from '@nestjs/swagger';

/**
 * `POST /validation-demo/webhooks/body` 的响应 `data`：**经过校验的**载荷回显。
 *
 * 为什么单独定义响应模型：控制器里 return 的是内联对象字面量（`{ received: payload }`），
 * OpenAPI 需要一个类才能给出 `$ref` 与字段说明 —— 否则文档里 `data` 只能是空对象。
 */
export class ReceivedCheckedBodyDto {
  @ApiProperty({
    description: '经过校验管道处理后的载荷（未声明字段已被 whitelist 剥掉）',
    type: 'object',
    additionalProperties: true,
  })
  received: Record<string, unknown>;
}

/** `POST /validation-demo/webhooks/raw-body` 的响应 `data`：`@RawBody()` 原样回显。 */
export class ReceivedRawBodyDto {
  @ApiProperty({
    description:
      '`@RawBody()` 原样回显的载荷 —— 跳过整个管道，未声明字段**也会**保留',
    type: 'object',
    additionalProperties: true,
  })
  received: Record<string, unknown>;
}

/** `POST /validation-demo/webhooks/plain` 的响应 `data`：会被剥成空对象。 */
export class ReceivedPlainBodyDto {
  @ApiProperty({
    description:
      '`PlainWebhookDto` 一个校验装饰器都没有 ⇒ 每个字段都算未声明 ⇒ 被 whitelist 剥成 `{}`',
    type: 'object',
    additionalProperties: false,
    example: {},
  })
  received: Record<string, never>;
}

/** `POST /validation-demo/pipe-order/ids` 的响应 `data`。 */
export class IdsDto {
  @ApiProperty({
    description: '被局部 `ParseArrayPipe({ items: Number })` 转换后的数字数组',
    type: [Number],
    example: [1, 2],
  })
  ids: number[];
}

/** `POST /validation-demo/pipe-order/strict` 的响应 `data`。 */
export class StrictProbeResultDto {
  @ApiProperty({
    description:
      '局部 `ValidationPipe` 配了 422，但全局管道先跑 ⇒ 非法 body 仍然是 400',
    type: 'object',
    additionalProperties: true,
  })
  received: Record<string, unknown>;

  @ApiProperty({
    description: '固定说明文案',
    example: 'global pipe runs first, see docs/validation.md',
  })
  note: string;
}
