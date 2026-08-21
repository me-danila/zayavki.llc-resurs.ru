// Выгрузка журнала расхода штучных материалов в xlsx (v6).
// Отдаём буфером, а не файлом на диске: выгрузка небольшая и одноразовая,
// временные файлы чистить не нужно (в отличие от xlsxService для заявок).
// Отменённые строки не выбрасываем — помечаем и перечёркиваем, чтобы
// выгрузка совпадала с тем, что менеджер видит на экране.

import ExcelJS from "exceljs";
import type { PartIssue } from "../repo/types";

const COLOR_HEADER_BG = "1F6B4A"; // тот же тёмно-зелёный, что в заявках
const COLOR_WHITE = "FFFFFF";

const COLUMNS: Array<{ header: string; key: keyof PartIssue | "author"; width: number }> = [
  { header: "Дата", key: "issueDate", width: 12 },
  { header: "Участок", key: "siteName", width: 16 },
  { header: "Номер детали", key: "partNumber", width: 20 },
  { header: "Комментарий", key: "comment", width: 30 },
  { header: "Наименование", key: "name", width: 44 },
  { header: "Кол-во", key: "qty", width: 9 },
  { header: "Гос. номер", key: "licensePlate", width: 16 },
  { header: "Получил", key: "recipient", width: 26 },
  { header: "Внёс", key: "author", width: 26 },
];

export async function createPartIssuesXlsx(rows: PartIssue[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "zayavki-gsm";
  const ws = wb.addWorksheet("Расход материалов");

  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: COLOR_WHITE } };
  head.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR_HEADER_BG },
  };
  head.alignment = { vertical: "middle" };

  for (const r of rows) {
    const row = ws.addRow([
      r.issueDate,
      r.siteName,
      r.partNumber,
      r.comment ?? "",
      r.name,
      r.qty,
      r.licensePlate,
      r.recipient,
      r.author.displayName || r.author.username,
    ]);
    // Отменённые — серым и зачёркнутым: строка остаётся видимой, но явно нерабочая.
    if (r.voided) {
      row.font = { strike: true, color: { argb: "FF999999" } };
    }
  }

  ws.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
