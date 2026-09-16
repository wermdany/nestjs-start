import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  BAD_REQUEST_EXAMPLE,
  CONFLICT_EXAMPLE,
  ERROR_ENVELOPE_REF,
  INTERNAL_EXAMPLE,
  NOT_FOUND_EXAMPLE,
} from './envelope.schema';

/** 失败响应：`allOf: [ErrorEnvelope]` + 一个可复制的示例（示例集中定义在 `envelope.schema.ts`）。 */
const errorResponse = (
  description: string,
  example: Record<string, unknown>,
): { description: string; schema: Record<string, unknown> } => ({
  description,
  schema: { allOf: [{ $ref: ERROR_ENVELOPE_REF }], example },
});

/**
 * 把**失败响应**挂到控制器上：类级装饰器，一次覆盖该控制器的所有路由。
 *
 * 为什么能在类级生效（`@nestjs/swagger` 的实测行为，见 docs/validation.md §9.7）：
 * `SwaggerExplorer.exploreGlobalMetadata()` 会在**类级**调用
 * `exploreGlobalApiResponseMetadata()`，它读到的响应会被 merge 进该控制器每条路由的操作对象。
 * 所以 400/404/500 只写一次，不必在 12 条路由上重复。
 *
 * ⚠️ 一个必须知道的边界：**方法级**的 `@ApiResponse` 一旦存在，
 * `exploreApiResponseMetadata()` 会**直接返回、不再与类级合并**。
 * 所以每条路由的具体成功响应写在方法上（用 `api-envelope.decorator.ts` 的薄封装），
 * 失败响应留在类上 —— 两者不会互相吞掉。
 */
export const ApiEnvelopeErrors = (): ClassDecorator & MethodDecorator =>
  applyDecorators(
    ApiResponse({
      status: 400,
      ...errorResponse(
        '入参校验失败（`errors[]` 里是字段级明细）',
        BAD_REQUEST_EXAMPLE,
      ),
    }),
    ApiResponse({
      status: 404,
      ...errorResponse('资源或路由不存在', NOT_FOUND_EXAMPLE),
    }),
    ApiResponse({
      status: 500,
      ...errorResponse(
        '未捕获的内部错误（细节只进日志，不进响应）',
        INTERNAL_EXAMPLE,
      ),
    }),
  );

/** 该路由可能因为业务冲突返回 409（例如邮箱已存在）时挂上。 */
export const ApiEnvelopeConflict = (): MethodDecorator =>
  ApiResponse({
    status: 409,
    ...errorResponse('业务冲突', CONFLICT_EXAMPLE),
  });
