import "dotenv/config";
import express from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import { repairRouter } from "./routes/repair";

const app = express();
const PORT = process.env.PORT || 3005;

// Собранный фронт (vite build → dist)
const PUBLIC_DIR = join(process.cwd(), "dist");
const INDEX_HTML = join(PUBLIC_DIR, "index.html");

app.use(cors());
app.use(express.json());

// API
app.use(repairRouter);

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

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
