import { SetMetadata } from '@nestjs/common';

/** `@NoEnvelope()` 写入的元数据键。 */
export const NO_ENVELOPE_METADATA = '__noEnvelope__';

/**
 * 让这条路由（或整个控制器）**跳过响应信封**，原样返回 handler 的返回值。
 *
 * 需要它的场景：返回的文件流、第三方回调探测、必须保持裸形状的兼容接口。
 * 刻意做成显式装饰器而不是"自动识别某些类型"—— 隐式规则会在升级时静默改变 wire 形状。
 *
 * 一个反例：handler 里有 `@Res()`（没有 `passthrough`）时，Nest 本来就会丢弃返回值，
 * 加不加这个装饰器都一样 —— 那种情况属于"不在 Nest 管理范围内"，见 `docs/validation.md` §9。
 *
 * @example
 * ```ts
 * @Get('legacy')
 * @NoEnvelope()
 * legacy() {
 *   return { old: 'shape' };
 * }
 * ```
 */
export const NoEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(NO_ENVELOPE_METADATA, true);
