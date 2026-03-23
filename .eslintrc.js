module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.base.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
    ecmaVersion: 2020,
  },
  env: {
    es2020: true,
    node: true,
    jest: true,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  overrides: [
    {
      files: ['load-tests/**/*.js'],
      globals: {
        __ENV: 'readonly',
      },
      rules: {
        'import/no-unresolved': 'off',
        'no-undef': 'off',
      },
    },
    {
      files: ['**/vite.config.ts'],
      rules: {
        'import/no-unresolved': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.integration.test.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        'prefer-rest-params': 'off',
        // Keep prod code strict; tests can prioritize clarity over import grouping.
        'import/order': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '.github/', '.eslintrc.js', '*.config.js'],
};
