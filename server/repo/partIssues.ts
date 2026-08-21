// Репозиторий расхода штучных материалов (v6).
// Независим от ГСМ: ни партий, ни остатков, ни проверок на превышение — просто журнал.
//
// Значения ЭФФЕКТИВНЫЕ: действует последняя корректировка (part_issue_corrections),
// как в receipts/writeoffs. void-запись из выборок не исчезает — она нужна менеджеру
// в таблице зачёркнутой, поэтому отдаём её с флагом voided.
//
// Дату и участок сюда передаёт слой роутов из сессии/сервера — из тела запроса
// они не берутся никогда (канон §3.4).

import { db } from "../db";
import type { PartIssue } from "./types";

// Последняя корректировка записи pi (алиас pc). NULL-строка, если корректировок нет.
const CORR_JOIN = `
  LEFT JOIN part_issue_corrections pc ON pc.id = (
    SELECT MAX(c2.id) FROM part_issue_corrections c2
    WHERE c2.target_id = pi.id
  )`;

type Row = {
  id: number;
  site_id: number;
  site_name: string;
  issue_date: string;
  part_number: string;
  name: string;
  qty: number;
  license_plate: string;
  recipient: string;
  voided: number;
  created_by: number;
  author_username: string | null;
  author_display_name: string | null;
  corr_action: string | null;
  corr_at: string | null;
  corr_username: string | null;
  corr_display_name: string | null;
  orig_date: string;
  orig_part_number: string;
  orig_name: string;
  orig_qty: number;
  orig_license_plate: string;
  orig_recipient: string;
};

// SELECT с подстановкой эффективных значений: COALESCE(new_*, исходное).
// Исходные значения тоже отдаём — менеджеру нужно видеть «было → стало».
const SELECT = `
  SELECT pi.id,
         pi.site_id,
         s.name AS site_name,
         COALESCE(pc.new_date, pi.issue_date)                   AS issue_date,
         COALESCE(pc.new_part_number, pi.part_number)           AS part_number,
         COALESCE(pc.new_name, pi.name)                         AS name,
         COALESCE(pc.new_qty, pi.qty)                           AS qty,
         COALESCE(pc.new_license_plate, pi.license_plate)       AS license_plate,
         COALESCE(pc.new_recipient, pi.recipient)               AS recipient,
         CASE WHEN pc.action = 'void' THEN 1 ELSE 0 END         AS voided,
         pi.created_by,
         au.username     AS author_username,
         au.display_name AS author_display_name,
         pc.action       AS corr_action,
         pc.created_at   AS corr_at,
         cu.username     AS corr_username,
         cu.display_name AS corr_display_name,
         pi.issue_date    AS orig_date,
         pi.part_number   AS orig_part_number,
         pi.name          AS orig_name,
         pi.qty           AS orig_qty,
         pi.license_plate AS orig_license_plate,
         pi.recipient     AS orig_recipient
    FROM part_issues pi
    JOIN sites s ON s.id = pi.site_id
    LEFT JOIN users au ON au.id = pi.created_by
    ${CORR_JOIN}
    LEFT JOIN users cu ON cu.id = pc.created_by`;

function mapRow(r: Row): PartIssue {
  const issue: PartIssue = {
    id: r.id,
    siteId: r.site_id,
    siteName: r.site_name,
    issueDate: r.issue_date,
    partNumber: r.part_number,
    name: r.name,
    qty: r.qty,
    licensePlate: r.license_plate,
    recipient: r.recipient,
    voided: r.voided === 1,
    author: {
      username: r.author_username ?? "",
      displayName: r.author_display_name,
    },
  };
  if (r.corr_action) {
    issue.correction = {
      action: r.corr_action === "void" ? "void" : "edit",
      date: (r.corr_at ?? "").slice(0, 10),
      author: {
        username: r.corr_username ?? "",
        displayName: r.corr_display_name,
      },
      original: {
        issueDate: r.orig_date,
        partNumber: r.orig_part_number,
        name: r.orig_name,
        qty: r.orig_qty,
        licensePlate: r.orig_license_plate,
        recipient: r.orig_recipient,
      },
    };
  }
  return issue;
}

export type PartIssueInput = {
  partNumber: string;
  name: string;
  qty: number;
  licensePlate: string;
  recipient: string;
};

// Валидация одной строки. Пустые поля и нецелые/неположительные количества — мимо.
function isValidInput(r: PartIssueInput): boolean {
  return (
    r.partNumber.trim().length > 0 &&
    r.name.trim().length > 0 &&
    Number.isInteger(r.qty) &&
    r.qty > 0 &&
    r.licensePlate.trim().length > 0 &&
    r.recipient.trim().length > 0
  );
}

// Массовая вставка одной транзакцией: либо вся серия, либо ничего.
// issueDate и siteId приходят от сервера/сессии — тут уже не проверяются.
export function createMany(
  rows: PartIssueInput[],
  ctx: { siteId: number; issueDate: string; createdBy: number },
): { ok: true; created: number } | { ok: false; error: "invalid_row" } {
  if (!rows.length) return { ok: false, error: "invalid_row" };
  if (!rows.every(isValidInput)) return { ok: false, error: "invalid_row" };

  const ins = db.query<null, [number, string, string, string, number, string, string, number]>(
    `INSERT INTO part_issues
       (site_id, issue_date, part_number, name, qty, license_plate, recipient, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const r of rows) {
      ins.run(
        ctx.siteId,
        ctx.issueDate,
        r.partNumber.trim(),
        r.name.trim(),
        r.qty,
        r.licensePlate.trim(),
        r.recipient.trim(),
        ctx.createdBy,
      );
    }
  })();

  return { ok: true, created: rows.length };
}

export type ListFilter = {
  // null — без ограничения по участкам (супер-админ); [] — доступа нет ни к одному.
  siteIds: number[] | null;
  siteId?: number;
  dateFrom?: string;
  dateTo?: string;
  // Подстрока по номеру детали, наименованию, госномеру и получателю сразу.
  search?: string;
  licensePlate?: string;
  authorId?: number;
};

// Журнал по фильтру. Сортировка: свежие сверху (по эффективной дате, затем id).
export function list(filter: ListFilter): PartIssue[] {
  if (filter.siteIds !== null && filter.siteIds.length === 0) return [];

  const conds: string[] = [];
  const args: Array<string | number> = [];

  if (filter.siteIds !== null) {
    conds.push(`pi.site_id IN (${filter.siteIds.map(() => "?").join(",")})`);
    args.push(...filter.siteIds);
  }
  if (filter.siteId != null) {
    conds.push("pi.site_id = ?");
    args.push(filter.siteId);
  }
  // Фильтр по дате — по ЭФФЕКТИВНОЙ (с учётом правки менеджера).
  if (filter.dateFrom) {
    conds.push("COALESCE(pc.new_date, pi.issue_date) >= ?");
    args.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    conds.push("COALESCE(pc.new_date, pi.issue_date) <= ?");
    args.push(filter.dateTo);
  }
  if (filter.licensePlate) {
    conds.push("COALESCE(pc.new_license_plate, pi.license_plate) = ?");
    args.push(filter.licensePlate);
  }
  if (filter.authorId != null) {
    conds.push("pi.created_by = ?");
    args.push(filter.authorId);
  }
  if (filter.search) {
    const like = `%${filter.search.trim()}%`;
    conds.push(`(
      COALESCE(pc.new_part_number, pi.part_number) LIKE ? OR
      COALESCE(pc.new_name, pi.name) LIKE ? OR
      COALESCE(pc.new_license_plate, pi.license_plate) LIKE ? OR
      COALESCE(pc.new_recipient, pi.recipient) LIKE ?
    )`);
    args.push(like, like, like, like);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const sql = `${SELECT} ${where}
    ORDER BY COALESCE(pc.new_date, pi.issue_date) DESC, pi.id DESC`;

  return db.query<Row, Array<string | number>>(sql).all(...args).map(mapRow);
}

// Одна запись по id (для гардов области видимости в роутах).
export function getById(id: number): PartIssue | null {
  const row = db
    .query<Row, [number]>(`${SELECT} WHERE pi.id = ?`)
    .get(id);
  return row ? mapRow(row) : null;
}

export type CorrectionInput =
  | { action: "void" }
  | {
      action: "edit";
      issueDate?: string;
      partNumber?: string;
      name?: string;
      qty?: number;
      licensePlate?: string;
      recipient?: string;
    };

export type CorrectResult =
  | { ok: true; id: number }
  | { ok: false; error: "not_found" | "already_voided" | "invalid" };

// Корректировка записи менеджером. Как в ГСМ: никаких UPDATE — новая строка.
// action='edit' пишет снапшот ВСЕХ полей итогового состояния, поэтому выборке
// достаточно последней корректировки.
export function correct(
  id: number,
  input: CorrectionInput,
  managerId: number,
): CorrectResult {
  const current = getById(id);
  if (!current) return { ok: false, error: "not_found" };
  // После отмены запись мертва: дальнейшие корректировки запрещены.
  if (current.voided) return { ok: false, error: "already_voided" };

  if (input.action === "void") {
    const res = db
      .query<{ id: number }, [number, number]>(
        `INSERT INTO part_issue_corrections (target_id, action, created_by)
         VALUES (?, 'void', ?) RETURNING id`,
      )
      .get(id, managerId)!;
    return { ok: true, id: res.id };
  }

  // Снапшот: непереданные поля берём из текущего эффективного состояния.
  const issueDate = input.issueDate ?? current.issueDate;
  const partNumber = (input.partNumber ?? current.partNumber).trim();
  const name = (input.name ?? current.name).trim();
  const qty = input.qty ?? current.qty;
  const licensePlate = (input.licensePlate ?? current.licensePlate).trim();
  const recipient = (input.recipient ?? current.recipient).trim();

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(issueDate);
  if (
    !dateOk ||
    !partNumber ||
    !name ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    !licensePlate ||
    !recipient
  ) {
    return { ok: false, error: "invalid" };
  }

  const res = db
    .query<
      { id: number },
      [number, string, string, string, number, string, string, number]
    >(
      `INSERT INTO part_issue_corrections
         (target_id, action, new_date, new_part_number, new_name, new_qty, new_license_plate, new_recipient, created_by)
       VALUES (?, 'edit', ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(id, issueDate, partNumber, name, qty, licensePlate, recipient, managerId)!;
  return { ok: true, id: res.id };
}
