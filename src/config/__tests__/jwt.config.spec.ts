import {
  configWarnings,
  DEFAULT_JWT_EXPIRES_IN,
  DEFAULT_JWT_SECRET,
  EnvValidationError,
  JWT_SECRET_MIN_WARN_LENGTH,
  readJwtConfig,
  validateEnv,
} from '@/config';

/**
 * JWT 配置的**纯函数**测试。
 *
 * 纪律与 `config.e2e-spec.ts` 一致：**不改 `process.env`**，所有读取函数都接受入参，
 * 测试直接喂对象（否则用例会通过全局状态互相影响）。
 *
 * 这里最要紧的两组用例是"**生产环境不许用公开的默认密钥**"与"**摘要/错误信息里
 * 不出现密钥**" —— 它们是"配置层替安全兜底"的那部分。
 */

describe('readJwtConfig', () => {
  it('什么都不设 → 内置开发默认值（"不设任何变量也能跑起来"）', () => {
    expect(readJwtConfig({})).toEqual({
      secret: DEFAULT_JWT_SECRET,
      expiresIn: DEFAULT_JWT_EXPIRES_IN,
    });
  });

  it('读显式配置的值', () => {
    const secret = 'x'.repeat(48);

    expect(
      readJwtConfig({ JWT_SECRET: secret, JWT_EXPIRES_IN: '15m' }),
    ).toEqual({ secret, expiresIn: '15m' });
  });
});

describe('validateEnv 对 JWT_* 的处理', () => {
  it('空环境通过（开发环境用默认密钥，只告警不拦截）', () => {
    expect(() => validateEnv({})).not.toThrow();
  });

  it.each(['15m', '1h', '7d', '30s'])('合法的 expiresIn：%s', (value) => {
    expect(() => validateEnv({ JWT_EXPIRES_IN: value })).not.toThrow();
  });

  it.each(['forever', '1', '1 hour', 'h', '60'])(
    '非法的 expiresIn → 拒绝启动，问题指向 JWT_EXPIRES_IN：%s',
    (value) => {
      let caught: unknown;

      try {
        validateEnv({ JWT_EXPIRES_IN: value });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EnvValidationError);
      expect((caught as EnvValidationError).problems.join('\n')).toContain(
        'JWT_EXPIRES_IN',
      );
    },
  );

  it('生产环境未配 JWT_SECRET → 拒绝启动（默认密钥是公开的）', () => {
    let caught: unknown;

    try {
      validateEnv({ NODE_ENV: 'production' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).problems.join('\n')).toContain(
      'JWT_SECRET',
    );
  });

  it('生产环境显式配了那个公开的默认值 → 同样拒绝启动', () => {
    let caught: unknown;

    try {
      validateEnv({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).problems.join('\n')).toContain(
      'DEFAULT_JWT_SECRET',
    );
  });

  it('生产环境配了真密钥 → 通过', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'y'.repeat(48) }),
    ).not.toThrow();
  });
});

describe('configWarnings 的 JWT 告警', () => {
  it('非生产用内置默认密钥 → 告警，但不拦启动', () => {
    const warnings = configWarnings({});

    expect(warnings.join('\n')).toContain('开发默认 JWT_SECRET');
    expect(() => validateEnv({})).not.toThrow();
  });

  it('密钥过短 → 告警（说清阈值）', () => {
    const warnings = configWarnings({ JWT_SECRET: 'short' });

    expect(warnings.join('\n')).toContain(String(JWT_SECRET_MIN_WARN_LENGTH));
  });

  it('生产环境配了够长的密钥 → 没有 JWT 相关告警', () => {
    const warnings = configWarnings({
      NODE_ENV: 'production',
      JWT_SECRET: 'z'.repeat(48),
    }).join('\n');

    expect(warnings).not.toContain('JWT');
  });
});
