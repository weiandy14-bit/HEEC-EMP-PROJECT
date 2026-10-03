import { describe, it, expect } from 'vitest';
import { timelineDomain, timelineTicks } from '../timeline';
describe('Taipei timeline boundaries and calendar ticks', () => {
  it('explicit date range includes last date and uses Taipei midnight', () => {
    const d = timelineDomain([], '2027-01-04', '2027-01-08');
    expect(new Date(d.min).toISOString()).toBe('2027-01-03T16:00:00.000Z');
    expect(new Date(d.max).toISOString()).toBe('2027-01-08T16:00:00.000Z');
    expect(timelineTicks(d.min,d.max,'day').map(t=>t.label)).toEqual(['2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08']);
  });
  it('week ticks align Monday; month ticks follow true month lengths', () => {
    const d = timelineDomain([], '2027-01-01', '2027-03-31');
    const weeks = timelineTicks(d.min,d.max,'week');
    expect(weeks.every(t=>new Date(t.time+8*3600000).getUTCDay()===1)).toBe(true);
    expect(timelineTicks(d.min,d.max,'month').map(t=>t.label)).toEqual(['2027-01','2027-02','2027-03']);
  });
});
