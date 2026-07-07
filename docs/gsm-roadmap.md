# Товароучёт ГСМ на `/gsm-card` — каноническое ТЗ

> Источник истины для реализации. Все агенты сверяются с этим файлом.
> Главная страница `/` (ZayavkaPage → POST `/repair/` → xlsx → MAX) **НЕ ТРОГАЕТСЯ**.

## 0. Контекст и ограничения

- Единое Express + Bun приложение (фронт vite/React + API на одном порту, default 3005). Runtime — **Bun 1.3.12** (`oven/bun`).
- Переделываем роут **`/gsm-card`** из ненужного дубля в товароучёт ГСМ (приход/списание по партиям). URL роута остаётся `/gsm-card`.
- **Ноль новых npm-зависимостей.** SQLite — встроенный `bun:sqlite`. Хэш паролей — `Bun.password` (argon2id). Cookie читаем из `req.headers.cookie` вручную, ставим через `res.cookie` (есть в express). Никаких ORM/cookie-parser/jwt.

## 1. Зафиксированные решения

| Аспект | Решение |
|---|---|
| Роли | `manager` (глобальный, `site=NULL`, приходует на любой участок, видит всё) и `worker` (закреплён за 1 участком, списывает/смотрит только свой). Значение роли везде — **`worker`** (НЕ `employee`). |
| Модель склада | **По партиям (Model A)**: 1 приход = 1 партия (lot) со своим остатком. Две бочки одного масла = две независимые партии. Без общего пула. |
| Участок | Строка-имя из `LOTS` (`src/data/lotData.tsx`). **Отдельного `siteId` нет** — везде поле `site` (имя участка строкой). |
| Единица изм. | Поле `unit`, дефолт `'л'`. Кол-во дробное. |
| Даты | **Только день (`YYYY-MM-DD`), время нигде не учитываем и не выводим.** Единая TZ для «сегодня» = **`Europe/Moscow`**. |
| Неизменяемость | `receipts`/`writeoffs` — append-only + триггеры `BEFORE UPDATE/DELETE → RAISE(ABORT)`. Редактировать/удалять нельзя никому. |
| Пользователи | Не удаляются физически (`is_active=0`). Менеджеров заводит дев (сид), воркеров — менеджер через UI. Реактивация воркера по старому логину разрешена. Мин. длина пароля воркера — **6**. |
| MAX | На gsm-card НЕ используется. Только внутреннее хранилище + UI. |

## 2. Модель данных (SQLite, файл `server/data/inventory.db`)

PRAGMA при открытии соединения:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager','worker')),
  site          TEXT,
  display_name  TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    INTEGER REFERENCES users(id),
  CHECK ((role='manager' AND site IS NULL) OR (role='worker' AND site IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,              -- криптослучайный токен (= значение cookie)
  user_id      INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,                 -- datetime('now','+30 days')
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts (        -- 1 строка = 1 партия
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site          TEXT NOT NULL,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'л',
  qty_initial   REAL NOT NULL CHECK (qty_initial > 0),
  received_date TEXT NOT NULL CHECK (received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS writeoffs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id),
  qty           REAL NOT NULL CHECK (qty > 0),
  writeoff_date TEXT NOT NULL CHECK (writeoff_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- NB: в GLOB '_' это литерал (не wildcard); используем диапазоны цифр
  license_plate TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_site       ON users(site) WHERE site IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_site    ON receipts(site);
CREATE INDEX IF NOT EXISTS idx_receipts_cby     ON receipts(created_by);
CREATE INDEX IF NOT EXISTS idx_writeoffs_recpt  ON writeoffs(receipt_id);
CREATE INDEX IF NOT EXISTS idx_writeoffs_cby    ON writeoffs(created_by);

CREATE TRIGGER IF NOT EXISTS receipts_no_update  BEFORE UPDATE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipts_no_delete  BEFORE DELETE ON receipts  BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_update BEFORE UPDATE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS writeoffs_no_delete BEFORE DELETE ON writeoffs BEGIN SELECT RAISE(ABORT,'append-only'); END;
```

Остаток партии = `qty_initial − Σ writeoffs.qty`. `created_at` — только технический аудит, **никогда не выводится**; порядок событий одного дня — по `id` (порядок вставки).

**Схема v4 — corrections (сторно/правка менеджером).** Append-only сохраняется: правка/отмена записи = НОВАЯ строка в `corrections`, никаких UPDATE receipts/writeoffs.

```sql
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('receipt','writeoff')),
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('void','edit')),
  new_date TEXT CHECK (new_date IS NULL OR new_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  new_qty REAL CHECK (new_qty IS NULL OR new_qty > 0),
  new_name TEXT, new_code TEXT, new_unit TEXT,          -- только для receipt
  new_license_plate TEXT, new_reason TEXT,              -- только для writeoff
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_target ON corrections(target_kind, target_id);
-- + append-only триггеры corrections_no_update / corrections_no_delete
```

Правила: корректировок на запись может быть несколько — **действует последняя** (`MAX(id)` per `(target_kind,target_id)`). `action='void'` — все `new_*` NULL, запись «мертва» (дальнейшие корректировки → `already_voided`). `action='edit'` — репо пишет **снапшот итогового состояния** во все `new_*`-поля целевого типа, поэтому выборки смотрят только последнюю корректировку. Все выборки/балансы считаются по **эффективным** значениям (SQL-фрагменты экспортирует `server/repo/lots.ts`): voided-приход исключается из списков, voided-списание не уменьшает остаток. Записи, связанные с перемещением (`transfers`), неприкосновенны → `transfer_locked`. Void прихода — только без активных списаний (`has_writeoffs`); edit не должен увести остаток в минус (`exceeds`).

## 3. Сквозные политики (ОБЯЗАТЕЛЬНЫ во всех местах)

1. **Float-эпсилон.** Кол-ва округляем до 3 знаков на входе (бек). `EPS = 1e-9`. Активная партия: `balance > EPS`; архив: `balance ≤ EPS`. Одинаково в SQL-фильтрах, бек-валидации списания, фронт-валидации и расчёте бегущего остатка.
2. **Даты, TZ.** Формат `YYYY-MM-DD`. «Сегодня» = дата в `Europe/Moscow`: `new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date())` (и на сервере, и на фронте). Правило списания: `received_date ≤ writeoff_date ≤ today` — проверка на фронте (zod) И на беке (в транзакции). Прошлое разрешено, будущее запрещено.
3. **Атомарная серия списаний.** Вся серия по одной партии — в одной транзакции `db.exec('BEGIN IMMEDIATE')` … пересчёт остатка с учётом уже добавленных строк серии … `COMMIT`/`ROLLBACK`. Всё-или-ничего. (bun:sqlite по умолчанию DEFERRED — использовать ЯВНО `BEGIN IMMEDIATE`.)
4. **Доверять только серверу.** `role`, `site`, автор — из сессии, не из тела запроса. Чужой `:id` (партия другого участка) → **404** (не 403 — не раскрываем существование).
5. **Транспорт.** Сузить CORS до своего origin (фронт+API один origin — для `/api/gsm` можно отключить cors совсем). Cookie `gsm_sid`: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` + `Secure` при HTTPS (учесть `trust proxy` за nginx). Логин — in-memory rate-limit (≈5 неудач / 15 мин на username+IP).
6. **Секреты.** Удалить `GSM_CARD_PASSWORD` и обёртку `PasswordGate` из `App.tsx` (иначе утечёт в бандл).

## 4. Контракт API (канон; префикс `/api/gsm`, JSON, фронт `credentials:'include'`)

Канон-типы ответов:
```ts
type Role = 'manager' | 'worker';
type User = { id:number; username:string; displayName:string|null; role:Role; site:string|null };
type Lot  = { id:number; name:string; code:string; site:string; unit:string;
              initialQty:number; balance:number; receivedDate:string;
              author:{ username:string; displayName:string|null } };
type HistoryEvent = { kind:'receipt'|'writeoff'; date:string; qty:number; balanceAfter:number;
                      licensePlate?:string; reason?:string; author:{username:string; displayName:string|null} };
```

| Метод / путь | Доступ | Тело → Ответ | Правила |
|---|---|---|---|
| `POST /api/gsm/login` | публичный | `{username,password}` → `200 {user}` + cookie / `401 {error}` | rate-limit |
| `POST /api/gsm/logout` | auth | → `204` | удаляет сессию + чистит cookie |
| `GET /api/gsm/me` | auth | → `200 {user}` / `401` | |
| `GET /api/gsm/lots` | auth | → `{lots:Lot[]}` | manager: все; worker: сервер фильтрует по `session.site` (query игнор) |
| `POST /api/gsm/receipts` | manager | `{rows:[{receivedDate,site,name,code,unit,quantity}]}` → `201 {created:n}` / `400` | каждый `site∈LOTS`; автор из сессии; одна транзакция |
| `POST /api/gsm/lots/:id/writeoffs` | worker | `{rows:[{date,licensePlate,amount,reason}]}` → `201 {created:n}` / `400` / `404` / `409 {error,balance}` | `lot.site==session.site` иначе 404; серия в `BEGIN IMMEDIATE`; сумма ≤ остаток |
| `GET /api/gsm/lots/:id/history` | auth | → `{lot, events:HistoryEvent[]}` / `404` | worker — только своя партия (иначе 404); manager — любая |
| `GET /api/gsm/employees` | manager | → `{employees:[{id,username,displayName,site}]}` | только активные |
| `POST /api/gsm/employees` | manager | `{username,password,displayName,site}` → `201 {id}` / `409` / `400` | роль форсится `worker`; `site∈LOTS`; пароль≥6; занятый логин → реактивация или 409 |
| `DELETE /api/gsm/employees/:id` | manager | → `204` | `is_active=0`, только `role='worker'` |
| `POST /api/gsm/writeoffs/:id/correct` | manager | `{action:'void'}` \| `{action:'edit', date?, amount?, licensePlate?, reason?}` → `201 {id}` / `400 invalid` / `404` / `409 {error[,balance]}` | v4: сторно/правка списания; `transfer_locked`/`already_voided`/`exceeds+balance` → 409 |
| `POST /api/gsm/receipts/:id/correct` | manager | `{action:'void'}` \| `{action:'edit', receivedDate?, name?, code?, unit?, quantity?}` → `201 {id}` / `400 invalid` / `404` / `409 {error[,balance]}` | v4: сторно/правка партии (участок не меняется); + `has_writeoffs` → 409 |

## 5. Контракты модулей (сигнатуры — чтобы слои стыковались)

```
server/db.ts            export const db: Database (bun:sqlite); bootstrap() выполняется на импорте (PRAGMA + DDL)
server/lib/num.ts       EPS; round3(n); gte(a,b)=a>=b-EPS; gt(a,b)=a>b+EPS; isZeroOrLess(n)=n<=EPS
server/lib/dates.ts     todayMsk():string; isValidDate(s):boolean; lte(a,b)/gte(a,b) лексикографически
server/repo/users.ts    findByUsername(u); verifyLogin(u,pwd):Promise<UserRow|null>; getById(id);
                        listWorkers(); createOrReactivateWorker({username,password,displayName,site,createdBy})
                          :Promise<{id}|{conflict:'active'}>; softDeleteWorker(id):boolean
server/repo/sessions.ts create(userId):{token,expiresAt}; resolve(token):{user:User}|null (проверка expiry+is_active, скользящее продление last_seen); destroy(token); cleanupExpired()
server/repo/receipts.ts createMany(rows, createdBy):{created:number} — одна транзакция
server/repo/lots.ts     list(opts:{site?:string}):Lot[]; getById(id):{id,site,receivedDate,unit,name,code}|null;
                        history(id):{lot,events:HistoryEvent[]}
server/repo/writeoffs.ts createSeries(receiptId, rows, worker:{id,site}):
                          {ok:true,created:n} | {ok:false,error:'not_found'|'date'|'exceeds',balance?:number}
                          — BEGIN IMMEDIATE; проверка site/дат/суммы с EPS; всё-или-ничего
server/auth/cookies.ts  parseCookies(header):Record<string,string>; setSession(res,token); clearSession(res)
server/auth/middleware.ts attachUser; requireAuth; requireManager
server/auth/rateLimit.ts loginLimiter(key):boolean
```

Фронт-схемы — `src/lib/gsmSchemas.ts` (отдельно от `src/types.ts`): `LoginSchema`, `ReceiptSchema`, `WriteOffSchema(lot)` (с `superRefine` нарастающей суммы ≤ `lot.balance`). Парсер кол-ва — `src/lib/parseQuantity.ts` (по образцу `parseOptionalPrice`, но обязательный, `''→NaN`).

## 6. Этапы

**Этап 0 — Инфраструктура + БД-слой.** `server/db.ts`, `server/lib/num.ts`, `server/lib/dates.ts`, `server/data/.gitkeep`; правки `.gitignore` (+`server/data/`), `.dockerignore` (+`server/data/`), `docker-compose.yml` (**named volume на `/app/server/data`**, например `volumes: [gsmdata:/app/server/data]`). Приёмка: импорт `db.ts` создаёт БД и все таблицы/триггеры; UPDATE по receipts падает с `append-only`; рестарт контейнера сохраняет данные.

**Этап 1 — Репозитории.** `server/repo/*.ts` по §5. Приёмка: списание серией атомарно; остаток с эпсилон; гонка не уводит в минус. (Сид-скрипт `server/seed.ts` удалён — устарел после миграции схемы на `site_id`; пользователи заводятся менеджером в UI.)

**Этап 2 — Авторизация (бек).** `server/auth/*`; правки `server/index.ts` (CORS сузить, `trust proxy`, guard смонтирован перед gsm-роутером, кроме `/login`). Эндпоинты `/login`,`/logout`,`/me`. Приёмка: без cookie `/api/gsm/*` (кроме login) → 401; неверный пароль → 401; rate-limit.

**Этап 3 — API товароучёта (бек).** Переписать `server/routes/gsm.ts`: `/lots`,`/receipts`,`/lots/:id/writeoffs`,`/lots/:id/history`,`/employees` CRUD. Удалить старый `/gsm-write-off`. Правила: `site∈LOTS`; чужой участок → 404; роль воркера форсится; реактивация по логину. Приёмка: worker не видит/не пишет чужой участок (404); серия-превышение → 409 + откат; manager видит все участки.

**Этап 4 — Фронт: каркас + вход.** Переписать `src/App.tsx` (убрать PasswordGate+GSM_CARD_PASSWORD; `/gsm-card` → новый `GsmCardPage`); удалить `src/components/PasswordGate.tsx`; `src/pages/GsmCardPage.tsx` (контейнер по сессии); `src/components/gsm/useSession.ts`; `src/pages/gsm/LoginPage.tsx`; `src/lib/gsmSchemas.ts`, `src/lib/parseQuantity.ts`. Приёмка: `/gsm-card`→логин; F5 работает; `/` не изменилась; в бандле нет пароля.

**Этап 5 — Фронт: менеджер.** `src/pages/gsm/ManagerPage.tsx`; `src/components/gsm/ReceiptForm.tsx`+`ReceiptRow.tsx` (мульти-строки; участок=Combobox LOTS `allowCustom=false`; наименование=свободный input; код; кол-во; ед.изм «л»); `StockList.tsx` (**группировка по участкам**, active сверху, архив «под катом»); `LotHistory.tsx` (раскрывающаяся секция); `EmployeeAdmin.tsx`. Приёмка: мульти-приход; остатки+история по всем участкам; CRUD воркеров.

**Этап 6 — Фронт: сотрудник участка.** `src/pages/gsm/EmployeePage.tsx`; `StockList` (свой участок, кнопки «Списать»/«История»); `WriteOffForm.tsx`+`WriteOffRow.tsx` (мульти-строки; дата `type=date` min=приход max=сегодня; № авто=Combobox LICENSE_PLATES; выдано; **остаток readonly=бегущий**; причина); после сохранения — рефетч и новый товар. Приёмка: бегущий остаток корректен; нельзя > остатка (фронт+бек); граница дат; виден только свой участок.

**Этап 7 — Тесты/граничные/приёмка.** Конкуррентные списания; серия-откат `[60,60]@100`; «до нуля»→архив (эпсилон); граница дат МСК; чужой `:id`→404; brute-force логина; пустые состояния. Затем визуальная проверка через preview (обе роли).

## 7. Переиспользование (фронт) — фактические API

- `Combobox` (`src/components/ui/Combobox.tsx`): `{ options:string[]; value:string; onChange:(v)=>void; placeholder?; emptyMessage?; allowCustom? }`. Участок → `options=LOTS, allowCustom=false`; № авто → `options=LICENSE_PLATES, allowCustom=true`.
- `AppHeader` (`{title}`), `SubmitFooter` (`{isSubmitting,label?}`) — как есть. Кнопку «Выйти» добавить рядом в layout.
- Паттерн `useFieldArray` из `ItemsSection`/`ItemRow` — копировать как шаблон строк (имя поля `rows`).
- Стили: `.resource-input`, primary `#FFCF00`, контейнеры карточек из `ZayavkaPage`/`ItemRow` — переиспользовать.
- Данные: `LOTS` (`src/data/lotData.tsx`), `LICENSE_PLATES` (`src/data/licenceNumberData.tsx`). Массив `SITES` в `constants.ts` НЕ использовать.
