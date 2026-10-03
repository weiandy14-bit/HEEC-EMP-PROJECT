import { DomainError } from '../common/errors';
const DAY = 86400000, OFFSET = 480*60000;
export function isoWeekStart(value: string): number {
 const m=/^(\d{4})-W(\d{2})$/.exec(value);
 if (!m) throw DomainError.validation('請輸入有效 ISO 週 YYYY-Www');
 const year=Number(m[1]), week=Number(m[2]);
 if(year<2000 || year>2100 || week<1 || week>53) throw DomainError.validation('週別超出 2000–2100 年或 1–53 週');
 const jan4=Date.UTC(year,0,4), dow=(new Date(jan4).getUTCDay()+6)%7;
 const start=jan4-dow*DAY+(week-1)*7*DAY;
 if(new Date(start+3*DAY).getUTCFullYear()!==year) throw DomainError.validation('該年度沒有第 53 週');
 return start-OFFSET;
}
