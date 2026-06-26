# Один образ: ставит зависимости, собирает фронт, запускает сервер.
FROM oven/bun:1.3.12-slim
WORKDIR /app

# зависимости (кешируется отдельным слоем)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# исходники + сборка фронта (vite build → dist)
COPY . .
RUN bun run build

EXPOSE 3005
CMD [ "bun", "run", "start" ]
