import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';
import { safeStringify } from './log-line';

/**
 * 把 NDJSON 日志写进本地文件，并在**大小**或**跨天**时滚动。
 *
 * 四条刻意的设计：
 *
 * 1. **串行写入**（promise 链）：滚动与写入不会交错，`flush()` 也能被 await
 *    （测试与优雅退出都要它）。代价是高并发下会排队 —— 本仓库量级无碍。
 * 2. **完全不抛**：写不进去（权限 / 磁盘满 / 目录建不出来）就**降级为只写 stdout**，
 *    并回调一次 `onProblem`。"日志写不了盘"不该让服务起不来。
 * 3. **不逐行 fsync**：性能优先；`kill -9` 可能丢最后几条，正常退出由 `close()` 收尾。
 * 4. **滚动文件名带在扩展名前**（`app.log` → `app.1.log`）：这样它仍然匹配
 *    `.gitignore` 里已有的 `*.log`，不会一不小心被提交。
 */

export interface LogFileWriterOptions {
  dir: string;
  file: string;
  /** 单文件上限（字节）；`0` 表示不按大小滚动（仍会跨天滚动）。 */
  maxBytes: number;
  /** 保留的历史文件数（不含活动文件）；`0` 表示滚动时直接丢弃旧内容。 */
  maxFiles: number;
  /** 降级 / 异常时的回调（默认打到 stderr）。 */
  onProblem?: (message: string) => void;
  /** 注入时钟，便于测试"跨天滚动"。 */
  now?: () => Date;
}

export class RotatingLogFileWriter {
  private stream?: WriteStream;
  /** 串行链：所有写入按顺序排队，`flush()` 就是 await 它。 */
  private chain: Promise<void> = Promise.resolve();
  private opening?: Promise<void>;
  private size = 0;
  private day = '';
  /** 是否已开始关闭：**只影响"还接不接受新行"**，不影响已排队行的写入。 */
  private closing = false;
  private degraded = false;
  /** 让"卡住的写入"在降级时立刻失败，避免 flush 永远等下去。 */
  private pendingReject?: (error: unknown) => void;

  constructor(private readonly options: LogFileWriterOptions) {}

  get filePath(): string {
    return join(this.options.dir, this.options.file);
  }

  get isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * 追加一行（自动补换行）。返回的 promise 在该行**写完**后 resolve。
   *
   * ⚠️ `close()` 之后调用是 **no-op**（不再接受新行）—— 但已经排队进来的行一定会写完，
   * 哪怕 `close()` 已经开始等（这是"优雅退出不丢最后一条日志"的关键）。
   */
  append(line: string): Promise<void> {
    if (this.closing || this.degraded) {
      return Promise.resolve();
    }

    const text = line.endsWith('\n') ? line : `${line}\n`;

    this.chain = this.chain.then(() => this.writeOnce(text));

    return this.chain;
  }

  /** 等所有已排队的写入落盘（不关闭流）。 */
  flush(): Promise<void> {
    return this.chain;
  }

  /** 收尾：等排队写完 + 关闭流。交给 `OnApplicationShutdown` 调。 */
  async close(): Promise<void> {
    // 只置"不再接受新行"，**不**跳过已排队的写入 —— 否则最后一条（往往正是
    // "shutting down" 那条）会被静默丢掉。
    this.closing = true;

    await this.chain;
    await this.endStream();
  }

  private writeOnce(text: string): Promise<void> {
    if (this.degraded) {
      return Promise.resolve();
    }

    return this.ensureOpen()
      .then(() => this.rotateIfNeeded(Buffer.byteLength(text)))
      .then(() => this.write(text))
      .catch((error: unknown) => {
        this.degrade(error);
      });
  }

  private ensureOpen(): Promise<void> {
    // `open()` 自己全是同步 I/O（mkdir/stat/createWriteStream），
    // 包一层 Promise 只是为了让调用链统一 `await`。
    this.opening ??= Promise.resolve().then(() => this.open());

    return this.opening;
  }

  private open(): void {
    try {
      mkdirSync(this.options.dir, { recursive: true });

      const path = this.filePath;

      // 进程重启后接着写：从已有文件的真实大小继续，滚动才不会"重置"。
      this.size = existsSync(path) ? statSync(path).size : 0;
      this.day = this.today();
      this.stream = this.openStream(path);
    } catch (error) {
      this.degrade(error);
    }
  }

  private openStream(path: string): WriteStream {
    const stream = createWriteStream(path, { flags: 'a' });

    stream.on('error', (error: unknown) => {
      this.degrade(error);
    });

    return stream;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    if (!this.stream) {
      return;
    }

    const crossedDay = this.today() !== this.day;
    const tooBig =
      this.options.maxBytes > 0 &&
      this.size + incomingBytes > this.options.maxBytes;

    if (!crossedDay && !tooBig) {
      return;
    }

    await this.rotate();
  }

  private async rotate(): Promise<void> {
    await this.endStream();

    const { dir, file, maxFiles } = this.options;
    const active = this.filePath;

    try {
      if (maxFiles <= 0) {
        if (existsSync(active)) {
          rmSync(active);
        }
      } else {
        // 从最老的开始往后挪：app.{n}.log → 删；app.{n-1}.log → app.{n}.log …
        const oldest = join(dir, withIndex(file, maxFiles));

        if (existsSync(oldest)) {
          rmSync(oldest);
        }

        for (let index = maxFiles - 1; index >= 1; index -= 1) {
          const from = join(dir, withIndex(file, index));

          if (existsSync(from)) {
            renameSync(from, join(dir, withIndex(file, index + 1)));
          }
        }

        if (existsSync(active)) {
          renameSync(active, join(dir, withIndex(file, 1)));
        }
      }

      this.size = 0;
      this.day = this.today();
      this.stream = this.openStream(active);
    } catch (error) {
      this.degrade(error);
    }
  }

  private write(text: string): Promise<void> {
    const stream = this.stream;

    if (!stream) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingReject = reject;

      stream.write(text, (error) => {
        this.pendingReject = undefined;

        if (error) {
          reject(error);

          return;
        }

        this.size += Buffer.byteLength(text);
        resolve();
      });
    });
  }

  private endStream(): Promise<void> {
    const stream = this.stream;

    this.stream = undefined;

    if (!stream) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  }

  /** 按 UTC 日期判定（与日志行的 ISO 时间戳同一套基准）。 */
  private today(): string {
    return (this.options.now?.() ?? new Date()).toISOString().slice(0, 10);
  }

  private degrade(error: unknown): void {
    if (this.degraded) {
      return;
    }

    this.degraded = true;

    const reason =
      error instanceof Error ? error.message : safeStringify(error, 200);
    const report =
      this.options.onProblem ??
      ((message: string) => process.stderr.write(`${message}\n`));

    // 挂住的写入必须立刻失败，否则 flush/close 会永远等下去。
    this.pendingReject?.(error);
    this.pendingReject = undefined;

    report(`[logging] 文件日志已停用（${reason}）；后续只写 stdout`);

    void this.endStream();
  }
}

/** `app.log` + 1 → `app.1.log`（保留扩展名，所以仍然匹配 `.gitignore` 的 `*.log`）。 */
export function withIndex(file: string, index: number): string {
  const dot = file.lastIndexOf('.');

  return dot <= 0
    ? `${file}.${index}`
    : `${file.slice(0, dot)}.${index}${file.slice(dot)}`;
}
