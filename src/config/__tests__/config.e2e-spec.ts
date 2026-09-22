import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AppConfigModule,
  describeConfig,
  EnvValidationError,
  formatConfigSummary,
  readAppConfig,
  readCorsConfig,
  readDatabaseConfig,
  readResolvedConfig,
  readSwaggerConfig,
  readThrottleConfig,
  redactUrl,
  resolveEnvFilePaths,
  shouldIgnoreEnvFile,
  validateEnv,
} from '@/config';
import { configWarnings } from '@/config';
import type { AppConfig } from '@/config';
import { AppModule, apiContractOptionsFactory } from '@/app.module';

/**
 * 配置契约测试。
 *
 * ⚠️ 文件名叫 `*.e2e-spec.ts` 是**被迫**的：仓库目前只有 e2e 配置
 * （`pnpm test:e2e` → `jest-e2e.json`，`testRegex: \.e2e-spec\.ts$`），没有单测配置。
 * 这里面大部分其实是**纯函数单测**（喂对象、断言、不碰 `process.env`）；
 * 等 P2 补上单测配置后应该改名成 `*.spec.ts`。
 *
 * 三条纪律：
 *
 * 1. **不改 `process.env`**：所有 `read*Config(env)` 都接受入参，测试直接喂对象
 *    —— 否则用例之间会通过全局状态互相影响（这正是本仓库 e2e 里被吐槽过的问题）；
 * 2. 断言**具体值**而不是"不抛"：默认值本身就是契约的一部分（端口 3000、poolSize 10…）；
 * 3. 失败的**问题清单**也要断言：那是这套配置体系对使用者最主要的输出。
 */

/** 一个"什么都没有"的环境。 */
const EMPTY_ENV = {};

/** 一个可用的 postgres 配置（离散字段形式）。 */
const POSTGRES_ENV = {
  DATABASE_DRIVER: 'postgres',
  DATABASE_HOST: 'db.internal',
  DATABASE_USER: 'app',
  DATABASE_NAME: 'appdb',
};

describe('validateEnv（启动即校验）', () => {
  it('空环境通过：一切都有默认值，不设任何变量也能启动', () => {
    expect(() => validateEnv(EMPTY_ENV)).not.toThrow();
  });

  it('PORT 非法 → 抛出 EnvValidationError，且**同一字段只报一条**', () => {
    for (const port of ['abc', '0', '70000']) {
      let caught: unknown;

      try {
        validateEnv({ PORT: port });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EnvValidationError);
      const problems = (caught as EnvValidationError).problems;
      // @IsInt / @Min / @Max 三条约束给的是同一句文案 ⇒ 去重后只剩一条
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('PORT');
      expect(problems[0]).toContain(`"${port}"`);
    }
  });

  it('一次列全所有问题（不是遇到第一个就停）', () => {
    expect.assertions(3);

    try {
      validateEnv({
        NODE_ENV: 'staging',
        DATABASE_POOL_SIZE: '999',
        DATABASE_SSL: 'yes',
      });
    } catch (error) {
      const problems = (error as EnvValidationError).problems;

      expect(problems).toHaveLength(3);
      expect(problems.join('\n')).toContain('NODE_ENV');
      expect(problems.join('\n')).toContain('DATABASE_POOL_SIZE');
    }
  });

  it('ENABLE_SWAGGER 的"含糊真值"被**容忍**（不报错，按没设处理）', () => {
    // 与 src/swagger/is-swagger-enabled.ts 的既有规则一致：'1' / 'yes' 不算显式开关。
    for (const flag of ['1', 'yes', 'TRUE', '']) {
      expect(() => validateEnv({ ENABLE_SWAGGER: flag })).not.toThrow();
    }
  });

  it('新布尔变量则是**严格**的：只认 true / false', () => {
    for (const value of ['yes', '1', 'TRUE']) {
      expect(() => validateEnv({ DATABASE_SSL: value })).toThrow(
        EnvValidationError,
      );
    }

    expect(() => validateEnv({ DATABASE_SSL: 'true' })).not.toThrow();
    expect(() => validateEnv({ DATABASE_SSL: 'false' })).not.toThrow();
  });

  it('非字符串输入被归一化（测试/程序化调用也能用）', () => {
    expect(() => validateEnv({ PORT: 4100 })).not.toThrow();
    expect(() => validateEnv({ PORT: 4100 })).not.toThrow();
  });

  describe('数据库：跨字段一致性', () => {
    it('driver=postgres 但缺 host / user / name → 一次列出三个缺失项', () => {
      expect.assertions(4);

      try {
        validateEnv({ DATABASE_DRIVER: 'postgres' });
      } catch (error) {
        const text = (error as EnvValidationError).problems.join('\n');

        expect(error).toBeInstanceOf(EnvValidationError);
        expect(text).toContain('DATABASE_HOST');
        expect(text).toContain('DATABASE_USER');
        expect(text).toContain('DATABASE_NAME');
      }
    });

    it('driver=postgres + 离散字段齐全 → 通过', () => {
      expect(() => validateEnv(POSTGRES_ENV)).not.toThrow();
    });

    it('driver=postgres + 只有 DATABASE_URL → 通过（url 优先，离散字段可缺席）', () => {
      expect(() =>
        validateEnv({
          DATABASE_DRIVER: 'postgres',
          DATABASE_URL: 'postgres://app:secret@db.internal:5432/appdb',
        }),
      ).not.toThrow();
    });

    it('driver=sqlite + 只有 DATABASE_NAME → 通过（不需要 host / user）', () => {
      expect(() =>
        validateEnv({ DATABASE_DRIVER: 'sqlite', DATABASE_NAME: './dev.db' }),
      ).not.toThrow();
    });

    it('driver 本身非法 → 报 driver，不再补一条误导性的"缺字段"', () => {
      expect.assertions(2);

      try {
        validateEnv({ DATABASE_DRIVER: 'oracle' });
      } catch (error) {
        const problems = (error as EnvValidationError).problems;

        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('DATABASE_DRIVER');
      }
    });

    it('生产环境禁止 DATABASE_SYNCHRONIZE=true', () => {
      expect(() =>
        validateEnv({ NODE_ENV: 'production', DATABASE_SYNCHRONIZE: 'true' }),
      ).toThrow(/SYNCHRONIZE/);

      // 非生产环境允许（本地开发用 synchronize 很常见）
      expect(() =>
        validateEnv({ NODE_ENV: 'development', DATABASE_SYNCHRONIZE: 'true' }),
      ).not.toThrow();
    });
  });
});

describe('configWarnings（只告警不拦截）', () => {
  it('生产环境：CORS 未设 / 为 * 、打开 SQL 日志、强开文档都会告警', () => {
    const warnings = configWarnings({
      NODE_ENV: 'production',
      ENABLE_SWAGGER: 'true',
      DATABASE_LOGGING: 'true',
    });

    expect(warnings.join('\n')).toContain('CORS_ORIGINS');
    expect(warnings.join('\n')).toContain('DATABASE_LOGGING');
    expect(warnings.join('\n')).toContain('ENABLE_SWAGGER');
  });

  it('生产环境给了具体来源 → 没有 CORS 告警', () => {
    const warnings = configWarnings({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com',
    });

    expect(warnings.join('\n')).not.toContain('CORS_ORIGINS');
  });

  it('死配置探测：driver=memory 却配了密码', () => {
    expect(
      configWarnings({ DATABASE_PASSWORD: 'secret' }).join('\n'),
    ).toContain('DATABASE_PASSWORD');

    expect(
      configWarnings({ ...POSTGRES_ENV, DATABASE_PASSWORD: 'secret' }),
    ).toHaveLength(0);
  });

  it('开发环境什么都不设 → 没有告警', () => {
    expect(configWarnings(EMPTY_ENV)).toEqual([]);
  });
});

describe('各 namespace 的读取（纯函数）', () => {
  it('app：默认 development / 3000 / 不限网卡 / 宽松校验 / 开信封', () => {
    expect(readAppConfig(EMPTY_ENV)).toEqual({
      env: 'development',
      port: 3000,
      host: undefined,
      strictValidation: false,
      envelope: true,
    });
  });

  it('app：契约层开关只认恰好 true / false', () => {
    expect(
      readAppConfig({ STRICT_VALIDATION: 'true', ENABLE_ENVELOPE: 'false' }),
    ).toMatchObject({ strictValidation: true, envelope: false });

    // 非法写法由 validateEnv 拦下，读取端只做兜底（回到默认值）
    expect(
      readAppConfig({ STRICT_VALIDATION: 'yes', ENABLE_ENVELOPE: '1' }),
    ).toMatchObject({ strictValidation: false, envelope: true });
  });

  it('app：PORT 是**数字**而不是字符串（配置文件里全是字符串，这里必须转掉）', () => {
    const app = readAppConfig({ PORT: '4100' });

    expect(app.port).toBe(4100);
    expect(typeof app.port).toBe('number');
  });

  it('app：HOST 留空视为未设（回到 Node 默认的"绑定全部网卡"）', () => {
    expect(readAppConfig({ HOST: '   ' }).host).toBeUndefined();
    expect(readAppConfig({ HOST: '127.0.0.1' }).host).toBe('127.0.0.1');
  });

  it('swagger：跟随 isSwaggerEnabled 的既有规则（4 种组合）', () => {
    expect(readSwaggerConfig(EMPTY_ENV).enabled).toBe(true);
    expect(readSwaggerConfig({ NODE_ENV: 'production' }).enabled).toBe(false);
    expect(
      readSwaggerConfig({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' })
        .enabled,
    ).toBe(true);
    expect(
      readSwaggerConfig({ NODE_ENV: 'development', ENABLE_SWAGGER: 'false' })
        .enabled,
    ).toBe(false);
  });

  it('swagger：serverUrl 有默认值，也可覆盖', () => {
    expect(readSwaggerConfig(EMPTY_ENV).serverUrl).toBe(
      'http://localhost:3000',
    );
    expect(
      readSwaggerConfig({ SWAGGER_SERVER_URL: 'https://api.example.com' })
        .serverUrl,
    ).toBe('https://api.example.com');
  });

  it('cors：默认 *，逗号分隔会被解析并去掉空项', () => {
    expect(readCorsConfig(EMPTY_ENV).origins).toEqual(['*']);
    expect(
      readCorsConfig({
        CORS_ORIGINS: ' https://a.example.com ,, https://b.example.com ,',
      }).origins,
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('throttle：默认 60s / 100 次', () => {
    expect(readThrottleConfig(EMPTY_ENV)).toEqual({
      ttlSeconds: 60,
      limit: 100,
    });
    expect(
      readThrottleConfig({ THROTTLE_TTL_SECONDS: '10', THROTTLE_LIMIT: '5' }),
    ).toEqual({ ttlSeconds: 10, limit: 5 });
  });

  describe('database（本次只预留，没有消费者）', () => {
    it('默认 memory：不设任何 DATABASE_* 也能启动', () => {
      expect(readDatabaseConfig(EMPTY_ENV)).toEqual({
        driver: 'memory',
        url: undefined,
        host: undefined,
        port: undefined,
        username: undefined,
        password: undefined,
        name: undefined,
        schema: undefined,
        ssl: false,
        poolSize: 10,
        logging: false,
        synchronize: false,
        migrationsRun: false,
      });
    });

    it('port 已按驱动补默认值（B1 不必再写一遍这个判断）', () => {
      expect(readDatabaseConfig(POSTGRES_ENV).port).toBe(5432);
      expect(
        readDatabaseConfig({ ...POSTGRES_ENV, DATABASE_DRIVER: 'mysql' }).port,
      ).toBe(3306);
      expect(
        readDatabaseConfig({
          DATABASE_DRIVER: 'sqlite',
          DATABASE_NAME: './dev.db',
        }).port,
      ).toBeUndefined();
    });

    it('DATABASE_PORT 覆盖驱动默认值', () => {
      expect(
        readDatabaseConfig({ ...POSTGRES_ENV, DATABASE_PORT: '5433' }).port,
      ).toBe(5433);
    });

    it('布尔与数字都转成了正确的类型', () => {
      const database = readDatabaseConfig({
        ...POSTGRES_ENV,
        DATABASE_SSL: 'true',
        DATABASE_LOGGING: 'true',
        DATABASE_SYNCHRONIZE: 'false',
        DATABASE_MIGRATIONS_RUN: 'true',
        DATABASE_POOL_SIZE: '25',
      });

      expect(database).toMatchObject({
        ssl: true,
        logging: true,
        synchronize: false,
        migrationsRun: true,
        poolSize: 25,
      });
    });

    it('driver 非法时读取端回退 memory（报错是校验端的职责）', () => {
      expect(readDatabaseConfig({ DATABASE_DRIVER: 'oracle' }).driver).toBe(
        'memory',
      );
    });
  });
});

describe('redactUrl / 启动摘要', () => {
  it('连接串里的用户名与密码被替换成 ***', () => {
    const redacted = redactUrl('postgres://app:s3cret@db.internal:5432/appdb');

    expect(redacted).not.toContain('s3cret');
    expect(redacted).toContain('db.internal');
    expect(redacted).toContain('appdb');
  });

  it('解析不了的值原样返回（脱敏工具不该成为新的失败点）', () => {
    expect(redactUrl('sqlite:./dev.db')).toBe('sqlite:./dev.db');
    expect(redactUrl('not a url at all')).toBe('not a url at all');
  });

  it('启动摘要**绝不包含密码**', () => {
    const summary = formatConfigSummary({
      app: readAppConfig(EMPTY_ENV),
      swagger: readSwaggerConfig(EMPTY_ENV),
      cors: readCorsConfig(EMPTY_ENV),
      throttle: readThrottleConfig(EMPTY_ENV),
      database: readDatabaseConfig({
        ...POSTGRES_ENV,
        DATABASE_PASSWORD: 's3cret',
        DATABASE_URL: 'postgres://app:s3cret@db.internal:5432/appdb',
      }),
    });

    expect(summary).not.toContain('s3cret');
    expect(summary).toContain('postgres@');
    expect(summary).toContain('port=3000');
  });

  it('还没有消费者的 namespace 被标成 (预留)', () => {
    const summary = formatConfigSummary({
      app: readAppConfig(EMPTY_ENV),
      swagger: readSwaggerConfig(EMPTY_ENV),
      cors: readCorsConfig(EMPTY_ENV),
      throttle: readThrottleConfig(EMPTY_ENV),
      database: readDatabaseConfig(EMPTY_ENV),
    });

    expect(summary).toContain('cors=*(预留)');
    expect(summary).toContain('throttle=60s/100(预留)');
    expect(summary).toContain('db=memory(预留)');
    // 已经接线的两项**不带**预留标记
    expect(summary).toContain('port=3000 ');
    expect(summary).toContain('swagger=on(http://localhost:3000)');
  });
});

describe('.env 文件的选择', () => {
  it('按 NODE_ENV 拼路径，未设时按 development（不会出现 .env.undefined）', () => {
    expect(resolveEnvFilePaths(EMPTY_ENV)).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
  });

  it('test 环境跳过 .env.local（测试结果不该依赖本机文件）', () => {
    expect(resolveEnvFilePaths({ NODE_ENV: 'test' })).toEqual([
      '.env.test.local',
      '.env.test',
      '.env',
    ]);
  });

  it('测试环境整体忽略 env 文件', () => {
    expect(shouldIgnoreEnvFile({ NODE_ENV: 'test' })).toBe(true);
    expect(shouldIgnoreEnvFile({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldIgnoreEnvFile(EMPTY_ENV)).toBe(false);
  });
});

describe('AppConfigModule 接线', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('五个 namespace 都能通过全局 ConfigService 读到，且类型正确', () => {
    const resolved = readResolvedConfig(app.get(ConfigService));

    expect(typeof resolved.app.port).toBe('number');
    expect(resolved.app.env).toBe('test'); // jest 会设置 NODE_ENV=test
    expect(resolved.database.driver).toBe('memory');
    expect(resolved.database.poolSize).toBe(10);
    expect(Array.isArray(resolved.cors.origins)).toBe(true);
    expect(resolved.throttle.ttlSeconds).toBe(60);
  });

  it('启动摘要能直接从容器里生成（main.ts 用的就是这个入口）', () => {
    expect(describeConfig(app.get(ConfigService))).toContain('port=');
  });

  it('单独 import AppConfigModule 就够用（"一行接入"的证明）', async () => {
    const fixture = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();
    const isolated = fixture.createNestApplication();

    await isolated.init();

    try {
      const resolved = readResolvedConfig(isolated.get(ConfigService));

      expect(resolved.app.port).toBeGreaterThan(0);
      expect(resolved.database.driver).toBe('memory');
    } finally {
      await isolated.close();
    }
  });

  it('未设置环境变量时也能正常装配（默认 memory 驱动 + 默认端口）', () => {
    expect(readAppConfig(EMPTY_ENV).port).toBe(3000);
  });
});

/**
 * 「配置有没有真的被用到」的证明。
 *
 * 这一组不是测纯函数，而是**端到端**验证 `app.module.ts` 里的
 * `apiContractOptionsFactory`：把配置换成非默认值，然后发真实请求，
 * 看响应形状有没有跟着变。
 *
 * 做法：`overrideProvider(ConfigService)` 换成一个桩。这样既不用污染 `process.env`
 * （配置在模块定义期就被读走了，改环境变量对已加载的模块无效），
 * 又能精确构造出"生产环境才可能出现的配置组合"。
 */
describe('配置 → 契约层：配置真的生效吗', () => {
  /** 用「默认配置 + 覆盖项」装配整个 AppModule。 */
  async function createAppWith(
    overrides: Partial<AppConfig>,
  ): Promise<INestApplication<App>> {
    const appConfig: AppConfig = { ...readAppConfig(EMPTY_ENV), ...overrides };

    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: (key: string): unknown => {
          switch (key) {
            case 'app':
              return appConfig;
            case 'swagger':
              return readSwaggerConfig(EMPTY_ENV);
            case 'cors':
              return readCorsConfig(EMPTY_ENV);
            case 'throttle':
              return readThrottleConfig(EMPTY_ENV);
            case 'database':
              return readDatabaseConfig(EMPTY_ENV);
            default:
              throw new Error(`桩没有覆盖配置键：${key}`);
          }
        },
      })
      .compile();

    const app = fixture.createNestApplication();
    await app.init();

    return app;
  }

  it('工厂把 app.strictValidation / app.envelope 映射成契约层选项', () => {
    const options = apiContractOptionsFactory({
      getOrThrow: () => ({ strictValidation: true, envelope: false }),
    } as unknown as ConfigService);

    expect(options).toEqual({
      forbidNonWhitelisted: true,
      envelope: false,
    });
  });

  it('默认配置：信封开着，多余字段被静默剥掉（与改动前行为一致）', async () => {
    const app = await createAppWith({});

    try {
      const ok = await request(app.getHttpServer())
        .get('/validation-demo/users/1')
        .expect(200);

      expect(ok.body).toMatchObject({ success: true });

      const created = await request(app.getHttpServer())
        .post('/validation-demo/users')
        .send({
          name: 'Loose',
          email: 'loose@example.com',
          role: 'viewer',
          extra: 'x',
        })
        .expect(201);

      // 默认 forbidNonWhitelisted=false：多余字段被 whitelist 剥掉而不是 400
      expect(created.body).toMatchObject({ success: true });
      expect(
        (created.body as { data: Record<string, unknown> }).data,
      ).not.toHaveProperty('extra');
    } finally {
      await app.close();
    }
  });

  it('ENABLE_ENVELOPE=false：成功响应是裸值；失败侧不受影响', async () => {
    const app = await createAppWith({ envelope: false });

    try {
      const ok = await request(app.getHttpServer())
        .get('/validation-demo/users/1')
        .expect(200);

      expect(ok.body).not.toHaveProperty('success');
      expect(ok.body).toMatchObject({ id: 1, name: 'Neo' });

      // 失败侧由全局过滤器负责，与信封开关无关 —— 契约仍然成立
      const notFound = await request(app.getHttpServer())
        .get('/validation-demo/users/999999')
        .expect(404);

      expect(notFound.body).toMatchObject({
        success: false,
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
      });
    } finally {
      await app.close();
    }
  });

  it('STRICT_VALIDATION=true：多一个未声明字段就 400', async () => {
    const app = await createAppWith({ strictValidation: true });

    try {
      const res = await request(app.getHttpServer())
        .post('/validation-demo/users')
        .send({
          name: 'Strict',
          email: 'strict@example.com',
          role: 'viewer',
          extra: 'x',
        })
        .expect(400);

      expect(res.body).toMatchObject({
        success: false,
        code: 'VALIDATION_FAILED',
      });
      expect(JSON.stringify(res.body)).toContain('extra');
    } finally {
      await app.close();
    }
  });
});
