export type AppClockState = { startedAt: number | null; ended: boolean; stopConfirmed: boolean; unexpected: boolean };
/** Idle commissioning time never consumes the separately bounded physical clock. */
export async function waitAppSession({snapshot,now=Date.now,pause,onDeadline,idleSeconds,activeSeconds,cleanupGraceSeconds=30}: {
 snapshot:()=>AppClockState; now?:()=>number; pause:(ms:number)=>Promise<void>;
 onDeadline:(kind:'APP_IDLE_DEADLINE'|'APP_ACTIVE_DEADLINE')=>void;
 idleSeconds:number; activeSeconds:number; cleanupGraceSeconds?:number;
}) {
 for (const value of [idleSeconds,activeSeconds]) if(!Number.isInteger(value)||value<1||value>600) throw Error('APP clock must be bounded from1 to600 seconds');
 if(!Number.isInteger(cleanupGraceSeconds)||cleanupGraceSeconds<1||cleanupGraceSeconds>30) throw Error('APP cleanup grace must be bounded from1 to30 seconds');
 const idleUntil=now()+idleSeconds*1000;
 for (;;) {
  const state=snapshot();
  if(state.unexpected) throw Error('Unexpected physical start on secondary connector');
  if(state.ended&&state.stopConfirmed) return;
  const kind=state.startedAt===null ? (now()>=idleUntil?'APP_IDLE_DEADLINE':null) : (now()>=state.startedAt+activeSeconds*1000?'APP_ACTIVE_DEADLINE':null);
  if(kind){
   onDeadline(kind);
   // Keep the real transport alive for the parent's actual owned RemoteStop.
   // A subsequent confirmation is cleanup evidence and NEVER timeout acceptance.
   const graceUntil=now()+cleanupGraceSeconds*1000;
   while(now()<graceUntil&&!snapshot().stopConfirmed) await pause(Math.min(250,graceUntil-now()));
   throw Error(kind);
  }
  await pause(250);
 }
}
