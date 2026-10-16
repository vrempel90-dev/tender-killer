'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { MfaQr } from '@/components/auth/mfa-qr';
import { RecoveryCodes } from '@/components/auth/recovery-codes';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import type { MfaGate } from '@/lib/auth/mfa/policy';

interface Enrollment {
  secretForDisplay: string;
  otpauthUri: string;
  qr: { size: number; path: string };
}

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? 'Не удалось выполнить запрос');
  }
  return payload.data;
}

export function MfaFlow({
  gate,
  email,
  required,
  pendingConfirmation,
}: {
  gate: Exclude<MfaGate, 'OK'>;
  email: string;
  required: boolean;
  pendingConfirmation: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

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

  function tokenOf(event: React.FormEvent<HTMLFormElement>): string {
    return String(new FormData(event.currentTarget).get('token') ?? '').trim();
  }

  // --- Коды восстановления: последний шаг подключения -----------------------
  if (recoveryCodes) {
    return (
      <div className="space-y-6">
        <Header
          icon={<ShieldCheck className="size-5 text-brand-600" aria-hidden />}
          title="Второй фактор подключён"
          subtitle="Остался один шаг: сохранить коды восстановления."
        />
        <RecoveryCodes
          codes={recoveryCodes}
          onAcknowledge={() => {
            router.push('/dashboard');
            router.refresh();
          }}
        />
      </div>
    );
  }

  // --- Подтверждение входа существующим фактором ---------------------------
  if (gate === 'VERIFY_REQUIRED') {
    return (
      <div className="space-y-6">
        <Header
          icon={<KeyRound className="size-5 text-brand-600" aria-hidden />}
          title="Подтвердите вход"
          subtitle={`Введите код из приложения-аутентификатора для ${email}.`}
        />
        {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const token = tokenOf(event);
            void run(async () => {
              const data = await postJson('/api/auth/mfa/verify', { token });
              router.push(typeof data?.next === 'string' ? data.next : '/dashboard');
              router.refresh();
            });
          }}
        >
          <TokenField help="Или введите один из кодов восстановления." />
          <Button type="submit" loading={loading} className="w-full" size="lg">
            Подтвердить
          </Button>
        </form>
        <LogoutHint />
      </div>
    );
  }

  // --- Подключение фактора -------------------------------------------------
  return (
    <div className="space-y-6">
      <Header
        icon={<ShieldCheck className="size-5 text-brand-600" aria-hidden />}
        title="Подключите второй фактор"
        subtitle={
          required
            ? 'Для вашей роли это обязательно: без второго фактора доступ к данным компании закрыт.'
            : 'Второй фактор защищает доступ, даже если пароль станет известен.'
        }
      />

      {error ? <StatusNotice severity="CRITICAL">{error}</StatusNotice> : null}

      {!enrollment ? (
        <div className="space-y-4">
          {pendingConfirmation ? (
            <StatusNotice severity="INFO">
              Подключение было начато ранее, но не подтверждено. Получите ключ
              заново — предыдущий перестанет действовать.
            </StatusNotice>
          ) : null}
          <p className="text-[13px] leading-relaxed text-ink-500">
            Понадобится приложение-аутентификатор: Google Authenticator, Microsoft
            Authenticator, Aegis, 1Password или любое другое с поддержкой TOTP.
          </p>
          <Button
            type="button"
            size="lg"
            className="w-full"
            loading={loading}
            onClick={() =>
              void run(async () => {
                const data = await postJson('/api/auth/mfa/enroll');
                setEnrollment(data as Enrollment);
              })
            }
          >
            Получить ключ
          </Button>
          <LogoutHint />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start gap-4">
            <MfaQr
              size={enrollment.qr.size}
              path={enrollment.qr.path}
              label="QR-код для приложения-аутентификатора"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[13px] leading-relaxed text-ink-500">
                Отсканируйте QR-код. Если камера недоступна, введите ключ вручную:
              </p>
              <code className="block break-all rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[13px] tracking-wider text-ink-900">
                {enrollment.secretForDisplay}
              </code>
              <p className="text-[12px] text-ink-400">
                Тип: TOTP, 6 цифр, интервал 30 секунд, алгоритм SHA-1.
              </p>
            </div>
          </div>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const token = tokenOf(event);
              void run(async () => {
                const data = await postJson('/api/auth/mfa/confirm', { token });
                const codes = Array.isArray(data?.recoveryCodes)
                  ? (data.recoveryCodes as string[])
                  : [];
                setRecoveryCodes(codes);
              });
            }}
          >
            <TokenField help="Код из приложения действует 30 секунд." />
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Подтвердить и включить
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

function Header({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex size-10 items-center justify-center rounded-lg bg-brand-50">
        {icon}
      </div>
      <h2 className="text-[22px] font-semibold leading-tight text-ink-900">
        {title}
      </h2>
      <p className="text-[13px] leading-relaxed text-ink-500">{subtitle}</p>
    </div>
  );
}

function TokenField({ help }: { help: string }) {
  return (
    <Field label="Код подтверждения" help={help}>
      {(id) => (
        <Input
          id={id}
          name="token"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={64}
          placeholder="000000"
          className="font-mono tracking-[0.3em]"
        />
      )}
    </Field>
  );
}

function LogoutHint() {
  const router = useRouter();
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => {
          // fetch без content-type: так же, как выход из основного интерфейса.
          void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
            router.push('/login');
            router.refresh();
          });
        }}
        className="text-[13px] font-medium text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline"
      >
        Войти под другой учётной записью
      </button>
    </div>
  );
}
