# Проверка готовности и порядок обновления, 16.10.2026

**Статус: production обновлять нельзя.** Владелец запретил платные подключения,
merge и production deployment без отдельного разрешения. Railway staging не
создавался. Локальная сборка и CI не заменяют проверку целевой инфраструктуры.

## Фактическое расхождение

Работающий Railway web подключён к claude/laughing-heisenberg-2wdj8t,
SHA eb489cd084fd9613947233d41442bb492392112a. В этой версии нет ссылки
восстановления и используется прежняя проверка ключа Anthropic. Draft PR №3
содержит Ollama по умолчанию, ссылку, UI/API сброса пароля, Resend и миграцию.
Новый dashboard проверяет доступность локальной модели отдельно от конфигурации.
Никакого автоматического переключения на платный провайдер нет.

Production: PostgreSQL image major 18; web и DB volumes по 50000 MB,
us-west2. Это выделенные размеры, не измеренный объём данных. Ollama/ClamAV
отсутствуют. Имена web variables: APP_URL, DATABASE_URL, HOSTNAME, NODE_ENV,
PORT, SESSION_SECRET, STORAGE_DIR. Значения секретов не извлекались.
Настроен web pre-deploy migrate+seed; интеграционный web image не содержит
migration CLI. Требуется отдельный migrator с DDL-доступом.
На момент проверки основная GitHub-ветка не защищена, required checks выключены,
список rulesets пуст. Настройки GitHub не менялись.

## Что подтверждено, а что остаётся

| Область | Доказательство / ограничение |
|---|---|
| Ollama | Default ollama/qwen3:8b; локальный endpoint allowlist; cloud-модели запрещены; dashboard probe /tags+/show без inference, timeout 2 s, cache 15 s. Настоящая локальная модель проверяется отдельно, Railway AI отсутствует |
| Сброс | Локальная форма и кликабельная ссылка; одинаковый 503 при ненастроенном отправителе; нет созданного токена и сообщения о доставке; Resend не активирован |
| Безопасность | SHA256 токенов, срок 30 минут, активация после provider acceptance, один успешный reset при гонке, транзакционный отзыв сессий/authVersion, MFA сохраняется; CSRF/квоты/RLS и Viewer tests |
| PostgreSQL 18 | CI и локальный synthetic upgrade: все 12 миграций; шесть таблиц сохраняют старые значения, включая passwordHash и активную сессию. Реальные migration history/checksums, schema drift, объём таблиц/lock time не проверены |
| Старые пароли | Новая версия проверяет bcrypt и Argon2id. Старый production проверяет только bcrypt. Старые документы новая версия читает; новый upload требует encryption key и ClamAV |
| Backup | Учебный зашифрованный backup/restore проверяется на синтетической БД. Для PG18 требуются pg_dump/pg_restore18; PG16 client несовместим с PG18 server. Production backup и restore не выполнены |
| Runtime | CI web Docker build, read-only container smoke, Trivy, ClamAV CLEAN/EICAR. Custom Railway services, их volumes, model persistence, ресурсы CPU и ingress не проверены |
| Доставка | Ни одного реального письма. Нужны домен, Resend verification, SPF/DKIM/DMARC, выключенный tracking и отдельное разрешение на контрольный адрес |
| Эксплуатация | Не проверены masking query в edge logs/traces, trusted IP на реальном ingress, сохранность ключей, внешнее хранилище backup, алерты, incident response и правовые условия размещения |

## Последовательность после отдельного разрешения

1. Зафиксировать точный release SHA и все успешные Quality/Security checks.
   Проверить merge base и изменения production после аудита. Согласовать окно,
   ответственного и критерии остановки. Merge в текущую source branch может
   автоматически запустить production; сначала подготовить и согласовать
   управление автодеплоем. Не считать разрешение на merge разрешением deployment.
2. Через защищённый операторский доступ провести read-only inventory: PostgreSQL
   version, prisma migrate status/checksums, schema drift, counts, размеры/место,
   текущие роли и RLS, DOCUMENT_ENCRYPTION_KEY/форматы файлов без вывода значений.
   Не выполнять migrate reset, db push, DROP, очистку или baseline наугад.
3. Снять согласованную консистентную копию PostgreSQL18 и /app/storage. На время
   согласования DB/files snapshot исключить конкурентную запись. Зашифровать
   копии, сохранить ключ документов отдельно; проверить восстановление в
   **новую пустую изолированную БД/каталог**, counts, файлы/хеши, роли и RLS.
   Скрипт restore содержит --clean и применяется только к этой пустой копии;
   к production его не запускать. Не удалять прежние копии/данные.
4. Получить отдельное разрешение на необходимую инфраструктуру либо утверждённый
   существующий AI/AV-хост. До этого новых ресурсов не создавать. Подготовить
   отдельную тестовую среду и проверить UI, JSON inference, публичный PDF,
   latency/RAM/OOM, model persistence, CLEAN/EICAR, spoofed client IP и logs.
   Ollama бесплатна как ПО, но Railway CPU/RAM/storage являются оплачиваемыми.
5. Заранее собрать и проверить release image и совместимый rollback image.
   Rollback должен читать Argon2id, TKENC1, authVersion и сохранять MFA/RLS.
   Предыдущая интеграционная версия 6a1018a — кандидат, а не проверенный Railway
   rollback artifact. Исходный eb489cd не подходит после новых записей.
6. Удалить прежний migrate+seed hook **только после разрешения**, настроить
   one-shot migrator из deploy/railway/migrate.Dockerfile. Owner connection
   выдаётся только ему. Сначала проверить каждую pending migration на копии;
   согласовать lock_timeout/statement_timeout под измеренную длительность.
   Существующие passwordHash, записи, файлы и налоговые ставки сохраняются.
7. Применить additive migrate deploy на той же существующей PostgreSQL18,
   проверить grants/default privileges новой таблицы. Web получает отдельную
   NOBYPASSRLS/NOSUPERUSER роль без DDL и без чтения _prisma_migrations.
   Не менять существующий SESSION_SECRET или encryption key. Новый key для
   новых загрузок создавать только после инвентаризации форматов старых файлов
   и обеспечить отдельное защищённое хранение; legacy plaintext не становится
   зашифрованным автоматически. Не перезаписывать документы в рамках деплоя.
8. Настроить AI_PROVIDER=ollama, точный private OLLAMA_BASE_URL и выбранную
   qwen3:8b (4b — только явный выбор), лимиты, DOCUMENT_SCAN_MODE=required,
   ClamAV и права тома для UID web. Не публиковать DB/AI/AV. Установку модели
   выполнить один раз отдельной контролируемой операцией. Не делать pull в
   startup и не включать paid fallback. Доступы/стоимость согласовать отдельно.
9. До проверки почты оставить EMAIL_PROVIDER=resend,
   EMAIL_DOMAIN_VERIFIED=false, без ключа/отправителя. UI/API вернут 503.
   После подтверждения домена выполнить docs/password-reset.md: точные DNS
   записи от Resend, tracking off, ingress token/query masking, ограниченный
   API key. Отдельно запросить у владельца контрольный email и разрешение на
   реальную отправку; provider acceptance не считать доставкой во входящие.
10. После отдельного разрешения production deployment переключить на
    подготовленный image/SHA. Проверить /api/health (DB liveness, AI configured
    не равно ready), вход существующего пользователя, ожидаемый MFA enrollment
    OWNER/ADMIN, текущие тендеры/документы, upload/extraction, расчёт/PDF,
    реальный JSON AI и оба новых UI-сценария. Сверить counts и hashes, журнал
    ошибок/ресурсы. До подтверждения данных и ключей не открывать запись.
11. При регрессии закрыть запись и использовать совместимый rollback image
    с текущей БД и неизменными ключами. Не удалять additive schema и не
    накатывать старый dump поверх новых данных. При невозможности безопасного
    отката сохранить maintenance и исправлять вперёд; решение о восстановлении
    из копии с потерей новых записей требует отдельного решения владельца.

## Препятствия перед production

Нет разрешений на merge/deploy/расходы; нет проверки Railway staging; нет
подтверждённой истории/снимка реальной БД и файлов; отсутствуют AI/AV-сервисы,
проверенные secrets/роли/volumes и совместимый rollback artifact. Для email
дополнительно нужны домен/Resend/DNS/контроль доставки и masking ingress logs.
Регион, передача данных email-провайдеру, backup/key management, независимая
security/legal проверка и эксплуатационные процедуры остаются отдельными
условиями коммерческого запуска. Этот документ не объявляет систему готовой.
