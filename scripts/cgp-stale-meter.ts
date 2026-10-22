/** Device-side wire fault only. Physical register/time and all owner responses remain real. */
type RegisterSample = {transactionId:number;connectorId:number;wh:number};
export interface StaleMeterEvidence {
 version:1;mode:'SUPPRESS_PERIODIC_AFTER_THREE_CONFIRMED_POSITIVE';nonce:string;
 confirmedPositive:number;armedAt:string|null;transactionId:number|null;connectorId:number|null;
 lastFreshSentAt:string|null;lastFreshWh:number|null;suppressed:Array<{at:string;wh:number}>;suppressedCount:number;
}
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function staleMeterFault(env:Readonly<Record<string,string|undefined>>,now=()=>new Date().toISOString()){
 if(env.CGP_STALE_METER===undefined)return null;
 const nonce=env.CGP_STALE_METER_NONCE;
 if(env.CGP_STALE_METER!=='1'||env.CGP_STALE_METER_VERSION!=='1'||env.SESSION_SOURCE!=='APP'||typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('Explicit version1 nonce-bound APP stale meter fault required');
 for(const key of ['CGP_SEQUENTIAL_APP','CGP_RFID_DENIAL_TRIGGER','CGP_CONNECTOR_IDS','STOP_AFTER_S'])if(env[key]!==undefined)throw Error('Stale meter fault excludes '+key);
 const evidence:StaleMeterEvidence={version:1,mode:'SUPPRESS_PERIODIC_AFTER_THREE_CONFIRMED_POSITIVE',nonce,confirmedPositive:0,armedAt:null,transactionId:null,connectorId:null,lastFreshSentAt:null,lastFreshWh:null,suppressed:[],suppressedCount:0};
 let latest:(RegisterSample&{at:string})|null=null;
 function sample(payload:unknown):RegisterSample|null{
  if(!record(payload)||!Array.isArray(payload.meterValue))return null;
  const registers=payload.meterValue.flatMap((m:unknown)=>record(m)&&Array.isArray(m.sampledValue)?m.sampledValue:[]).filter((v:unknown):v is Record<string,unknown>=>record(v)&&v.context==='Sample.Periodic'&&v.measurand==='Energy.Active.Import.Register'&&v.unit==='Wh');
  const value=registers[0]?.value;
  if(registers.length!==1||typeof payload.transactionId!=='number'||!Number.isInteger(payload.transactionId)||typeof payload.connectorId!=='number'||!Number.isInteger(payload.connectorId)||typeof value!=='string'||!/^\d+$/.test(value))return null;
  return{transactionId:payload.transactionId,connectorId:payload.connectorId,wh:Number(value)};
 }
 return{evidence,beforeSend(action:string,payload:unknown,sentAt=now()){
  if(action!=='MeterValues')return false;const s=sample(payload);if(!s)return false;
  if(evidence.armedAt){if(s.transactionId!==evidence.transactionId||s.connectorId!==evidence.connectorId)throw Error('Stale fault cannot cover another physical transaction');evidence.suppressedCount++;if(evidence.suppressed.length>=600)throw Error('Stale telemetry fault evidence overflow');evidence.suppressed.push({at:now(),wh:s.wh});return true;}
  latest={...s,at:sentAt};return false;
 },confirmed(action:string,payload:unknown){
  if(action!=='MeterValues'||evidence.armedAt)return;const s=sample(payload);if(!s||s.wh<=0)return;
  evidence.confirmedPositive++;if(evidence.confirmedPositive===3){if(!latest)throw Error('Confirmed meter has no actual sent observation');Object.assign(evidence,{armedAt:now(),transactionId:s.transactionId,connectorId:s.connectorId,lastFreshSentAt:latest.at,lastFreshWh:latest.wh});}
 }};
}
