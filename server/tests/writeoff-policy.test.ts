import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';

// Импорты БД выполняются только после выбора изолированной временной базы.
const directory = mkdtempSync(join(tmpdir(), 'gsm-writeoff-policy-'));
const previousPath = process.env.GSM_DB_PATH;
process.env.GSM_DB_PATH = join(directory, 'test.db');
const { db, bootstrap } = await import('../db');
const sites = await import('../repo/sites');
const sessions = await import('../repo/sessions');
const { gsmRouter } = await import('../routes/gsm');
const { attachUser } = await import('../auth/middleware');
const { todayMsk } = await import('../lib/dates');
const { WriteOffSchema } = await import('../../src/lib/gsmSchemas');

let server: Server;
let base: string;
let managerCookie: string;
let workerCookie: string;
let adminCookie: string;
let siteId: number;
let otherSiteId: number;
let receiptId: number;
const today = todayMsk();
const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);

const row = (date: string) => ({ date, licensePlate: 'А123АА', amount: 1, reason: 'Работа' });
const count = () => db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM writeoffs').get()!.n;
const request = (path: string, cookie?: string, method = 'GET', body?: unknown) => fetch(`${base}/api/gsm${path}`, {
  method,
  headers: { ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  const available = sites.list();
  siteId = available[0].id;
  otherSiteId = available[1].id;
  const insertUser = (username: string, role: string, site: number | null) => Number(db.run(
    'INSERT INTO users (username, password_hash, role, site_id) VALUES (?, ?, ?, ?)',
    [username, 'unused', role, site],
  ).lastInsertRowid);
  const manager = insertUser('manager', 'manager', null);
  const worker = insertUser('worker', 'worker', siteId);
  const admin = insertUser('admin', 'superadmin', null);
  db.run('INSERT INTO user_sites (user_id, site_id) VALUES (?, ?)', [manager, siteId]);
  managerCookie = `gsm_sid=${sessions.create(manager).token}`;
  workerCookie = `gsm_sid=${sessions.create(worker).token}`;
  adminCookie = `gsm_sid=${sessions.create(admin).token}`;
  receiptId = Number(db.run(
    'INSERT INTO receipts (site_id, name, code, qty_initial, received_date, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [siteId, 'Масло', 'test', 1000, yesterday, manager],
  ).lastInsertRowid);
  const app = express();
  app.use(express.json(), attachUser, gsmRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  if (previousPath === undefined) delete process.env.GSM_DB_PATH;
  else process.env.GSM_DB_PATH = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

test('по умолчанию прошлые даты разрешены; менеджер видит только свои настройки', async () => {
  expect(sites.getById(siteId)?.allowBackdatedWriteoffs).toBe(true);
  const response = await request('/sites', managerCookie);
  const body = await response.json();
  expect(body.sites.map((s: { id: number }) => s.id)).toEqual([siteId]);
  expect(body.sites[0].allowBackdatedWriteoffs).toBe(true);
  expect((await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', { rows: [row(yesterday)] })).status).toBe(201);
});

test('изменение настройки требует менеджера и доступа к участку; тело строго boolean', async () => {
  const path = `/sites/${siteId}/writeoff-policy`;
  expect((await request(path, undefined, 'PATCH', { allowBackdatedWriteoffs: false })).status).toBe(401);
  expect((await request(path, workerCookie, 'PATCH', { allowBackdatedWriteoffs: false })).status).toBe(403);
  expect((await request(`/sites/${otherSiteId}/writeoff-policy`, managerCookie, 'PATCH', { allowBackdatedWriteoffs: false })).status).toBe(404);
  for (const value of ['false', 0, null, undefined]) {
    expect((await request(path, managerCookie, 'PATCH', { allowBackdatedWriteoffs: value })).status).toBe(400);
  }
  expect(sites.getById(siteId)?.allowBackdatedWriteoffs).toBe(true);
  expect((await request(path, managerCookie, 'PATCH', { allowBackdatedWriteoffs: false })).status).toBe(204);
  expect(sites.getById(siteId)?.allowBackdatedWriteoffs).toBe(false);
  expect(sites.getById(otherSiteId)?.allowBackdatedWriteoffs).toBe(true);
});

test('запрет действует в старой сессии; вся серия откатывается; сегодня разрешено', async () => {
  const before = count();
  const response = await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', {
    rows: [row(today), row(yesterday)], allowBackdatedWriteoffs: true,
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'backdating_forbidden' });
  expect(count()).toBe(before);
  expect((await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', { rows: [row(today)] })).status).toBe(201);
  const active = await (await request('/sites/active', workerCookie)).json();
  expect(active.sites[0].allowBackdatedWriteoffs).toBe(false);
});

test('супер-админ может вернуть разрешение; диапазон дат и остаток сохраняются', async () => {
  expect((await request(`/sites/${siteId}/writeoff-policy`, adminCookie, 'PATCH', { allowBackdatedWriteoffs: true })).status).toBe(204);
  expect((await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', { rows: [row(yesterday)] })).status).toBe(201);
  for (const date of ['2000-01-01', '2999-01-01', '2026-02-30']) {
    expect((await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', { rows: [row(date)] })).status).toBe(400);
  }
  expect((await request(`/lots/${receiptId}/writeoffs`, workerCookie, 'POST', { rows: [{ ...row(today), amount: 2000 }] })).status).toBe(409);
});

test('клиентская схема учитывает запрет и разрешение', () => {
  const lot = { id: receiptId, siteId, siteName: 'Участок', name: 'Масло', code: 'test', unit: 'л', initialQty: 1000, balance: 900, receivedDate: yesterday, author: { username: 'manager', displayName: null } };
  const values = (date: string) => ({ rows: [{ date, plate: 'А123АА', amount: 1, reason: 'Работа' }] });
  expect(WriteOffSchema(lot, false).safeParse(values(yesterday)).success).toBe(false);
  expect(WriteOffSchema(lot, false).safeParse(values(today)).success).toBe(true);
  expect(WriteOffSchema(lot, true).safeParse(values(yesterday)).success).toBe(true);
});

test('миграция v8 сохраняет данные и не возвращает отозванные права; повторный запуск сохраняет запрет', () => {
  const before = count();
  db.exec('ALTER TABLE sites DROP COLUMN allow_backdated_writeoffs');
  db.exec('PRAGMA user_version = 8');
  bootstrap();
  expect(sites.getById(siteId)?.allowBackdatedWriteoffs).toBe(true);
  expect(count()).toBe(before);
  expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM user_permissions').get()!.n).toBe(0);
  sites.setAllowBackdatedWriteoffs(siteId, false);
  bootstrap();
  expect(sites.getById(siteId)?.allowBackdatedWriteoffs).toBe(false);
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
});
