import{describe,it,expect}from'vitest';
import{waitAppSession}from'./cgp-app-session-clock';
describe('separate bounded APP idle and physical clocks',()=>{
 it('120seconds commissioning does not consume the actual300second physical budget',async()=>{
  let clock=0;const deadline:string[]=[];
  await waitAppSession({now:()=>clock,pause:async ms=>{clock+=ms;},idleSeconds:180,activeSeconds:300,onDeadline:k=>deadline.push(k),snapshot:()=>({startedAt:clock<120000?null:120000,ended:clock>=400000,stopConfirmed:clock>=400000,unexpected:false})});
  expect(clock).toBe(400000);expect(deadline).toEqual([]);
 });
 it('idle expiry remains failure even when cleanup confirms stop during grace',async()=>{
  let clock=0,notified=false;
  await expect(waitAppSession({now:()=>clock,pause:async ms=>{clock+=ms;},idleSeconds:2,activeSeconds:300,onDeadline:()=>{notified=true;},snapshot:()=>({startedAt:null,ended:notified,stopConfirmed:notified,unexpected:false})})).rejects.toThrow('APP_IDLE_DEADLINE');
  expect(clock).toBe(2000);
 });
 it('physical expiry emits a parent stop opportunity while connected but can never turn green',async()=>{
  let clock=100000,notifiedAt:number|null=null;
  await expect(waitAppSession({now:()=>clock,pause:async ms=>{clock+=ms;},idleSeconds:600,activeSeconds:300,onDeadline:()=>{notifiedAt=clock;},snapshot:()=>({startedAt:100000,ended:notifiedAt!==null&&clock>=401000,stopConfirmed:notifiedAt!==null&&clock>=401000,unexpected:false})})).rejects.toThrow('APP_ACTIVE_DEADLINE');
  expect(notifiedAt).toBe(400000);expect(clock).toBe(401000);
 });
 it('each sequential transaction gets its own actual physical clock',async()=>{
  let clock=0;
  for(const start of [90000,450000])await waitAppSession({now:()=>clock,pause:async ms=>{clock+=ms;},idleSeconds:600,activeSeconds:300,onDeadline:()=>{throw Error('unexpected deadline');},snapshot:()=>({startedAt:clock<start?null:start,ended:clock>=start+250000,stopConfirmed:clock>=start+250000,unexpected:false})});
  expect(clock).toBe(700000);
 });
 it('unknown stop cannot outlive the explicit30second cleanup grace',async()=>{
  let clock=0;
  await expect(waitAppSession({now:()=>clock,pause:async ms=>{clock+=ms;},idleSeconds:1,activeSeconds:300,onDeadline:()=>{},snapshot:()=>({startedAt:null,ended:false,stopConfirmed:false,unexpected:false})})).rejects.toThrow('APP_IDLE_DEADLINE');
  expect(clock).toBe(31000);
 });
});
