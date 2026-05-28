# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app
# Копируем только то, что нужно для запуска vite preview
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
# Устанавливаем только продакшн зависимости (vite нужен для preview)
RUN npm install --omit=dev && npm install vite

EXPOSE 5173

# Запускаем vite preview на порту 5173, доступном извне контейнера
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
