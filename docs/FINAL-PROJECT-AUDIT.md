# FINAL PROJECT AUDIT — TENDER KILLER

**Дата подготовки:** 17.10.2026. **Объект:** изменения в ветке `chatgpt/self-hosted-no-paid-ai-20261017`, ответвление от PR #3 HEAD `bf75b0cb08a3dcf247e868243aa59deeb90633dd`.

**Статус: НЕ ЗАВЕРШЁН, production commercial launch НЕ РАЗРЕШЁН.** Это точный реестр проведённых и ещё необходимых проверок, а не формальное заключение о безопасности. Для финального аудита зафиксируйте новый SHA после всех коммитов и результаты CI, Docker smoke на целевом оборудовании и независимую оценку. Из-за ограниченного доступа к целевой инфраструктуре часть пунктов помечена `NOT TESTED` или `BLOCKED`.

## 1. Доказательства до нашей ветки

На родительской интеграционной ветке Codex успешно прошли Quality и Security CI для HEAD bf75b0c: см. описание [PR #3](https://github.com/vrempel90-dev/tender-killer/pull/3). Заявленные результаты: 505 модульных, 52 основных HTTP/browser + 1 сценарий ненастроенной почты, проверка Typescript/ESLint/build, npm audit, CodeQL, Gitleaks, Trivy, реальный ClamAV в CI и изолированный backup/restore drill.

**Предыдущие результаты нельзя переносить на новый commit без повторного запуска.** Они также не подтверждают работающий production, продакшен-бэкапы, email-доставку, выполнение всех функций на полном корпусе PDF или правовое соответствие.

## 2. Самохостинг — кодовые изменения этой ветки

| Компонент | Проверяемое изменение | Статус |
|---|---|---|
| AI-provider | Self-hosted Compose принудительно задаёт `AI_PROVIDER=ollama`, `AI_EXTERNAL_TRANSFER_APPROVED=false`, **не инжектирует** ключ Anthropic | CODE REVIEW PASS; DOCKER RUNTIME NOT TESTED |
| PostgreSQL | Отдельная приватная сеть `db-private` | CODE REVIEW PASS; RUNTIME NOT TESTED |
| Ollama | Приватная `ai-private`, постоянный volume, отдельная загрузка Qwen3 через installer | БЫЛО В PR #3; В ЦЕЛЕВОМ РЕЖИМЕ NOT TESTED |
| ClamAV | Исправлен реальный дефект: до этой ветки Compose не поднимал ClamAV при обязательном сканировании; добавлен `clamav`, volume, healthcheck, `scan-private` | CODE REVIEW PASS; RUNTIME NOT TESTED |
| Web/AV связь | App получает `CLAMAV_HOST=clamav`, ожидает HEALTHY scanner; загрузку без антивируса не разрешает | CODE REVIEW PASS; RUNTIME NOT TESTED |
| Миграции | Compose теперь использует отдельный `migrator` target из Dockerfile | CODE REVIEW PASS; RUNTIME NOT TESTED |
| Email | Настройки Resend доступны через переменные Compose, однако без подтверждённого домена email отключён | CODE REVIEW PASS; REAL DELIVERY BLOCKED |
| Изоляция | app на localhost, приватные сети, DB/AI/AV без публичных портов | CODE REVIEW PASS; NETWORK TEST PENDING |
| CI | Добавлен статический проверочный скрипт реального `docker compose config`, плюс задание в workflow | PASS только после нового успешного GitHub run |

## 3. Проверки продукта и незакрытые риски

| Область | Статус | Что осталось |
|---|---|---|
| Financial Intelligence | PASS (предыдущий CI) | Ещё один расчёт на реальном коммерческом КП с независимой сверкой |
| Compliance Checker | PASS (узкий локальный Qwen3 прогон, PR #3) | Репрезентативный корпус и юридическая проверка выводов |
| Sourcing | PASS (существующие unit/E2E) | Реальные предложения и ручная сверка цен |
| Contract Risk | PASS (ограниченный локальный пример) | Проверка полноценного договора, выводов юристом |
| RADAR | PASS для ручного импорта, сохранённых поисков | Нет официального API-токена; фонового портального поиска нет |
| GUARD | PASS для загруженных вручную версий | Нет API и автоматического получения новых редакций |
| Reset password | PASS для test sink / кодовых тестов | Настоящий verified sender + controlled delivery; ingress token masking |
| MFA / tenants / RLS | PASS (предыдущий CI) | Проверка production миграции и конкретных прав |
| ClamAV | PASS в родительском CI, self-host Compose NOT TESTED | Запустить контейнер, CLEAN PDF/EICAR, обновления signatures |
| Docker Compose | NEW static check awaiting GitHub CI | Прогон на Linux Docker Engine, все сервисы + restart + volumes |
| Linux/Windows compatibility | NOT TESTED for new Compose | Первичная установка на чистом Linux |
| Backup/restore | PASS на отдельной CI БД, BLOCKED для production | Проверенный backup Postgres+files+keys и isolated restore |
| Доставка email | BLOCKED | Собственный verified DNS/Resend, разрешённый тестовый адрес |
| Госзакупки API | BLOCKED | Официальный токен, договорные/технические условия доступа |
| Приватность данных РК | BLOCKED | Правовое заключение, местоположение DB+file+backup, обработчики |
| Независимый security-аудит | NOT TESTED | Внешний квалифицированный эксперт |

## 4. Критерии release gate

- Ни одна неопределённость не объявляется автоматически исправленной.
- Все known P0/P1 в планируемой эксплуатации должны иметь `PASS` или релиз блокируется.
- Реальный сервер должен пройти приёмочные тесты: `docker compose up`, отсутствие публикации 5432/11434/3310, генерация Qwen3, проверка PDF ClamAV, MFA, tenant RLS, PDF-отчёт, сброс через разрешённую почту, backup/restore.
- Для разрешения на merge и Railway deployment требуется отдельное решение владельца; в этой ветке такие операции запрещены.
- Коммерческая продажа исходного кода возможна с раскрытием ограничений, но **не равна** разрешению на безопасное обслуживание реальных персональных данных клиентов.

## 5. Стоимость и передача

Программный inference через Qwen3/Ollama не требует платы за API; серверные ресурсы, домен, почта и бэкапы не гарантируются бесплатными. Продавец указывает стартовую запрашиваемую стоимость программного актива 500 000 KZT (не независимую оценку). См. [передачу покупателю](BUYER_HANDOFF.md) и [автономную установку](SELF_HOSTED_INSTALL.md).

## 6. Финальное состояние

**CHECKS/REVIEW: незавершено. SELF-HOSTED TEST: не проводился на целевой машине. STAGING/PRODUCTION DEPLOY: отсутствует.** Владелец может передать покупателю исходный код и документацию с описанными ограничениями, но не должен обещать автоматически готовый production.
