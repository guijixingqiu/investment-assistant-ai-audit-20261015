import type { WebApiAuth } from "./apiClient.js";
import { DEFAULT_AUTH_HEADER_NAME, DEFAULT_CANDIDATE_READ_AUTH_HEADER_NAME, DEFAULT_CANDIDATE_WRITE_AUTH_HEADER_NAME } from "./config.js";
import { input } from "./view.js";

export function auth(): WebApiAuth | null {
  return inputAuth("auth-header-name", "auth-token", DEFAULT_AUTH_HEADER_NAME);
}

export function candidateReadAuth(): WebApiAuth | null {
  return inputAuth("membership-read-header-name", "membership-read-token", DEFAULT_CANDIDATE_READ_AUTH_HEADER_NAME) ?? auth();
}

export function candidateWriteAuth(): WebApiAuth | null {
  return inputAuth("membership-write-header-name", "membership-write-token", DEFAULT_CANDIDATE_WRITE_AUTH_HEADER_NAME);
}

function inputAuth(headerInputId: string, tokenInputId: string, defaultHeaderName: string): WebApiAuth | null {
  const headerName = input(headerInputId).value.trim() || defaultHeaderName;
  const token = input(tokenInputId).value.trim();
  return token.length === 0 ? null : { headerName, token };
}

export const LOCAL_TOKEN_FILE_INPUT_ID = "local-token-file";
export const LOCAL_TOKEN_FILE_STATUS_ID = "local-token-file-status";

const LOCAL_TOKEN_MAX_BYTES = 16 * 1024;
const LOCAL_TOKEN_HEADER_NAME = "x-internal-token";
const LOCAL_TOKEN_TOKEN_INPUT_IDS = ["auth-token", "membership-read-token", "membership-write-token"] as const;
const LOCAL_TOKEN_HEADER_INPUT_IDS = ["auth-header-name", "membership-read-header-name", "membership-write-header-name"] as const;

let localTokenFileApplyId = 0;

/** Recognizes the existing local runtime token envelope; the server still verifies its signature. */
export function localTokenFromFileText(text: string): string | null {
  const token = text.trim();
  return /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function bindLocalTokenFileInput(documentRef: Document, authorizationChanged: () => void): void {
  documentRef.getElementById(LOCAL_TOKEN_FILE_INPUT_ID)?.addEventListener("change", (event) => {
    const chooser = event.currentTarget;
    if (!(chooser instanceof HTMLInputElement) || !chooser.files?.[0]) return;
    void applyLocalTokenFile(documentRef, chooser.files[0], authorizationChanged).finally(() => { chooser.value = ""; });
  });
}

/** Fills the six existing runtime auth inputs in memory from one explicitly chosen local file. */
export async function applyLocalTokenFile(documentRef: Document, file: Blob, authorizationChanged: () => void): Promise<void> {
  const applyId = ++localTokenFileApplyId;
  const fields = [...LOCAL_TOKEN_TOKEN_INPUT_IDS, ...LOCAL_TOKEN_HEADER_INPUT_IDS].map((id) => localTokenField(documentRef, id));
  if (fields.some((field) => field === null)) {
    setLocalTokenStatus(documentRef, "页面缺少鉴权输入，未载入令牌文件。");
    return;
  }
  const inputs = fields as { value: string }[];
  const before = inputs.map((field) => field.value);
  if (file.size === 0 || file.size > LOCAL_TOKEN_MAX_BYTES) {
    setLocalTokenStatus(documentRef, `未载入令牌文件：需要 1 字节至 16 KiB 的单行令牌文本，该文件为 ${file.size} 字节。`);
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    if (applyId === localTokenFileApplyId) setLocalTokenStatus(documentRef, "未载入令牌文件：读取失败，当前凭据保持不变。");
    return;
  }
  if (applyId !== localTokenFileApplyId) return;
  if (inputs.some((field, index) => field.value !== before[index])) {
    setLocalTokenStatus(documentRef, "未载入令牌文件：读取期间鉴权输入已被修改，本次不覆盖较新的输入。");
    return;
  }
  const token = localTokenFromFileText(text);
  if (token === null) {
    setLocalTokenStatus(documentRef, "未载入令牌文件：请选择本机启动器生成的令牌文件，当前凭据保持不变。");
    return;
  }
  for (const [index, field] of inputs.entries()) field.value = index < LOCAL_TOKEN_TOKEN_INPUT_IDS.length ? token : LOCAL_TOKEN_HEADER_NAME;
  setLocalTokenStatus(documentRef, "已载入本机访问凭据，请点击“读取”。凭据仅保存在本页内存，刷新页面即清空。");
  authorizationChanged();
}

function localTokenField(documentRef: Document, id: string): { value: string } | null {
  const element = documentRef.getElementById(id) as unknown as { value: string } | null;
  return element && typeof element.value === "string" ? element : null;
}

function setLocalTokenStatus(documentRef: Document, message: string): void {
  const status = documentRef.getElementById(LOCAL_TOKEN_FILE_STATUS_ID);
  if (status) status.textContent = message;
}
