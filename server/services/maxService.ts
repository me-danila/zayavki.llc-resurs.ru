import { readFileSync } from "fs";
import { basename } from "path";

const BASE_URL = "https://platform-api.max.ru";
const TOKEN = process.env.MAX_TOKEN!;
const CHAT_ID = process.env.MAX_CHAT_ID!;

const authHeader = { Authorization: TOKEN };

async function getUploadUrl(): Promise<string> {
  const res = await fetch(`${BASE_URL}/uploads?type=file`, {
    method: "POST",
    headers: authHeader,
  });
  if (!res.ok) throw new Error(`[max] getUploadUrl failed: ${res.status} ${await res.text()}`);
  const { url } = (await res.json()) as { url: string };
  console.log(`[max] upload url received`);
  return url;
}

async function uploadFile(filepath: string, uploadUrl: string): Promise<string> {
  const fileData = readFileSync(filepath);
  const filename = basename(filepath);

  const formData = new FormData();
  formData.append("data", new Blob([fileData]), filename);

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: authHeader,
    body: formData,
  });
  if (!res.ok) throw new Error(`[max] uploadFile failed: ${res.status} ${await res.text()}`);

  const { token } = (await res.json()) as { token: string };
  console.log(`[max] file uploaded, token received`);
  return token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendMessage(text: string, fileToken: string): Promise<void> {
  const body = {
    text,
    attachments: [{ type: "file", payload: { token: fileToken } }],
  };

  // MAX обрабатывает файл асинхронно — ждём перед первой попыткой
  await sleep(5000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      const delay = attempt * 2000;
      console.log(`[max] retry ${attempt} after ${delay}ms...`);
      await sleep(delay);
    }

    const res = await fetch(`${BASE_URL}/messages?chat_id=${CHAT_ID}`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      console.log("[max] message sent successfully");
      return;
    }

    const errBody = await res.text();
    console.error(`[max] sendMessage attempt ${attempt} failed: ${res.status}`, errBody);

    if (attempt === 3) {
      throw new Error(`[max] sendMessage failed after 3 attempts: ${res.status} ${errBody}`);
    }
  }
}

export async function sendToMax(filepath: string, orderNumber: unknown): Promise<void> {
  console.log(`[max] uploading file: ${filepath}`);
  const uploadUrl = await getUploadUrl();
  const fileToken = await uploadFile(filepath, uploadUrl);
  await sendMessage(`Новая заявка №${orderNumber}`, fileToken);
}