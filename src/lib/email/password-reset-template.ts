const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function passwordResetEmail(url: string) {
  const safeUrl = escapeHtml(url);
  return {
    subject: 'TENDER KILLER — восстановление пароля',
    text: [
      'Здравствуйте!', '',
      'Мы получили запрос на восстановление пароля от вашего аккаунта TENDER KILLER.', '',
      'Чтобы создать новый пароль, нажмите на кнопку ниже.', '',
      'Сбросить пароль: ' + url, '',
      'Ссылка действительна в течение 30 минут.', '',
      'Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.', '',
      'С уважением, команда TENDER KILLER',
    ].join('\n'),
    html: [
      '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
      '<body style="margin:0;background:#f4f6f8;color:#192331;font-family:Arial,sans-serif">',
      '<div style="display:none;max-height:0;overflow:hidden">Ссылка для создания нового пароля действительна 30 минут.</div>',
      '<table role="presentation" style="width:100%;border:0;border-collapse:collapse"><tr><td style="padding:32px 16px">',
      '<table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;background:#fff;border-radius:12px">',
      '<tr><td style="padding:28px 32px;background:#101c2b;color:#b4d7ff;font-size:13px;letter-spacing:3px;font-weight:bold">TENDER KILLER</td></tr>',
      '<tr><td style="padding:28px 32px;font-size:15px;line-height:1.7">',
      '<h1 style="font-size:24px;line-height:1.3;margin:0 0 24px">Восстановление пароля</h1>',
      '<p>Здравствуйте!</p><p>Мы получили запрос на восстановление пароля от вашего аккаунта TENDER KILLER.</p>',
      '<p>Чтобы создать новый пароль, нажмите на кнопку ниже.</p>',
      '<p style="margin:28px 0"><a href="' + safeUrl + '" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold">Сбросить пароль</a></p>',
      '<p>Ссылка действительна в течение <strong>30 минут</strong>.</p>',
      '<p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>',
      '<p>С уважением,<br>команда TENDER KILLER</p>',
      '<p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:20px">Если кнопка не работает, откройте ссылку:<br><a href="' + safeUrl + '" style="color:#2563eb;word-break:break-all">' + safeUrl + '</a></p>',
      '</td></tr></table></td></tr></table></body></html>',
    ].join(''),
  };
}
