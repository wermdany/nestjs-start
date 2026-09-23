import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  BAD_REQUEST_EXAMPLE,
  CONFLICT_EXAMPLE,
  ERROR_ENVELOPE_REF,
  INTERNAL_EXAMPLE,
  NOT_FOUND_EXAMPLE,
  UNAUTHENTICATED_EXAMPLE,
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

/**
 * **未认证**的失败响应：401（含 `WWW-Authenticate` 响应头）。
 *
 * ## 为什么**不**并进 `ApiEnvelopeErrors()`
 *
 * 认证是**全局**的，但"这条路由到底会不会 401"取决于它是不是 `@Public()`：
 * 公开路由不可能 401，把它声明上去就是文档撒谎。而这个仓库对文档的态度是
 * "键集一个不多一个不少"，所以 401 由**需要认证的控制器**自己挂。
 *
 * 代价写清楚：每加一个非公开控制器就要记得挂它一次，忘了不会报错
 * （`docs/learning-next.md` 里那条"每条路由都必须声明失败响应"的通用守卫是它的解法，
 * 属于后续迭代）。这是"文档精确"与"不会被忘记"之间的取舍，这里选了前者。
 *
 * ⚠️ **粒度是控制器**：如果一个控制器里既有公开路由、又有受保护路由，
 * 公开的那条会跟着多声明 401。`AuthController` 恰好是这种情况，但**它不是过度声明**：
 * `/auth/login` 本身在凭证不对时就返回 401 —— 声明是准确的。
 */
export const ApiEnvelopeUnauthorized = (): ClassDecorator & MethodDecorator =>
  ApiResponse({
    status: 401,
    ...errorResponse(
      '未认证：缺少凭证、`Authorization` 不是 Bearer、凭证无效或已过期（响应头带 `WWW-Authenticate`）',
      UNAUTHENTICATED_EXAMPLE,
    ),
  });
