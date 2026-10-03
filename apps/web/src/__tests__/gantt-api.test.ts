import { afterEach, expect, it, vi } from 'vitest';
import { fetchGantt } from '../api';
afterEach(() => vi.unstubAllGlobals());
it('sends engineer/project/status and inclusive Taipei dates as UTC-compatible bounds', async () => {
  const fetch = vi.fn().mockResolvedValue({status:200,json:async()=>({projects:[]})});
  vi.stubGlobal('fetch',fetch);
  await fetchGantt({zoom:'week',project_id:'p1',resource_id:'r1',status:'planning',from:'2027-01-04',to:'2027-01-08'});
  const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
  expect(url.searchParams.get('from')).toBe('2027-01-04T00:00:00+08:00');
  expect(url.searchParams.get('to')).toBe('2027-01-08T16:00:00.000Z');
  expect(url.searchParams.get('resource_id')).toBe('r1');
  expect(url.searchParams.get('project_id')).toBe('p1');
  expect(url.searchParams.get('status')).toBe('planning');
});
