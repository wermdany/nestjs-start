/**
 * 平台层（`src/platform/`）的**对外门面**。
 *
 * 与 `src/config/index.ts`、`src/swagger/` 同一套规矩：内部互相引用走具体文件
 * （`platform.module.ts` 里写 `./platform.options` 而不是 `@/platform`），
 * 门面只做**显式具名导出**，不用 `export *`。
 */

export { PlatformModule } from './platform.module';

export {
  CORS_EXPOSED_HEADERS,
  isWildcardOrigin,
  PLATFORM_OPTIONS,
  platformOptionsFactory,
  resolvePlatformOptions,
  THROTTLE_ERROR_MESSAGE,
  throttlerOptionsFactory,
  toCorsOptions,
  toThrottlerOptions,
} from './platform.options';
export type { PlatformAsyncOptions, PlatformOptions } from './platform.options';
