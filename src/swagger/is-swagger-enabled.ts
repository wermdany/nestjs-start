/**
 * `/docs` 的启停规则。
 *
 * 单独抽成纯函数，是为了在不启动应用的前提下就能把四种组合钉进测试
 * （见 `swagger.e2e-spec.ts`）。
 *
 * 规则（显式优先，其次看环境）：
 *
 * | `ENABLE_SWAGGER` | `NODE_ENV` | 结果 |
 * | --- | --- | --- |
 * | `'true'` | 任意 | **开**（强制开启） |
 * | `'false'` | 非 production | 关 |
 * | 未设 | `'production'` | **关**（默认不暴露接口全貌） |
 * | 未设 | 其它 / 未设 | **开**（本地开发直接可用） |
 *
 * 只在值恰好是 `'true'` / `'false'` 时才算显式 —— `'1'`、`'yes'` 这类写法**不生效**，
 * 因为含糊的真值判断（`Boolean('false') === true`）是最经典的配置坑。
 */
export function isSwaggerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const flag = env.ENABLE_SWAGGER;

  if (flag === 'true') {
    return true;
  }

  if (flag === 'false') {
    return false;
  }

  return env.NODE_ENV !== 'production';
}
