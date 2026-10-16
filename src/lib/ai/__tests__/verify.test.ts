import { describe, expect, it } from 'vitest';
import {
  canConcludeAbsence,
  verifyComplianceFinding,
  verifyExtractionQuote,
  verifyQuote,
  type SourceDocument,
} from '../verify';

const readableDoc: SourceDocument = {
  id: 'doc-1',
  name: 'Лицензия.pdf',
  text: [
    '--- стр. 1 ---',
    'ГОСУДАРСТВЕННАЯ ЛИЦЕНЗИЯ № 20-АБ на осуществление деятельности по монтажу '
    + 'оборудования связи. Выдана 12 марта 2024 года, срок действия не ограничен.',
    '',
    '--- стр. 2 ---',
    'Гарантийный срок на поставляемое оборудование составляет 12 месяцев '
    + 'со дня подписания акта приёма-передачи.',
  ].join('\n'),
  extractionStatus: 'SUCCEEDED',
  unreadablePages: [],
};

const failedDoc: SourceDocument = {
  id: 'doc-2',
  name: 'Справка-скан.pdf',
  text: '',
  extractionStatus: 'FAILED',
  unreadablePages: [1, 2, 3],
};

const partialDoc: SourceDocument = {
  id: 'doc-3',
  name: 'Сертификат.pdf',
  text: '--- стр. 1 ---\nСЕРТИФИКАТ СООТВЕТСТВИЯ № 445\n\n--- стр. 2 ---\n',
  extractionStatus: 'PARTIAL',
  unreadablePages: [2],
};

describe('проверка цитат в документах', () => {
  it('находит дословную цитату и определяет страницу поиском', () => {
    const r = verifyQuote(
      'ГОСУДАРСТВЕННАЯ ЛИЦЕНЗИЯ № 20-АБ на осуществление деятельности',
      [readableDoc],
    );
    expect(r.verified).toBe(true);
    expect(r.pageNumber).toBe(1);
    expect(r.documentId).toBe('doc-1');
    expect(r.documentName).toBe('Лицензия.pdf');
  });

  it('определяет вторую страницу для цитаты из неё', () => {
    const r = verifyQuote(
      'Гарантийный срок на поставляемое оборудование составляет 12 месяцев',
      [readableDoc],
    );
    expect(r.verified).toBe(true);
    expect(r.pageNumber).toBe(2);
  });

  it('устойчив к различиям в кавычках, пробелах и тире', () => {
    const r = verifyQuote(
      '«ГОСУДАРСТВЕННАЯ   ЛИЦЕНЗИЯ № 20-АБ   на осуществление деятельности»',
      [readableDoc],
    );
    expect(r.verified).toBe(true);
  });

  it('НЕ подтверждает цитату, которой в документе нет', () => {
    const r = verifyQuote(
      'Поставщик включён в реестр добросовестных поставщиков с 2020 года',
      [readableDoc],
    );
    expect(r.verified).toBe(false);
    expect(r.pageNumber).toBeNull();
    expect(r.documentId).toBeNull();
  });

  it('не подтверждает слишком короткую цитату', () => {
    expect(verifyQuote('лицензия', [readableDoc]).verified).toBe(false);
  });

  it('пропускает документы без прочитанного текста', () => {
    expect(verifyQuote('любой текст длиной больше минимума', [failedDoc]).verified).toBe(
      false,
    );
  });
});

describe('допустимость вывода об отсутствии', () => {
  it('does not infer absence from truncated model input or pending extraction', () => {
    expect(canConcludeAbsence([{...readableDoc,analysisTruncated:true}]).allowed).toBe(false);
    expect(canConcludeAbsence([{...readableDoc,extractionStatus:'PROCESSING'}]).allowed).toBe(false);
  });
  it('разрешает вывод, если все документы прочитаны полностью', () => {
    const r = canConcludeAbsence([readableDoc]);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('ЗАПРЕЩАЕТ вывод, если документ не прочитан', () => {
    const r = canConcludeAbsence([readableDoc, failedDoc]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Справка-скан.pdf');
  });

  it('ЗАПРЕЩАЕТ вывод, если часть страниц без текста', () => {
    const r = canConcludeAbsence([readableDoc, partialDoc]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Сертификат.pdf');
    expect(r.reason).toContain('вручную');
  });

  it('ЗАПРЕЩАЕТ вывод, если документов нет вовсе', () => {
    const r = canConcludeAbsence([]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('не загружены');
  });
});

describe('проверка вывода AI по требованию', () => {
  it('принимает CONFIRMED с подтверждённой цитатой и ставит страницу из поиска', () => {
    const r = verifyComplianceFinding({
      status: 'CONFIRMED',
      evidenceQuote: 'ГОСУДАРСТВЕННАЯ ЛИЦЕНЗИЯ № 20-АБ на осуществление деятельности',
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('CONFIRMED');
    expect(r.pageNumber).toBe(1);
    expect(r.documentName).toBe('Лицензия.pdf');
    expect(r.adjusted).toBe(false);
  });

  it('ПОНИЖАЕТ CONFIRMED до «требует проверки», если цитаты нет в документах', () => {
    const r = verifyComplianceFinding({
      status: 'CONFIRMED',
      evidenceQuote:
        'Поставщик подтверждает отсутствие налоговой задолженности справкой № 777',
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.adjusted).toBe(true);
    expect(r.uncertaintyReason).toContain('не найдена');
    expect(r.pageNumber).toBeNull();
    expect(r.adjustmentNote).toContain('цитата не найдена');
  });

  it('ПОНИЖАЕТ CONFIRMED, если цитата вообще не приведена', () => {
    const r = verifyComplianceFinding({
      status: 'CONFIRMED',
      evidenceQuote: null,
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.adjusted).toBe(true);
    expect(r.adjustmentNote).toContain('нет цитаты');
  });

  it('ПОНИЖАЕТ MISMATCH без подтверждённой цитаты', () => {
    const r = verifyComplianceFinding({
      status: 'MISMATCH',
      evidenceQuote: 'Гарантийный срок составляет 6 месяцев',
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.adjusted).toBe(true);
  });

  it('принимает MISMATCH с реальной цитатой', () => {
    const r = verifyComplianceFinding({
      status: 'MISMATCH',
      evidenceQuote:
        'Гарантийный срок на поставляемое оборудование составляет 12 месяцев',
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('MISMATCH');
    expect(r.pageNumber).toBe(2);
    expect(r.adjusted).toBe(false);
  });

  it('ГЛАВНОЕ: NOT_FOUND заменяется на «требует проверки», если документ не прочитан', () => {
    const r = verifyComplianceFinding({
      status: 'NOT_FOUND',
      evidenceQuote: null,
      uncertaintyReason: null,
      documents: [readableDoc, failedDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.adjusted).toBe(true);
    expect(r.uncertaintyReason).toContain('Справка-скан.pdf');
    expect(r.adjustmentNote).toContain('прочитано не полностью');
  });

  it('NOT_FOUND заменяется, если часть страниц — сканы', () => {
    const r = verifyComplianceFinding({
      status: 'NOT_FOUND',
      evidenceQuote: null,
      uncertaintyReason: null,
      documents: [partialDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.adjusted).toBe(true);
  });

  it('принимает NOT_FOUND, когда все документы прочитаны полностью', () => {
    const r = verifyComplianceFinding({
      status: 'NOT_FOUND',
      evidenceQuote: null,
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('NOT_FOUND');
    expect(r.adjusted).toBe(false);
  });

  it('NEEDS_REVIEW без причины получает пояснение по умолчанию', () => {
    const r = verifyComplianceFinding({
      status: 'NEEDS_REVIEW',
      evidenceQuote: null,
      uncertaintyReason: null,
      documents: [readableDoc],
    });
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.uncertaintyReason).toContain('вручную');
  });
});

describe('проверка цитаты извлечённого требования', () => {
  it('подтверждает цитату и возвращает страницу', () => {
    const r = verifyExtractionQuote(
      'ГОСУДАРСТВЕННАЯ ЛИЦЕНЗИЯ № 20-АБ на осуществление деятельности',
      [readableDoc],
    );
    expect(r.quoteVerified).toBe(true);
    expect(r.pageNumber).toBe(1);
    expect(r.note).toBeNull();
  });

  it('не отбрасывает запись, но помечает её как требующую подтверждения', () => {
    const r = verifyExtractionQuote(
      'Участник обязан иметь опыт работы не менее пяти лет',
      [readableDoc],
    );
    expect(r.quoteVerified).toBe(false);
    expect(r.pageNumber).toBeNull();
    expect(r.note).toContain('Подтвердите запись вручную');
  });
});
