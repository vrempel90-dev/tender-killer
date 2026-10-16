import { describe, expect, it } from 'vitest';
import {
  compareSnapshots,
  diffSpec,
  highestSeverity,
  normalizeSpec,
  specHash,
  type Snapshot,
} from '../compare';

const NOW = new Date('2026-10-15T00:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

const base: Snapshot = {
  submissionDeadline: at(20),
  deliveryDeadline: at(90),
  startPriceMinor: 10_000_000_00,
  specText: 'Кабель силовой ВВГ 3х2.5\nДлина 500 метров\nСертификат соответствия',
};

describe('нормализация текста задания', () => {
  it('убирает вставки парсера и лишние пробелы', () => {
    const text = '--- стр. 1 ---\nКабель   силовой\n\n\tДлина 500 м\n--- стр. 2 ---';
    expect(normalizeSpec(text)).toBe('кабель силовой\nдлина 500 м');
  });

  it('ГЛАВНОЕ: перезагрузка того же документа не выглядит изменением', () => {
    const first = 'Кабель силовой ВВГ\n--- стр. 1 ---\nДлина 500 метров';
    const second = 'Кабель  силовой ВВГ\r\n\r\nДлина 500 метров\n--- стр. 2 ---';
    expect(specHash(first)).toBe(specHash(second));
    expect(compareSnapshots(
      { ...base, specText: first },
      { ...base, specText: second },
      { now: NOW },
    )).toEqual([]);
  });
});

describe('различия текста задания', () => {
  it('находит добавленные и удалённые требования', () => {
    const diff = diffSpec(
      'Кабель силовой\nДлина 500 метров\nСертификат',
      'Кабель силовой\nДлина 800 метров\nСертификат\nИспытания в лаборатории',
    );
    expect(diff.addedLines).toContain('длина 800 метров');
    expect(diff.addedLines).toContain('испытания в лаборатории');
    expect(diff.removedLines).toContain('длина 500 метров');
    expect(diff.similarity).toBeLessThan(1);
  });

  it('совпадение одинаковых текстов равно единице', () => {
    expect(diffSpec('Кабель\nДлина', 'Кабель\nДлина').similarity).toBe(1);
  });

  it('перечень различий ограничен, но счётчики полные', () => {
    const before = Array.from({ length: 50 }, (_, i) => `требование ${i}`).join('\n');
    const after = Array.from({ length: 50 }, (_, i) => `иное требование ${i}`).join('\n');
    const diff = diffSpec(before, after);
    expect(diff.addedCount).toBe(50);
    expect(diff.addedLines.length).toBeLessThanOrEqual(20);
  });

  it('два пустых текста считаются совпадающими', () => {
    expect(diffSpec('', '').similarity).toBe(1);
  });
});

describe('срок подачи заявки', () => {
  it('ГЛАВНОЕ: перенос на более раннюю дату — критично', () => {
    const changes = compareSnapshots(
      base,
      { ...base, submissionDeadline: at(1) },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'SUBMISSION_DEADLINE_MOVED');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.summary).toMatch(/сдвинут на 19 дн. раньше/);
    expect(change?.detail.daysLeft).toBe(1);
  });

  it('истёкший после переноса срок — критично', () => {
    const changes = compareSnapshots(
      base,
      { ...base, submissionDeadline: at(-1) },
      { now: NOW },
    );
    expect(changes[0]?.severity).toBe('CRITICAL');
  });

  it('умеренный перенос назад с запасом времени — существенно', () => {
    const changes = compareSnapshots(
      { ...base, submissionDeadline: at(30) },
      { ...base, submissionDeadline: at(25) },
      { now: NOW },
    );
    expect(changes[0]?.severity).toBe('MAJOR');
  });

  it('продление срока не требует пересчёта', () => {
    const changes = compareSnapshots(
      base,
      { ...base, submissionDeadline: at(35) },
      { now: NOW },
    );
    expect(changes[0]?.requiresRecalc).toBe(false);
    expect(changes[0]?.severity).toBe('MINOR');
  });
});

describe('срок поставки', () => {
  it('сокращение срока критично и требует пересчёта', () => {
    const changes = compareSnapshots(
      base,
      { ...base, deliveryDeadline: at(40) },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'DELIVERY_DEADLINE_MOVED');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.requiresRecalc).toBe(true);
    expect(change?.detail.shiftDays).toBe(-50);
  });

  it('продление срока тоже требует пересчёта: меняется график платежей', () => {
    const changes = compareSnapshots(
      base,
      { ...base, deliveryDeadline: at(120) },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'DELIVERY_DEADLINE_MOVED');
    expect(change?.severity).toBe('MAJOR');
    expect(change?.requiresRecalc).toBe(true);
  });
});

describe('начальная цена', () => {
  it('снижение цены критично и требует пересчёта', () => {
    const changes = compareSnapshots(
      base,
      { ...base, startPriceMinor: 8_000_000_00 },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'START_PRICE_CHANGED');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.requiresRecalc).toBe(true);
    expect(change?.detail.deltaMinor).toBe(-200_000_000);
  });

  it('повышение цены существенно', () => {
    const changes = compareSnapshots(
      base,
      { ...base, startPriceMinor: 12_000_000_00 },
      { now: NOW },
    );
    expect(changes[0]?.severity).toBe('MAJOR');
  });

  it('ГЛАВНОЕ: расхождение в пределах порога не требует пересчёта', () => {
    // 0,5% — обычно следствие переоформления документов.
    const changes = compareSnapshots(
      base,
      { ...base, startPriceMinor: 10_050_000_00 },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'START_PRICE_CHANGED');
    expect(change?.severity).toBe('MINOR');
    expect(change?.requiresRecalc).toBe(false);
  });
});

describe('техническое задание', () => {
  it('переписанное задание критично', () => {
    const changes = compareSnapshots(
      base,
      {
        ...base,
        specText: 'Мебель офисная\nСтолы 20 штук\nСтулья 40 штук',
      },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'SPEC_CHANGED');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.requiresRecalc).toBe(true);
  });

  it('добавленное требование к длинному заданию — существенно', () => {
    // Задание реального размера: два новых требования из тридцати меняют
    // объём работ, но не предмет закупки.
    const long = Array.from({ length: 30 }, (_, i) => `Требование ${i + 1}`).join('\n');
    const changes = compareSnapshots(
      { ...base, specText: long },
      { ...base, specText: `${long}\nШеф-монтаж на объекте\nОбучение персонала` },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'SPEC_CHANGED');
    expect(change?.severity).toBe('MAJOR');
    expect(change?.requiresRecalc).toBe(true);
    expect(change?.detail.addedLines).toContain('шеф-монтаж на объекте');
  });

  it('правка формулировки в длинном задании — незначительна', () => {
    const long = Array.from({ length: 120 }, (_, i) => `Требование ${i + 1}`).join('\n');
    const changes = compareSnapshots(
      { ...base, specText: long },
      { ...base, specText: `${long}\nУточнение по упаковке` },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'SPEC_CHANGED');
    expect(change?.severity).toBe('MINOR');
    expect(change?.requiresRecalc).toBe(false);
  });

  it('ГЛАВНОЕ: короткое задание меняется ощутимее — и это не ошибка', () => {
    // В задании из трёх пунктов два новых требования меняют половину
    // объёма, поэтому значимость выше. Порог один и тот же, разная — доля.
    const changes = compareSnapshots(
      base,
      { ...base, specText: `${base.specText}\nШеф-монтаж\nОбучение персонала` },
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'SPEC_CHANGED');
    expect(change?.severity).toBe('CRITICAL');
    expect(change?.detail.similarity).toBeLessThan(0.7);
  });

  it('пропавший текст задания не считается «изменений нет»', () => {
    const changes = compareSnapshots(base, { ...base, specText: null }, { now: NOW });
    const change = changes.find((item) => item.kind === 'DOCUMENT_REPLACED');
    expect(change?.severity).toBe('MAJOR');
    expect(change?.summary).toMatch(/сравнение невозможно/);
  });

  it('первое появление задания не считается изменением требований', () => {
    const changes = compareSnapshots(
      { ...base, specText: null },
      base,
      { now: NOW },
    );
    const change = changes.find((item) => item.kind === 'DOCUMENT_ADDED');
    expect(change?.severity).toBe('INFO');
    expect(change?.requiresRecalc).toBe(false);
  });
});

describe('сводка', () => {
  it('без изменений возвращается пустой перечень', () => {
    expect(compareSnapshots(base, { ...base }, { now: NOW })).toEqual([]);
  });

  it('несколько изменений фиксируются все', () => {
    const changes = compareSnapshots(
      base,
      {
        submissionDeadline: at(2),
        deliveryDeadline: at(40),
        startPriceMinor: 7_000_000_00,
        specText: 'Совсем другое задание',
      },
      { now: NOW },
    );
    expect(changes).toHaveLength(4);
    expect(highestSeverity(changes)).toBe('CRITICAL');
    expect(changes.some((change) => change.requiresRecalc)).toBe(true);
  });

  it('наивысшая значимость пустого перечня — null', () => {
    expect(highestSeverity([])).toBeNull();
  });
});
