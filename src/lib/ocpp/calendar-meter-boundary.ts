/** A scheduled real-clock model observation, never a shifted/frozen clock or interpolated owner interval. */
export function calendarMeterBoundary(at:string|undefined,startedAt:number,send:(sampledAt:number)=>Promise<void>,now=Date.now) {
 if(at===undefined)return {flush:async()=>{},close:()=>{}};
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(at))throw Error('CALENDAR_METER_BOUNDARY_INVALID');
 const target=Date.parse(at);
 if(!Number.isFinite(target)||target<=startedAt||target<=now()||target-now()>900000)throw Error('CALENDAR_METER_BOUNDARY_NOT_FUTURE');
 let closed=false,emitted:Promise<void>|undefined;
 const flush=async()=>{
  if(closed||now()<target)return;
  emitted??=send(target);
  await emitted;
 };
 const timer=setTimeout(()=>{void flush().catch(()=>{/* periodic flush retains/rethrows the same failed observation */});},target-now());
 return {flush,close:()=>{closed=true;clearTimeout(timer);}};
}
