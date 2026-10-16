'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { MfaQr } from '@/components/auth/mfa-qr';
import { RecoveryCodes } from '@/components/auth/recovery-codes';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';

interface Enrollment {
  secretForDisplay: string;
  qr: { size: number; path: string };
}

type Mode = 'IDLE' | 'ENROLL' | 'DISABLE' | 'REISSUE';

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Не удалось выполнить запрос');
  return payload.data;
}

export function MfaSettings({
  enabled,
  required,
  pendingConfirmation,
  recoveryCodesLeft,
  confirmedAt,
}: {
  enabled: boolean;
  required: boolean;
  pendingConfirmation: boolean;
  recoveryCodesLeft: number;
  confirmedAt: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('IDLE');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(action: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Сервер недоступен');
    } finally {
      setLoading(false);
    }
  }

  function token(event: React.FormEvent<HTMLFormElement>): string {
    return String(new FormData(event.currentTarget).get('token') ?? '').trim();
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onAcknowledge={() => {
          setCodes(null);
          setMode('IDLE');
          setEnrollment(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
      {notice ? <StatusNotice severity="INFO">{notice}</StatusNotice> : null}

      <div className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-3">
        {enabled ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        )}
        <div className="min-w-0 text-[13px] leading-relaxed">
          <p className="font-medium text-ink-900">
            {enabled ? 'Подключён' : 'Не подключён'}
          </p>
          <p className="text-ink-500">
            {enabled
              ? `Подтверждён ${confirmedAt ?? '—'}. Кодов восстановления осталось: ${recoveryCodesLeft}.`
              : required
                ? 'Для вашей роли второй фактор обязателен.'
                : 'Рекомендуется подключить: пароль в одиночку не защищает от утечки.'}
          </p>
        </div>
      </div>

      {enabled && recoveryCodesLeft <= 2 ? (
        <StatusNotice severity="WARNING">
          Кодов восстановления почти не осталось. Перевыпустите набор, пока есть
          доступ к приложению.
        </StatusNotice>
      ) : null}

      {/* Подключение */}
      {!enabled && mode !== 'ENROLL' ? (
        <div className="space-y-2">
          {pendingConfirmation ? (
            <p className="text-[12px] text-ink-400">
              Подключение начато ранее и не подтверждено. Новый ключ заменит
              предыдущий.
            </p>
          ) : null}
          <Button
            type="button"
            loading={loading}
            onClick={() =>
              void run(async () => {
                const data = await postJson('/api/auth/mfa/enroll');
                setEnrollment(data as Enrollment);
                setMode('ENROLL');
              })
            }
          >
            Подключить второй фактор
          </Button>
        </div>
      ) : null}

      {mode === 'ENROLL' && enrollment ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-4">
            <MfaQr
              size={enrollment.qr.size}
              path={enrollment.qr.path}
              label="QR-код для приложения-аутентификатора"
            />
            <div className="min-w-0 flex-1 space-y-2 text-[13px]">
              <p className="leading-relaxed text-ink-500">
                Отсканируйте код или введите ключ вручную:
              </p>
              <code className="block break-all rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[13px] tracking-wider text-ink-900">
                {enrollment.secretForDisplay}
              </code>
            </div>
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const value = token(event);
              void run(async () => {
                const data = await postJson('/api/auth/mfa/confirm', { token: value });
                setCodes(Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : []);
              });
            }}
          >
            <TokenField label="Код из приложения" />
            <div className="flex gap-2">
              <Button type="submit" loading={loading}>
                Подтвердить и включить
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setMode('IDLE');
                  setEnrollment(null);
                }}
              >
                Отмена
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Перевыпуск кодов и отключение */}
      {enabled && mode === 'IDLE' ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setMode('REISSUE')}>
            Перевыпустить коды восстановления
          </Button>
          {!required ? (
            <Button type="button" variant="danger" onClick={() => setMode('DISABLE')}>
              Отключить
            </Button>
          ) : null}
        </div>
      ) : null}

      {enabled && (mode === 'REISSUE' || mode === 'DISABLE') ? (
        <form
          className="space-y-3 rounded-lg border border-ink-200 p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = token(event);
            const target = mode;
            void run(async () => {
              if (target === 'REISSUE') {
                const data = await postJson('/api/auth/mfa/recovery-codes', { token: value });
                setCodes(Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : []);
                return;
              }
              await postJson('/api/auth/mfa/disable', { token: value });
              setNotice('Второй фактор отключён.');
              setMode('IDLE');
              router.refresh();
            });
          }}
        >
          <p className="text-[13px] leading-relaxed text-ink-500">
            {mode === 'REISSUE'
              ? 'Прежние коды восстановления перестанут действовать. Подтвердите действие кодом.'
              : 'Отключение снимает защиту. Подтвердите действие кодом из приложения или кодом восстановления.'}
          </p>
          <TokenField label="Код подтверждения" />
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={loading}
              variant={mode === 'DISABLE' ? 'danger' : 'primary'}
            >
              {mode === 'REISSUE' ? 'Перевыпустить' : 'Отключить'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode('IDLE')}>
              Отмена
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function TokenField({ label }: { label: string }) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          name="token"
          required
          maxLength={64}
          autoComplete="one-time-code"
          placeholder="000000"
          className="max-w-[220px] font-mono tracking-[0.3em]"
        />
      )}
    </Field>
  );
}
