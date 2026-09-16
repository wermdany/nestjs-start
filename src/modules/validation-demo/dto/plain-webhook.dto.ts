/**
 * 故意写成「一个校验装饰器都没有」的类。
 *
 * 它演示两件事：
 *
 * 1. `whitelist` **不会**给无装饰器的类开绿灯 —— payload 里每个字段都算「未声明字段」，
 *    默认（`forbidNonWhitelisted: false`）下被静默剥成 `{}`；
 *    如果把 `forbidNonWhitelisted` 打开，同样请求会变成 400。
 * 2. 想把 payload 原样留下只能用 `@RawBody()`（参数级豁免），
 *    而且它不会让这个类型在别处也失去校验。
 *
 * 两种行为都由 `src/pipes/__tests__/validation-pipe.factory.spec.ts` 的单测覆盖。
 */
export class PlainWebhookDto {
  [key: string]: unknown;
}
