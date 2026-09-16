import { ApiResponse } from '@nestjs/swagger';
import { buildEnvelopeSchema } from './envelope.schema';
import type { WrappedData } from './envelope.schema';

/**
 * 成功响应的**薄封装**：控制器里只写一行，信封 / `$ref` / 状态码的拼装全在这里。
 *
 * 为什么值得包一层（参考社区主流做法，底层用的是 Nest 官方文档推荐的
 * `getSchemaPath()` + `refs()` 泛型响应写法）：
 *
 * - 信封是**跨全站同一个**结构，不该出现在每个路由里 —— 否则控制器会被
 *   `allOf` / `$ref` / 内联 `example` 淹没，业务语义被文档噪音盖住；
 * - 示例下沉到 DTO 字段上的 `@ApiProperty`，控制器不再抄一遍（那也是最容易漂移的部分）。
 *
 * 用法：
 *
 * ```ts
 * @ApiOkEnvelope(UserDto, '查询成功')                 // data 是单个对象
 * @ApiOkEnvelope([UserDto], '分页成功（data 是数组）') // data 是数组
 * @ApiCreatedEnvelope('null', '没有返回值时 data 为 null')
 * ```
 */
export const ApiOkEnvelope = (
  data: WrappedData,
  description: string,
): MethodDecorator =>
  ApiResponse({ status: 200, description, schema: buildEnvelopeSchema(data) });

/** 201 版本，语义与 {@link ApiOkEnvelope} 完全相同。 */
export const ApiCreatedEnvelope = (
  data: WrappedData,
  description: string,
): MethodDecorator =>
  ApiResponse({ status: 201, description, schema: buildEnvelopeSchema(data) });
