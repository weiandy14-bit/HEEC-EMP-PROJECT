import { useState } from 'react';
import { GanttPage } from './GanttPage';
import { WorkloadPage } from './WorkloadPage';

type Page = 'gantt' | 'workload';

export function App() {
  const [page, setPage] = useState<Page>('gantt');
  return (
    <div className="app-root">
      <nav className="app-nav" aria-label="主選單">
        <button type="button" data-testid="nav-gantt" aria-pressed={page === 'gantt'} onClick={() => setPage('gantt')}>專案總控甘特</button>
        <button type="button" data-testid="nav-workload" aria-pressed={page === 'workload'} onClick={() => setPage('workload')}>工程師四週負荷</button>
      </nav>
      {page === 'gantt' ? <GanttPage /> : <WorkloadPage />}
    </div>
  );
}
