// ESLint flat config（monorepo：scheduler 純函式核心 + api NestJS）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // 專案刻意在少數邊界（pg 參數、jsonb、動態日曆例外）使用 any
      '@typescript-eslint/no-explicit-any': 'off',
      // 未使用變數視為錯誤，但允許 _ 前綴刻意忽略
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
