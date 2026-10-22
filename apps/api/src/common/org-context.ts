import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 請求範圍的組織脈絡（供 row-level security 執行期強制）。
 * 由 OrgContextMiddleware 於每個請求開頭建立空 store，守衛解析身分後填入 orgId，
 * DatabaseService 於 RLS_ENFORCE=1 時據此對每次查詢設定 app.current_org。
 * 以 AsyncLocalStorage 傳遞，無需逐層傳參，且跨 async 邊界保持。
 */
export interface OrgStore {
  orgId?: string;
}

export const orgContext = new AsyncLocalStorage<OrgStore>();

/** 目前請求的 orgId（無請求脈絡時為 undefined）。 */
export function currentOrgId(): string | undefined {
  return orgContext.getStore()?.orgId;
}

/** 是否啟用執行期 RLS 強制（正式環境以 app_rw 連線時開啟）。 */
export function rlsEnforced(): boolean {
  return process.env.RLS_ENFORCE === '1';
}
