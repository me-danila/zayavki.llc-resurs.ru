# syntax=docker/dockerfile:1
# Многостадийная сборка: deps → prod-deps → build (vite build → dist) → runtime.
#
# Почему рантайм — oven/bun, а не node:22-slim (как в tabel):
#   server/db.ts:1  import { Database } from "bun:sqlite"
# bun:sqlite — встроенный модуль Bun, под node его нет. Рантайм обязан быть Bun.
#
# Почему исходники server/ остаются в образе:
#   package.json scripts.start = "bun server/index.ts"
# Сервер исполняет TypeScript напрямую, шага компиляции бэкенда нет.
# Собирается (vite build → dist) только фронт.

ARG BUN_VERSION=1.3.12

# ── зависимости для сборки: полный набор (vite, tailwind, typescript) ─────────
FROM oven/bun:${BUN_VERSION}-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── зависимости для рантайма: без devDependencies ─────────────────────────────
# Внешние импорты сервера: express, cors, dotenv, exceljs (плюс встроенные
# bun:sqlite, fs, path). Все четыре — в "dependencies". Из devDependencies
# рантайм не импортирует ничего: @types/* стираются транспайлером,
# vite/eslint/typescript/tailwind нужны только сборке.
FROM oven/bun:${BUN_VERSION}-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ── сборка фронта: vite build → dist ──────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ── рантайм ───────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app

# PORT=3000 — фиксированный ВНУТРЕННИЙ порт (как 3000 у tabel).
#   server/index.ts:14  const PORT = process.env.PORT || 3005
# Наружу порт выставляет compose: ports: ["${WEB_PORT:-3005}:3000"].
#
# ВАЖНО: `env_file: .env` в compose перебивает ENV образа. Если в .env останется
# PORT=3005, приложение внутри послушает 3005, а публикация пойдёт на 3000 —
# мимо. Поэтому compose задаёт PORT ещё и через `environment:` (высший
# приоритет), а в .env вместо PORT лежит WEB_PORT.
#
# dotenv (server/index.ts:1 `import "dotenv/config"`): файла .env в образе нет,
# .dockerignore исключает .env*. Это не ошибка — config() ловит ENOENT и молча
# возвращает {error}. Перезаписать уже заданную переменную dotenv не может:
# он пишет в process.env только отсутствующие ключи.
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Europe/Moscow \
    HOME=/home/app \
    DOTENV_CONFIG_QUIET=true

# Непривилегированный пользователь с ЗАФИКСИРОВАННЫМ uid/gid 1001.
# Фиксируем явно, а не через `useradd --system` (как tabel): под этот номер
# делается chown данных при миграции, и он не должен «поехать» при обновлении
# базового образа. 1001 совпадает с uid daniil на resurs — это и делает
# bind mount ./data доступным на запись с обеих сторон. uid 1000 в oven/bun
# уже занят пользователем bun.
RUN groupadd --gid 1001 app \
 && useradd --uid 1001 --gid 1001 --create-home --shell /bin/sh app

# Рантайму нужны ровно четыре вещи:
#   node_modules  — prod-зависимости
#   dist          — собранный фронт: express.static(join(process.cwd(),"dist"))
#   server        — исходники на TS, их исполняет bun
#   package.json  — "type": "module" и резолв пакетов
# Остальное (src/, vite.config.ts, tsconfig, public/, README) нужно только
# сборке. Ни один файл вне server/ и dist/ в рантайме не читается.
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build     --chown=app:app /app/dist         ./dist
COPY --chown=app:app server       ./server
COPY --chown=app:app package.json ./package.json

# Два каталога, в которые приложение пишет:
#   /app/tmp — server/services/xlsxService.ts складывает .xlsx перед отправкой
#              в MAX и удаляет после. Под non-root каталог обязан существовать
#              и принадлежать app, иначе выгрузка падает на EACCES.
#   /app/server/data — точка монтирования данных (SQLite).
RUN install -d -o app -g app -m 0755 /app/tmp /app/server/data

USER app
EXPOSE 3000

# Живость. У tabel "/" редиректит на /login (3xx), у zayavki "/" отдаёт статику
# и возвращает 200. Порог <500 сохранён как у tabel: важно, что сервер отвечает.
# fetch встроен в Bun — отдельный curl/wget в образ ставить не нужно.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# Прямой запуск вместо `bun run start`: на один процесс-обёртку меньше,
# SIGTERM от `docker stop` доходит до сервера без посредника.
CMD ["bun", "server/index.ts"]
