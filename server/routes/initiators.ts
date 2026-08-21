// Публичный справочник инициаторов заявки (/api/initiators).
// Форма заявки на «/» открыта без авторизации, поэтому GET намеренно публичный
// и отдаёт ТОЛЬКО активные записи. Управление справочником — в /api/gsm/initiators
// под правом initiators.manage.

import { Router, type Request, type Response } from "express";
import * as initiators from "../repo/initiators";

export const initiatorsRouter = Router();

initiatorsRouter.get(
  "/api/initiators",
  (_req: Request, res: Response): void => {
    res
      .status(200)
      .json({ initiators: initiators.list({ includeArchived: false }) });
  },
);
