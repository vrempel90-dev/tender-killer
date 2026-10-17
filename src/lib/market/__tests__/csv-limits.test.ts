import { expect, it } from 'vitest';
import { parseCsv } from '../import';
it('rejects newline and delimiter amplification before allocating unbounded tables', () => {
  expect(() => parseCsv('title\n' + '\n'.repeat(10_001))).toThrow(/10000/);
  expect(() => parseCsv('x;'.repeat(101))).toThrow(/100 столбцов/);
});
it('bounds quoted fields and total CSV text while preserving escaped delimiters', () => {
  expect(() => parseCsv('"' + 'x'.repeat(100_001) + '"')).toThrow(/100000/);
  expect(() => parseCsv('x'.repeat(8_000_001))).toThrow(/8 миллионов/);
  expect(() => parseCsv('"unfinished')).toThrow(/кавычка/);
  expect(parseCsv('title;note\n"a;b";"quote ""ok"""')).toEqual([['title', 'note'], ['a;b', 'quote "ok"']]);
});
