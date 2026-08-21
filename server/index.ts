import "dotenv/config";
import express from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import { repairRouter } from "./routes/repair";
import { gsmRouter } from "./routes/gsm";
import { initiatorsRouter } from "./routes/initiators";
import { attachUser } from "./auth/middleware";
import { authRouter } from "./auth/routes";
import { bootstrapSuperadmin } from "./auth/superadmin";

const app = express();
const PORT = process.env.PORT || 3005;

// За nginx (HTTPS-терминатор) — доверяем первому прокси: корректные req.ip и Secure-cookie.
app.set("trust proxy", 1);

// Собранный фронт (vite build → dist)
const PUBLIC_DIR = join(process.cwd(), "dist");
const INDEX_HTML = join(PUBLIC_DIR, "index.html");

// CORS сужаем: фронт ГСМ и API — один origin, для /api/gsm cross-origin не нужен,
// поэтому cors намеренно НЕ применяется к /api/gsm. Для остального (вебхуки /repair,
// статика) сохраняем прежнее поведение.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/gsm")) return next();
  return cors()(req, res, next);
});

app.use(express.json());

// Сессия ГСМ: вешаем чтение пользователя на всю ветку /api/gsm (включая /login —
// attachUser ничего не блокирует). Гарды (requireAuth/requireManager) — на самих роутах.
app.use("/api/gsm", attachUser);

// API авторизации ГСМ (login/logout/me) — ПЕРЕД статикой.
app.use(authRouter);

// API
app.use(repairRouter);
app.use(gsmRouter);
app.use(initiatorsRouter);

// Статика фронта
app.use(express.static(PUBLIC_DIR));

// SPA-fallback: любой остальной GET → index.html
app.get(/.*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  if (existsSync(INDEX_HTML)) {
    res.sendFile(INDEX_HTML);
  } else {
    res
      .status(500)
      .send("Фронт не собран. Запустите: bun run build (vite build → dist).");
  }
});

// Аккаунт супер-админа из .env: идемпотентно при каждом старте (см. auth/superadmin.ts).
await bootstrapSuperadmin();

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
