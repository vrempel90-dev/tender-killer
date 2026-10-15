/**
 * Копирование статики в standalone-сборку.
 *
 * Next.js с `output: 'standalone'` кладёт в `.next/standalone` только серверный
 * код: статику и public нужно положить рядом самостоятельно. В Docker это
 * делают инструкции COPY, а для локального запуска — этот скрипт.
 */

import { cp, rm, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  console.log(
    'Каталог .next/standalone не найден — копирование статики пропущено.',
  );
  process.exit(0);
}

for (const [from, to] of [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
  [path.join(root, '.workers'), path.join(standalone, '.workers')],
]) {
  if (!(await exists(from))) continue;
  // Каталог назначения удаляем: иначе cp вложит копию внутрь существующей.
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

console.log('Статика и public скопированы в .next/standalone.');
