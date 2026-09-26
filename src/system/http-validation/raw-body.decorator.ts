import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

interface RequestWithBody {
  body: unknown;
}

/**
 * 和 `@Body()` 一样从 `req.body` 取值，但**不经过校验管道**，参数级生效。
 *
 * 原理：自定义参数装饰器产出的 `ArgumentMetadata.type` 是 `'custom'`
 * （`@nestjs/core` 的 `ParamsTokenFactory` 对 BODY/QUERY/PARAM 之外一律返回 `'custom'`），
 * 而 `ValidationPipe.toValidate()` 里有一句：
 *
 * ```js
 * if (type === 'custom' && !this.validateCustomDecorators) {
 *   return false;
 * }
 * ```
 *
 * `validateCustomDecorators` 默认就是 `false`，所以这个参数被原样放行。
 * 反过来说：一旦 `ApiContractModule.forRoot({ validateCustomDecorators: true })`，
 * `@RawBody()` 就又会开始校验 —— 这条由 `validation-demo.e2e-spec.ts` 里的
 * `webhooks/raw-body` 用例钉住。
 *
 * ## 为什么是「参数级」而不是在 DTO 类上打标记
 *
 * 管道唯一能读到的锚点是 `metadata.metatype`（也就是 DTO 类），所以"豁免"这件事
 * 如果做成打在 DTO 类上的标记，就会变成**类型级**开关：该类型在**所有**路由都不校验，
 * 而且管道没有 `ExecutionContext`，没有任何"这次例外"的表达空间 —— 想恢复校验
 * 只能再定义一个同形状的 DTO。挂在参数上就没有这个问题：
 * 同一个 DTO，这条路用 `@Body()` 校验、那条路用 `@RawBody()` 放行。
 *
 * ## 注意
 *
 * 跳过的是**整个管道**，不只是校验：值不会被转成 DTO 实例，
 * `@Type()` 转换和字段默认值都不会发生，handler 拿到的是原始 plain object。
 */
export const RawBody = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown =>
    ctx.switchToHttp().getRequest<RequestWithBody>().body,
);
