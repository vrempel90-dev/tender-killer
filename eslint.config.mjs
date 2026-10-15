import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Правила Next.js воспроизведены штатными средствами ESLint вместо
 * @next/eslint-plugin-next.
 *
 * Причина: плагин версий 15–16 зависит от fast-glob → micromatch → braces,
 * для которого выпущенной исправленной версии нет (GHSA-vfj7-8cjw-p6xm,
 * high). Версия 14.2.x этой цепочки не имеет, но использует удалённый в
 * ESLint 9 API context.getAncestors() и падает на любом файле с JSX.
 *
 * Подавлять аудит зависимостей ради сборки нельзя, поэтому зависимость
 * удалена, а проверки, которые реально применимы к этому проекту
 * (App Router, без каталога pages), заданы ниже как ограничения синтаксиса.
 * Подробности и условия возврата плагина: docs/dependency-decisions.md
 */
const NEXT_RULES = [
  {
    selector: "JSXOpeningElement[name.name='img']",
    message:
      'Используйте next/image вместо <img>: иначе нет оптимизации, lazy-loading '
      + 'и защиты от сдвига вёрстки (аналог @next/next/no-img-element).',
  },
  {
    selector: "JSXOpeningElement[name.name='head']",
    message:
      'Не используйте <head> в компонентах: метаданные задаются через экспорт '
      + 'metadata (аналог @next/next/no-head-element).',
  },
  {
    selector:
      "JSXOpeningElement[name.name='script'][attributes.0]:not(:has(JSXAttribute[name.name=/^(async|defer|dangerouslySetInnerHTML)$/]))",
    message:
      'Внешний <script> без async или defer блокирует отрисовку: используйте '
      + 'next/script (аналог @next/next/no-sync-scripts).',
  },
  {
    selector:
      "JSXOpeningElement[name.name='link'] JSXAttribute[name.name='href'][value.value=/fonts\\.googleapis\\.com/]",
    message:
      'Подключайте шрифты через next/font: ручной <link> на Google Fonts '
      + 'блокирует отрисовку (аналог @next/next/google-font-display).',
  },
  {
    selector: "ImportDeclaration[source.value='next/document'] ~ * JSXOpeningElement[name.name='title']",
    message: 'Заголовок страницы задаётся через metadata, а не <title> в документе.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      '.workers/**',
      'playwright-report/**',
      'test-results/**',
      'data/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'storage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Деньги хранятся в целых тиын — запрет на неявные приведения не нужен,
      // но нестрогое сравнение в финансовых расчётах недопустимо.
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'log'] }],
    },
  },
  {
    // Проверки, заменяющие @next/eslint-plugin-next (см. комментарий выше).
    files: ['src/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...NEXT_RULES] },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Node.js-скрипты сборки: глобальные process и console здесь ожидаемы.
    files: ['scripts/**/*.mjs', 'prisma/seed.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
);
