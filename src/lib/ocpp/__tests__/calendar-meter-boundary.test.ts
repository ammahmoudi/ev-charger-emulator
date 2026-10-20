import {afterEach,describe,expect,it,vi} from 'vitest';
import {calendarMeterBoundary} from '../calendar-meter-boundary';
describe('scheduled real-clock model observation',()=>{
 afterEach(()=>vi.useRealTimers());
 it('integrates only through exact T once, then permits the later periodic remainder',async()=>{
  vi.useFakeTimers();const start=Date.parse('2026-10-20T22:59:59.000Z'),t=start+1000;
  vi.setSystemTime(start);
  const observations:number[]=[];
  const boundary=calendarMeterBoundary(new Date(t).toISOString(),start,async at=>{expect(Date.now()).toBeGreaterThanOrEqual(at);observations.push(at);});
  await boundary.flush();expect(observations).toEqual([]);
  await vi.advanceTimersByTimeAsync(1000);await Promise.all([boundary.flush(),boundary.flush()]);
  expect(observations).toEqual([t]);
  // Continuous18kW model: real energy through T is exactly5Wh,
  // not energy through the later arrival/readback time.
  const energyAt=(at:number)=>(18000/3600)*((at-start)/1000);
  expect(energyAt(observations[0]!)).toBe(5);
  await vi.advanceTimersByTimeAsync(250);expect(energyAt(Date.now())-energyAt(t)).toBe(1.25);
  boundary.close();
 });
 it('keeps failed measurement delivery unknown and never retries it as a new event',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T22:59:59Z'));
  const send=vi.fn().mockRejectedValue(Error('actual wire failed'));
  const b=calendarMeterBoundary('2026-10-20T23:00:00.000Z',Date.now(),send);
  await vi.advanceTimersByTimeAsync(1000);await expect(b.flush()).rejects.toThrow('actual wire failed');expect(send).toHaveBeenCalledOnce();b.close();
 });
 it('disposes the scheduled observation when the real transaction ends first',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T22:59:59Z'));const send=vi.fn();
  const b=calendarMeterBoundary('2026-10-20T23:00:00.000Z',Date.now(),send);b.close();await vi.advanceTimersByTimeAsync(2000);await b.flush();expect(send).not.toHaveBeenCalled();
 });
 it('refuses already-past/future-forged/overlong timestamps and leaves normal mode alone',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-20T22:59:59Z'));
  for(const at of ['2026-10-20T22:59:58.000Z','2026-10-20T23:30:00.000Z','2026-10-20T23:00:00.001Z','invalid'])expect(()=>calendarMeterBoundary(at,Date.now(),async()=>{})).toThrow();
  const send=vi.fn();const b=calendarMeterBoundary(undefined,Date.now(),send);await b.flush();expect(send).not.toHaveBeenCalled();b.close();
 });
});
