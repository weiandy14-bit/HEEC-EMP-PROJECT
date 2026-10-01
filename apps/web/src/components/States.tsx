import type { ReactNode } from 'react';

/** U1 載入：骨架（不閃爍空白、不阻塞版面）。 */
export function LoadingState() {
  return (
    <div data-testid="state-loading" role="status" aria-live="polite" className="state state-loading">
      <span className="sr-only">載入中…</span>
      <div className="skeleton-row" aria-hidden="true" />
      <div className="skeleton-row" aria-hidden="true" />
      <div className="skeleton-row" aria-hidden="true" />
    </div>
  );
}

/** U2 空：查詢成功但無資料的引導（非錯誤樣式）。 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div data-testid="state-empty" className="state state-empty">
      <p>{message}</p>
    </div>
  );
}

/** U3 錯誤：顯示錯誤與重試。 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="state-error" role="alert" className="state state-error">
      <p>發生錯誤：{message}</p>
      <button type="button" onClick={onRetry}>重試</button>
    </div>
  );
}

/** U4 無權限：明確訊息、不洩資源存在性。 */
export function NoPermissionState() {
  return (
    <div data-testid="state-no-permission" role="alert" className="state state-forbidden">
      <p>無權限檢視此資料。如需存取請洽專案管理者。</p>
    </div>
  );
}

/** U5 部分資料：失敗區塊佔位標示，其餘正常呈現。 */
export function PartialBanner({ failedCount }: { failedCount: number }) {
  return (
    <div data-testid="state-partial" role="status" className="state state-partial">
      <p>部分案件資料暫時無法載入（{failedCount}），已以佔位顯示；其餘正常。</p>
    </div>
  );
}

export function StateFrame({ children }: { children: ReactNode }) {
  return <div className="state-frame">{children}</div>;
}
