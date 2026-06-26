import ExcelJS from "exceljs";
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const TMP_DIR = join(process.cwd(), "tmp");

interface Item {
  name: string;
  purpose: string;
  licensePlate: string;
  quantity: number;
  price?: number | string;
}

interface WebhookPayload {
  site: string;
  requestNo: string;
  requestDate: string;
  initiatorName: string;
  initiatorPosition: string;
  items: Item[];
}

const COLOR_HEADER_BG = "1F6B4A"; // тёмно-зелёный заголовок таблицы
const COLOR_ROW_BG   = "FFF9DC"; // светло-кремовые строки
const COLOR_WHITE    = "FFFFFF";
const COLOR_BLACK    = "000000";

const TOTAL_COLS = 6; // A–F

function borderAll(): Partial<ExcelJS.Borders> {
  const side: ExcelJS.BorderStyle = "thin";
  return {
    top: { style: side },
    left: { style: side },
    bottom: { style: side },
    right: { style: side },
  };
}

function applyBorder(row: ExcelJS.Row, from: number, to: number) {
  for (let c = from; c <= to; c++) {
    row.getCell(c).border = borderAll();
  }
}

export async function createXlsx(payload: WebhookPayload): Promise<string> {
  const { site, requestNo, requestDate, initiatorName, initiatorPosition, items } = payload;

  mkdirSync(TMP_DIR, { recursive: true });
  const filepath = join(TMP_DIR, `Заявка ${requestNo}.xlsx`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "amcake-webhook";
  const ws = wb.addWorksheet("Заявка");

  // ── Ширины колонок ────────────────────────────────────────────────────────
  ws.columns = [
    { key: "A", width: 5  },  // №
    { key: "B", width: 42 },  // Наименование
    { key: "C", width: 20 },  // Цель покупки
    { key: "D", width: 16 },  // Гос.номер ТС
    { key: "E", width: 10 },  // кол-во
    { key: "F", width: 16 },  // Цена за ед.
  ];

  const merge = (r: number, c1: string, c2: string) =>
    ws.mergeCells(`${c1}${r}:${c2}${r}`);

  // ── Шапка документа ───────────────────────────────────────────────────────
  // Строка 1: ООО «Ресурс»
  ws.addRow(["ООО «Ресурс»"]);
  ws.getRow(1).font = { name: "Arial", size: 11 };

  // Строка 2: пустая
  ws.addRow([]);

  // Строка 3: ЗАЯВКА №
  ws.addRow([`ЗАЯВКА № ${requestNo}`]);
  merge(3, "A", "F");
  const titleRow = ws.getRow(3);
  titleRow.font = { name: "Arial", size: 14, bold: true };
  titleRow.alignment = { horizontal: "center" };

  // Строка 4: подзаголовок
  ws.addRow(["на приобретение товарно-материальных ценностей (запчасти, спецодежда, инструмент, расходные материалы и т.д.)"]);
  merge(4, "A", "F");
  const subtitleRow = ws.getRow(4);
  subtitleRow.font = { name: "Arial", size: 10, italic: true };
  subtitleRow.alignment = { horizontal: "center", wrapText: true };

  // Строка 5: пустая
  ws.addRow([]);

  // Строки 6–8: мета-поля
  const metaStyle: Partial<ExcelJS.Font> = { name: "Arial", size: 11 };

  const r6 = ws.addRow(["Дата заказа:", "", requestDate]);
  r6.font = metaStyle;
  r6.getCell(1).font = { ...metaStyle, bold: true };
  merge(r6.number, "A", "B");

  const r7 = ws.addRow(["Подразделение / участок:", "", site]);
  r7.font = metaStyle;
  r7.getCell(1).font = { ...metaStyle, bold: true };
  merge(r7.number, "A", "B");

  const r8 = ws.addRow([
    "Инициатор заказа (должность, ФИО):",
    "",
    `${initiatorPosition} ${initiatorName}`,
  ]);
  r8.font = metaStyle;
  r8.getCell(1).font = { ...metaStyle, bold: true };
  merge(r8.number, "A", "B");
  merge(r8.number, "C", "F");

  // Строка 9: пустая
  ws.addRow([]);

  // ── Заголовок таблицы (строка 10) ─────────────────────────────────────────
  const tableHeader = ws.addRow([
    "№",
    "Наименование товара / услуги",
    "Цель покупки",
    "Гос.номер ТС",
    "кол-во",
    "Цена за ед., руб.",
  ]);
  tableHeader.eachCell((cell) => {
    cell.font      = { name: "Arial", size: 11, bold: true, color: { argb: `FF${COLOR_WHITE}` } };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLOR_HEADER_BG}` } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border    = borderAll();
  });
  tableHeader.height = 32;

  // ── Строки товаров ────────────────────────────────────────────────────────
  const totalRows = Math.max(items.length, 10); // минимум 10 строк как в шаблоне

  for (let i = 0; i < totalRows; i++) {
    const item = items[i];
    const dataRow = ws.addRow(
      item
        ? [i + 1, item.name, item.purpose, item.licensePlate, item.quantity, item.price ?? ""]
        : ["", "", "", "", "", ""]
    );
    dataRow.height = 28;
    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font      = { name: "Arial", size: 11 };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLOR_ROW_BG}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border    = borderAll();
    });
    // № и кол-во — по центру
    dataRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    dataRow.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
  }

  // ── Подписи ───────────────────────────────────────────────────────────────
  const signStyle: Partial<ExcelJS.Font> = { name: "Arial", size: 11 };
  const boldSign: Partial<ExcelJS.Font>  = { ...signStyle, bold: true };

  ws.addRow([]);

  const addSignRow = (label: string, value: string) => {
    const r = ws.addRow([label, "", "", "", value]);
    r.getCell(1).font = boldSign;
    r.getCell(5).font = signStyle;
    merge(r.number, "A", "B");
    merge(r.number, "E", "F");
    ws.addRow([]); // отступ между подписями
  };

  addSignRow("Заказчик (инициатор):", `${initiatorPosition} ${initiatorName}`);
  addSignRow("Согласовано:", "");
  addSignRow("Главный механик:", "Коржавов А.Б.");
  addSignRow("Главный инженер:", "Топольницкий А.М.");

  // ── Настройки печати ──────────────────────────────────────────────────────
  ws.pageSetup = {
    paperSize: 9,          // A4
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };

  await wb.xlsx.writeFile(filepath);
  console.log(`[xlsx] saved → ${filepath}`);
  return filepath;
}

export function deleteXlsx(filepath: string): void {
  try {
    unlinkSync(filepath);
    console.log(`[xlsx] deleted → ${filepath}`);
  } catch (e) {
    console.warn(`[xlsx] delete failed: ${e}`);
  }
}
