import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GanttPage } from './GanttPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GanttPage />
  </StrictMode>,
);
