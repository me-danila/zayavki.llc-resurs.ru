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

  const xlsxPath = await createXlsx(payload);

  try {
    await sendToMax(xlsxPath, payload.requestNo);
  } finally {
    deleteXlsx(xlsxPath);
  }

  res.status(200).json({ ok: true, file: `Заявка ${payload.requestNo}.xlsx` });
});