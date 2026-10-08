import type { LogLevel, LoggerService } from '@nestjs/common';
import { getRequestContext } from '@/system/request-context';
import { RotatingLogFileWriter } from './log-file.writer';
import { buildLogLine, isLevelEnabled, serializeLine } from './log-line';

export interface AppLoggerFileOptions {
  dir: string;
  file: string;
  maxBytes: number;
  maxFiles: number;
}

export interface AppLoggerOptions {
  /** 输出阈值：低于它的级别直接丢弃。 */
  level: LogLevel;
  /** 仅影响 stdout；**文件里永远是单行 JSON**。 */
  pretty: boolean;
  /** 不传就只写 stdout。 */
  file?: AppLoggerFileOptions;
  /** 输出函数（测试注入用）。默认写 `process.stdout` / `process.stderr`。 */
  write?: {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  };
  onProblem?: (message: string) => void;
  now?: () => Date;
}

/**
 * 本仓库的全局 logger（实现 Nest 的 `LoggerService`）。
 *
 * 它同时写两处：
 *
 * - **stdout / stderr**：给人看（dev 是一行摘要，prod 是 JSON）；
 * - **本地文件**（可选）：给机器看，NDJSON、按大小/跨天滚动。
 *
 * 每行自动带上 `traceId` 与 `userId`（来自 `AsyncLocalStorage`）——
 * 所以**调用点不需要自己拼任何上下文**：`logger.log('user created', { userId })`
 * 就能和响应里的 `traceId` 对上。
 *
 * ⚠️ 输出是**同步返回、异步落盘**（`LoggerService` 的方法签名是同步的）。
 * 需要"确已落盘"时显式 `await logger.flush()`（测试、优雅退出）。
 */
export class AppLogger implements LoggerService {
  private readonly writer?: RotatingLogFileWriter;
  private readonly out: (text: string) => void;
  private readonly err: (text: string) => void;

  constructor(private readonly options: AppLoggerOptions) {
    this.out =
      options.write?.stdout ?? ((text) => process.stdout.write(`${text}\n`));
    this.err =
      options.write?.stderr ?? ((text) => process.stderr.write(`${text}\n`));

    if (options.file) {
      this.writer = new RotatingLogFileWriter({
        ...options.file,
        onProblem: options.onProblem,
      });
    }
  }

  /** 活动日志文件路径（未启用文件日志时为 `undefined`）。 */
  get filePath(): string | undefined {
    return this.writer?.filePath;
  }

  /** 文件日志是否已降级（写不进去，只剩 stdout）。 */
  get isFileDegraded(): boolean {
    return this.writer?.isDegraded ?? false;
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  /**
   * `Logger.overrideLogger()` 会调它。
   *
   * 这里**刻意什么都不做**：级别由 `LOG_LEVEL` 配置决定，是"部署时定的"，
   * 不该被框架在启动过程中的某次调用改掉。
   */
  setLogLevels(): void {
    // no-op：见上面的注释
  }

  /** 等所有已排队的写入落盘。 */
  async flush(): Promise<void> {
    await this.writer?.flush();
  }

  /** flush + 关闭文件流（由 `OnApplicationShutdown` 调用）。 */
  async close(): Promise<void> {
    await this.writer?.close();
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (!isLevelEnabled(level, this.options.level)) {
      return;
    }

    const { context, stack, fields } = parseParams(message, params);
    const line = buildLogLine({
      level,
      message,
      context,
      stack,
      request: getRequestContext(),
      fields,
      now: this.options.now?.(),
    });

    (level === 'error' || level === 'fatal' ? this.err : this.out)(
      serializeLine(line, this.options.pretty),
    );

    if (this.writer) {
      // `pretty` 只作用于终端：文件里永远是 NDJSON。
      void this.writer.append(JSON.stringify(line));
    }
  }
}

/**
 * 从 Nest 传进来的参数里认出三样东西。
 *
 * Nest 的 `Logger` 在委托给自定义实现时，会把**实例的 context 追加为最后一个参数**
 * （见 `@nestjs/common` 的 `logger.service.js`：`optionalParams.concat(this.context)`），
 * 所以"最后一个字符串参数 = context"是可靠的。
 *
 * 另外两类：堆栈（字符串且含帧）与结构化字段（第一个普通对象）。
 */
export function parseParams(
  message: unknown,
  params: unknown[],
): { context?: string; stack?: string; fields?: Record<string, unknown> } {
  let context: string | undefined;
  let stack: string | undefined;
  let fields: Record<string, unknown> | undefined;

  for (const param of params) {
    if (param === undefined || param === null) {
      continue;
    }

    if (param instanceof Error) {
      stack ??= param.stack;

      continue;
    }

    if (typeof param === 'string') {
      if (param.includes('\n    at ')) {
        stack ??= param;

        continue;
      }

      context = param;

      continue;
    }

    if (typeof param === 'object' && !fields) {
      fields = param as Record<string, unknown>;
    }
  }

  if (message instanceof Error) {
    stack ??= message.stack;
  }

  return { context, stack, fields };
}
