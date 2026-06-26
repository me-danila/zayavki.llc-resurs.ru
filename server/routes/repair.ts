import { Router, Request, Response } from "express";
import { createXlsx, deleteXlsx } from "../services/xlsxService";
import { sendToMax } from "../services/maxService";

export const repairRouter = Router();

repairRouter.post("/repair", async (req: Request, res: Response) => {
  console.log("[webhook] /repair →", JSON.stringify(req.body, null, 2));

  const payload = req.body;

  if (!payload?.requestNo || !payload?.items?.length) {
    console.warn("[webhook] invalid payload");
    res.status(400).json({ ok: false, error: "missing requestNo or items" });
    return;
  }

  // Отвечаем сразу — пользователь не ждёт загрузку в MAX
  res.status(202).json({ ok: true, file: `Заявка ${payload.requestNo}.xlsx` });

  // Генерация xlsx + отправка в MAX идут в фоне
  void (async () => {
    let xlsxPath: string | undefined;
    try {
      xlsxPath = await createXlsx(payload);
      await sendToMax(xlsxPath, payload.requestNo);
    } catch (err) {
      console.error(`[webhook] фоновая обработка заявки ${payload.requestNo} упала:`, err);
    } finally {
      if (xlsxPath) deleteXlsx(xlsxPath);
    }
  })();
});