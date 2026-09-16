// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    /**
     * 不让 ESLint 去 lint 它管不到的文件 —— `projectService: true` 要求每个文件都
     * 属于 `tsconfig.json` 的项目，否则会报 "not found by the project service"。
     *
     * - `dist/**`：构建产物（`.gitignore` 已忽略），里面是 `.js` / `.d.ts`，不属于 TS 项目
     *   —— 忘了排除的话 `npx eslint .` 会一次性刷出几十个解析错误（实测 72 个）；
     * - `jest-swagger-transformer.js`：交给 jest 加载的 **CommonJS 桥接文件**，
     *   故意不进 TS 项目（见 `jest-e2e.json` 的 `astTransformers`）；
     * - `eslint.config.mjs`：这个配置文件本身（.mjs，不在项目里）。
     */
    ignores: ['dist/**', 'jest-swagger-transformer.js', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);