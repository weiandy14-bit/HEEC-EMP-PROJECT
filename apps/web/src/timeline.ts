import type { Zoom } from './types';
const DAY = 86400000, OFFSET = 8 * 3600000;
export function timelineDomain(times: number[], from?: string, to?: string) {
  const finite = times.filter(Number.isFinite);
  const fallback = Date.now();
  const min = from ? Date.parse(`${from}T00:00:00+08:00`) : Math.floor((Math.min(...finite, fallback) + OFFSET) / DAY) * DAY - OFFSET;
  const max = to ? Date.parse(`${to}T00:00:00+08:00`) + DAY : Math.floor((Math.max(...finite, fallback) + OFFSET) / DAY) * DAY - OFFSET + DAY;
  return { min, max: Math.max(max, min + DAY), span: Math.max(max - min, DAY) };
}
export function timelineTicks(min: number, max: number, zoom: Zoom) {
  const wall = new Date(min + OFFSET);
  wall.setUTCHours(0,0,0,0);
  if (zoom === 'week') wall.setUTCDate(wall.getUTCDate() - (wall.getUTCDay() + 6) % 7);
  if (zoom === 'month') wall.setUTCDate(1);
  const ticks: { time: number; label: string }[] = [];
  for (let i = 0; i < 10000; i++) {
    const time = wall.getTime() - OFFSET;
    if (time >= max) break;
    if (time >= min) ticks.push({ time, label: wall.toISOString().slice(0, zoom === 'month' ? 7 : 10) });
    if (zoom === 'month') wall.setUTCMonth(wall.getUTCMonth() + 1);
    else wall.setUTCDate(wall.getUTCDate() + (zoom === 'week' ? 7 : 1));
  }
  return ticks;
}
