import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const vitestGlobals = {
  vi: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
}

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'android/**',
      '.vite/**',
      'public/**',
      '*.config.js',
    ],
  },
  js.configs.recommended,
  // JS + TS 共享：React / hooks / 基础规则
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '18.2' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
  // TS 专属：阶段 8 升级到 recommended-type-checked（flat config 数组形式）
  ...tsPlugin.configs['flat/recommended-type-checked'].map((c) => ({
    ...c,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...c.languageOptions,
      parserOptions: {
        ...c.languageOptions?.parserOptions,
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  })),
  // TS 规则微调（覆盖推荐配置）
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // JS 规则在 TS 文件里关闭（TS 类型系统更精确）
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // TS unused-vars 配置：接受 _ 前缀的变量（约定"故意不用"）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // 迁移期允许 any 但需有理由（用注释解释）
      '@typescript-eslint/no-explicit-any': 'error',
      // 空函数允许（事件处理器常见）
      '@typescript-eslint/no-empty-function': 'off',
      // 抑制 react-hooks/exhaustive-deps 在 useEffect 依赖列表上的过度检查
      // 原 JS 代码用 useEffect 的写法不会严格匹配依赖，迁移期不强制
      'react-hooks/exhaustive-deps': 'off',

      // Phase 8 严格模式升级：以下规则在 JS→TS 迁移项目中过于严苛，
      // 关掉以避免噪音。保留最有价值的 no-floating-promises / no-unsafe-argument / no-unused-vars
      // ─────────────────────────────────────────────────────────────────
      // 强制要求 async 函数体内必须有 await（migration 期间很多函数为了
      // 保留原 JS 的 async 签名而保留，对逻辑无影响）
      '@typescript-eslint/require-await': 'off',
      // onClick={async () => doSomething()} 等场景常见，
      // 严格的 Promise-void 适配在 React handler 里不必要
      '@typescript-eslint/no-misused-promises': 'off',
      // 对非 Promise 值使用 await 是 defensive 写法，运行时等价
      '@typescript-eslint/await-thenable': 'off',
      // throw new Error('...') 在生产代码常见，业务错误不必 Error 实例
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // 模板字符串拼接 number / Date 等常见模式
      '@typescript-eslint/restrict-template-expressions': 'off',
      // unfixable 的类型边界（联合 cast 后剩余的不必要断言，已用 ESLint --fix 清过）
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    files: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}', 'src/test/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...vitestGlobals },
    },
  },
]