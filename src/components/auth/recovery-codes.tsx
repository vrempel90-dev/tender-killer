'use client';

import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';

/**
 * Коды восстановления показываются один раз. Компонент даёт их скопировать
 * и скачать, но нигде не сохраняет: повторно получить их нельзя.
 */
export function RecoveryCodes({
  codes,
  onAcknowledge,
}: {
  codes: string[];
  onAcknowledge?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const text = codes.join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob(
      [
        'TENDER KILLER — коды восстановления второго фактора\n',
        'Каждый код действует один раз. Храните их отдельно от пароля.\n\n',
        `${text}\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tender-killer-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <StatusNotice severity="WARNING" title="Сохраните коды сейчас">
        Эти коды больше не будут показаны. Каждый код срабатывает один раз и
        заменяет код из приложения, если устройство потеряно.
      </StatusNotice>

      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-ink-200 bg-ink-50 p-3 font-mono text-[13px] text-ink-900">
        {codes.map((code) => (
          <li key={code} className="tracking-wider">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="size-4" aria-hidden />
          Скачать файл
        </Button>
        {onAcknowledge ? (
          <Button type="button" size="sm" onClick={onAcknowledge}>
            Я сохранил коды
          </Button>
        ) : null}
      </div>
    </div>
  );
}
