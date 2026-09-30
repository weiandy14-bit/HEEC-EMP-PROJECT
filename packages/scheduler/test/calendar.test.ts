import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWorking,
  subtractWorking,
  workingMinutesBetween,
  countWorkingDays,
  snapForward,
  snapBackward,
} from '../src/index.ts';
import { standardCalendar, taipei, fromTaipei, DAY, HOUR } from './helpers.ts';

const cal = standardCalendar();

test('snapForward：非工作時間對齊至下一工作瞬間', () => {
  // 週六 → 下週一 09:00
  assert.equal(fromTaipei(snapForward(taipei('2027-01-09T10:00'), cal)), '2027-01-11 09:00');
  // 午休 12:30 → 13:00
  assert.equal(fromTaipei(snapForward(taipei('2027-01-04T12:30'), cal)), '2027-01-04 13:00');
  // 已在工作時段 → 原值
  assert.equal(fromTaipei(snapForward(taipei('2027-01-04T10:00'), cal)), '2027-01-04 10:00');
  // 窗結束邊界 12:00 非工作（半開）→ 13:00
  assert.equal(fromTaipei(snapForward(taipei('2027-01-04T12:00'), cal)), '2027-01-04 13:00');
});

test('snapBackward：對齊至前一工作結束邊界', () => {
  // 週六 10:00 → 前一工作結束邊界 週五 18:00
  assert.equal(fromTaipei(snapBackward(taipei('2027-01-09T10:00'), cal)), '2027-01-08 18:00');
  // 午休 12:30 → 12:00（上午時段結束）
  assert.equal(fromTaipei(snapBackward(taipei('2027-01-04T12:30'), cal)), '2027-01-04 12:00');
  // 工作結束邊界 18:00 → 原值（半開區間右端為有效完成邊界）
  assert.equal(fromTaipei(snapBackward(taipei('2027-01-04T18:00'), cal)), '2027-01-04 18:00');
  // 週一 09:00（一週工作起點）→ 前一工作結束邊界 上週五 18:00
  assert.equal(fromTaipei(snapBackward(taipei('2027-01-11T09:00'), cal)), '2027-01-08 18:00');
});

test('addWorking：跨午休與週末', () => {
  // 週一 09:00 + 8h = 週一 18:00
  assert.equal(fromTaipei(addWorking(taipei('2027-01-04T09:00'), DAY, cal)), '2027-01-04 18:00');
  // 週一 09:00 + 4h：09-12(3h)=180，剩 60 於 13:00 起 → 14:00
  assert.equal(fromTaipei(addWorking(taipei('2027-01-04T09:00'), 4 * HOUR, cal)), '2027-01-04 14:00');
  // 週五 17:00 + 2h：17-18(60)，剩 60 → 下週一 10:00
  assert.equal(fromTaipei(addWorking(taipei('2027-01-08T17:00'), 2 * HOUR, cal)), '2027-01-11 10:00');
});

test('addWorking：0 分回傳對齊後之工作瞬間', () => {
  assert.equal(fromTaipei(addWorking(taipei('2027-01-09T00:00'), 0, cal)), '2027-01-11 09:00');
});

test('subtractWorking：跨午休與週末反推', () => {
  // 週一 18:00 − 8h = 週一 09:00
  assert.equal(fromTaipei(subtractWorking(taipei('2027-01-04T18:00'), DAY, cal)), '2027-01-04 09:00');
  // 週一 14:00 − 4h：13-14(60)、09-12(180) 共 240 → 週一 09:00
  assert.equal(fromTaipei(subtractWorking(taipei('2027-01-04T14:00'), 4 * HOUR, cal)), '2027-01-04 09:00');
  // 週一 10:00 − 2h：09-10(60)，剩 60 → 上週五 17:00
  assert.equal(fromTaipei(subtractWorking(taipei('2027-01-11T10:00'), 2 * HOUR, cal)), '2027-01-08 17:00');
});

test('addWorking / subtractWorking 互為逆（工作邊界上）', () => {
  const start = taipei('2027-01-04T09:00');
  const finish = addWorking(start, 3 * DAY, cal);
  assert.equal(subtractWorking(finish, 3 * DAY, cal), start);
});

test('workingMinutesBetween：僅計工作時段', () => {
  // 週一 09:00 → 週二 09:00 = 一個工作日 = 480
  assert.equal(workingMinutesBetween(taipei('2027-01-04T09:00'), taipei('2027-01-05T09:00'), cal), DAY);
  // 週五 09:00 → 下週一 09:00 = 一個工作日（週末不計）
  assert.equal(workingMinutesBetween(taipei('2027-01-08T09:00'), taipei('2027-01-11T09:00'), cal), DAY);
});

test('假日例外：availableMinutes=0 視為非工作日', () => {
  const c = standardCalendar('CALH', [{ localDate: '2027-01-04', availableMinutes: 0 }]);
  // 週一為假日 → addWorking 從週二 09:00 起算
  assert.equal(fromTaipei(addWorking(taipei('2027-01-04T09:00'), DAY, c)), '2027-01-05 18:00');
});

test('countWorkingDays：跨週僅計工作日', () => {
  // 週一 → 次週一：一~五 + 次週一 = 6 個工作日
  assert.equal(countWorkingDays(taipei('2027-01-04T09:00'), taipei('2027-01-11T09:30'), cal), 6);
});
