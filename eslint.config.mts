import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import { includeIgnoreFile } from '@eslint/compat';
import path from 'path';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

const gitignorePath = path.resolve(__dirname, '.gitignore');

export default defineConfig([
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    rules: {
      // prettier 配置为警告而不是报错
      'prettier/prettier': ['warn'],
    },
  },
  includeIgnoreFile(gitignorePath),
]);
