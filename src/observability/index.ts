/**
 * 可观测性模块（`src/observability/`）的**对外门面**。
 *
 * 与 `src/system/http-validation/index.ts`、`src/config/index.ts` 同一套规矩：
 * 模块内部互相引用走**具体文件**，门面只做**显式具名导出**、不用 `export *`。
 *
 * 三层能力：
 *
 * 1. **接线**：`LoggingModule` / `installLogger()` / `uninstallLogger()`；
 * 2. **运行时**：`AppLogger`（实现 `LoggerService`）+ `RequestLogMiddleware`（访问日志）；
 * 3. **可测的纯函数**：`buildLogLine` / `safeStringify` / `isLevelEnabled` / `RotatingLogFileWriter`。
 */

// ── 接线 ─────────────────────────────────────────────────────────────────────
export { LoggingModule } from './logging.module';
export {
  getInstalledLogger,
  installLogger,
  uninstallLogger,
} from './install-logger';

// ── 运行时 ───────────────────────────────────────────────────────────────────
export { AppLogger, parseParams } from './app-logger';
export type { AppLoggerFileOptions, AppLoggerOptions } from './app-logger';
export { RequestLogMiddleware } from './request-log.middleware';

// ── 纯函数与写入器（测试、以及需要自己拼行的场景） ────────────────────────────
export {
  buildLogLine,
  isLevelEnabled,
  LOG_LEVEL_ORDER,
  MAX_STACK_LENGTH,
  MAX_VALUE_LENGTH,
  REDACTED,
  safeStringify,
  sanitizeField,
  SENSITIVE_KEY,
  serializeLine,
  stringifyValue,
} from './log-line';
export type { LogLine, LogLineInput } from './log-line';
export { RotatingLogFileWriter, withIndex } from './log-file.writer';
export type { LogFileWriterOptions } from './log-file.writer';
