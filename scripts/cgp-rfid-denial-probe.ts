import assert from 'node:assert/strict';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
type Options={triggerPath?:string;resultPath?:string;firstConnectorId:number;connectorIds:number[];call:(action:string,payload:Record<string,unknown>)=>Promise<unknown>;isActive:()=>boolean};
/** One target-bearing denied RFID attempt on the existing OCPP client. Never starts a charging engine. */
export function createRfidDenialProbe(o:Options){
 assert.equal(Boolean(o.triggerPath),Boolean(o.resultPath),'probe paths must be paired');let claimed=false,complete=false;
 const enabled=Boolean(o.triggerPath);
 return {async poll(){
  if(!enabled||claimed||!existsSync(o.triggerPath!))return;
  const stat=lstatSync(o.triggerPath!);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.size<=1024,'private bounded probe trigger required');
  const p=JSON.parse(readFileSync(o.triggerPath!,'utf8')) as Record<string,unknown>;
  assert.deepEqual(Object.keys(p).sort(),['connectorId','idTag','probeId','schemaVersion']);assert.equal(p.schemaVersion,'1.0.0');assert.match(String(p.probeId),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(Number.isSafeInteger(p.connectorId)&&o.connectorIds.includes(p.connectorId as number)&&p.connectorId!==o.firstConnectorId,'distinct registered connector required');assert.ok(typeof p.idTag==='string'&&/^[0-9A-F]{8}([0-9A-F]{6})?$/.test(p.idTag),'invalid RFID credential');assert.ok(o.isActive(),'first APP physical session must be active');claimed=true;
  const startedAt=new Date().toISOString(),tokenHash=createHash('sha256').update(String(p.idTag),'utf8').digest('hex');
  const auth=await o.call('Authorize',{idTag:p.idTag}) as {idTagInfo?:{status?:string}};assert.equal(auth.idTagInfo?.status,'Accepted','preliminary credential check failed');assert.ok(o.isActive(),'first session ended before target-bearing probe');
  const timestamp=new Date().toISOString(),response=await o.call('StartTransaction',{connectorId:p.connectorId,idTag:p.idTag,meterStart:0,timestamp}) as {idTagInfo?:{status?:string};transactionId?:number};
  const status=response.idTagInfo?.status;assert.ok(['Invalid','Blocked','Expired','ConcurrentTx'].includes(status??''),'target-bearing RFID start was accepted, unanswered or unknown');
  const result={schemaVersion:'1.0.0',probeId:p.probeId,connectorId:p.connectorId,tokenHash,startedAt,timestamp,meterStart:0,authorizeStatus:auth.idTagInfo.status,startStatus:status,provisionalTransactionId:response.transactionId??null,endedAt:new Date().toISOString(),firstStillActive:o.isActive()};
  assert.equal(result.firstStillActive,true,'first session ended during denied probe');writeFileSync(o.resultPath!,JSON.stringify(result)+'\n',{mode:0o600,flag:'wx'});complete=true;
 },assertComplete(){assert.ok(!enabled||complete,'required RFID denial probe incomplete');}};
}
