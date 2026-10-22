import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {InMemoryConfigurationStore} from '../src/lib/ocpp/in-memory-configuration-store';
import {headlessConnectors} from './cgp-connectors';
import {configureMeterInterval,positiveMeterInterval} from './cgp-meter-configuration';

test('explicit interval configures the store while product default remains60',async()=>{
 const store=new InMemoryConfigurationStore();assert.equal(await configureMeterInterval(store,undefined),60);assert.equal(await configureMeterInterval(store,'1'),1);assert.equal((await store.list(['MeterValueSampleInterval'])).known[0].value,'1');assert.equal(await configureMeterInterval(new InMemoryConfigurationStore(),undefined),60);
});
for(const value of ['','0','-1','0.5','NaN','Infinity','1e3','2147484'])test(`invalid interval ${JSON.stringify(value)} fails before connection`,()=>{assert.throws(()=>positiveMeterInterval(value));});
test('rejected configuration and divergent readback fail closed',async()=>{
 await assert.rejects(()=>configureMeterInterval({set:async()=>'Rejected',list:async()=>({known:[],unknown:[]})},'1'),/not accepted/);
 await assert.rejects(()=>configureMeterInterval({set:async()=>'Accepted',list:async()=>({known:[{key:'MeterValueSampleInterval',readonly:false,value:'60'}],unknown:[]})},'1'),/mismatch/);
});
for(const topology of [undefined,'1,2','unexpected-second'])test(`actual headless APP engine topology ${topology??'default'} reports genuine status/configuration/meters`,async()=>{
 const dir=mkdtempSync('/tmp/cgp-app-meter-wire-'),out=join(dir,'wire.json');
 const received: Array<{action:string;payload:Record<string,unknown>;at:number}>=[];let configuration:{configurationKey:Array<{key:string;readonly:boolean;value:string}>}|undefined;let readyAt=0;
 const server=new WebSocketServer({port:0,handleProtocols:p=>p.has('ocpp1.6')?'ocpp1.6':false});
 const timers:NodeJS.Timeout[]=[];
 server.on('connection',ws=>ws.on('message',raw=>{
  const frame=JSON.parse(raw.toString());
  if(frame[0]===3 && frame[1]==='config')configuration=frame[2];
  if(frame[0]!==2)return;
  const [,id,action,payload]=frame;received.push({action,payload,at:Date.now()});
  const reply=(p:unknown)=>ws.send(JSON.stringify([3,id,p]));
  if(action==='BootNotification'){
   reply({status:'Accepted',currentTime:new Date().toISOString(),interval:300});
   timers.push(setTimeout(()=>ws.send(JSON.stringify([2,'config','GetConfiguration',{key:topology?['MeterValueSampleInterval','NumberOfConnectors']:['MeterValueSampleInterval']} ])),500));
   timers.push(setTimeout(()=>ws.send(JSON.stringify([2,'start','RemoteStartTransaction',{connectorId:1,idTag:'OWNED-APP-TEST'}])),1800));
  }else if(action==='StartTransaction'){
   reply({transactionId:payload.connectorId===1?4242:4243,idTagInfo:{status:'Accepted'}});
   if(topology==='unexpected-second' && payload.connectorId===1)timers.push(setTimeout(()=>ws.send(JSON.stringify([2,'unexpected-start','RemoteStartTransaction',{connectorId:2,idTag:'OWNED-APP-TEST'}])),1000));
   if(payload.connectorId===1)timers.push(setTimeout(()=>ws.send(JSON.stringify([2,'stop','RemoteStopTransaction',{transactionId:4242}])),3600));
  }else reply(action==='StopTransaction'?{idTagInfo:{status:'Accepted'}}:{});
 }));
 await new Promise<void>(r=>server.on('listening',r));
 const port=(server.address() as {port:number}).port;
 const tsx=process.env.TSX_CLI??new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url).pathname;
 const child=spawn(process.execPath,[tsx,'scripts/cgp-headless-rfid.ts'],{cwd:new URL('..',import.meta.url),env:{...process.env,OCPP_URL:`ws://127.0.0.1:${port}/app-meter-test`,ID_TAG:'RFID-NOT-USED',SESSION_SOURCE:'APP',CHARGE_RATE_KW:'18',METER_INTERVAL_S:'1',MAX_SECONDS:'12',...(topology?{CGP_CONNECTOR_IDS:'1,2'}:{}),EVIDENCE_OUT:out,NODE_OPTIONS:'--max-old-space-size=128'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>{logs+=d;if(String(d).includes('READY'))readyAt=Date.now();});child.stderr.on('data',d=>logs+=d);
 const timeout=setTimeout(()=>child.kill('SIGTERM'),15000);
 try{
  const code=await new Promise<number|null>(r=>child.on('exit',r));
  const actual=JSON.parse(readFileSync(out,'utf8'));
  if(topology==='unexpected-second'){
   assert.equal(code,1,logs);assert.deepEqual(actual.unexpectedTransactions,[{connectorId:2,transactionId:4243}]);assert.equal(received.filter(x=>x.action==='StartTransaction').length,2);assert.equal(actual.stopConfirmed,false);return;
  }
  assert.equal(code,0,logs);assert.ok(configuration,'actual GetConfiguration response absent');
  if(topology){
   assert.deepEqual(actual.connectorIds,[1,2]);assert.deepEqual(actual.unexpectedTransactions,[]);
   assert.ok(readyAt>0);assert.ok(received.some(x=>x.action==='StatusNotification'&&x.payload.connectorId===2&&x.payload.status==='Available'&&x.at<=readyAt));
   assert.deepEqual(configuration.configurationKey.find(x=>x.key==='NumberOfConnectors'),{key:'NumberOfConnectors',readonly:true,value:'2'});
   assert.equal(received.filter(x=>x.action==='StartTransaction').length,1);
  }
  assert.deepEqual(configuration.configurationKey.find(x=>x.key==='MeterValueSampleInterval'),{key:'MeterValueSampleInterval',readonly:false,value:'1'});
  const evidence=JSON.parse(readFileSync(out,'utf8'));assert.equal(evidence.actualMeterIntervalSeconds,1);assert.equal(evidence.stopConfirmed,true);
  const periodic=received.filter(x=>x.action==='MeterValues' && Array.isArray(x.payload.meterValue)&&x.payload.meterValue.some((m:unknown)=>m!==null&&typeof m==='object'&&'sampledValue' in m&&Array.isArray(m.sampledValue)&&m.sampledValue.some((v:unknown)=>v!==null&&typeof v==='object'&&'context' in v&&v.context==='Sample.Periodic')));
  assert.ok(periodic.length>=3,`only ${periodic.length} periodic meters`);
  const start=received.find(x=>x.action==='StartTransaction')!;assert.equal(start.payload.idTag,'OWNED-APP-TEST');assert.ok(periodic[0].at-start.at<=1250,'first meter exceeded1s plus250ms wire allowance');
  for(let i=1;i<periodic.length;i++)assert.ok(periodic[i].at-periodic[i-1].at<=1250,'periodic meter gap exceeded commissioned interval plus250ms wire allowance');
  assert.ok(!received.some(x=>x.action==='Authorize'));
 }finally{clearTimeout(timeout);for(const t of timers)clearTimeout(t);for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});

test('two connectors are explicit while default stays single',()=>{assert.deepEqual(headlessConnectors(1,undefined),[1]);assert.deepEqual(headlessConnectors(1,'1,2'),[1,2]);});
for(const value of ['', '1', '1,1', '0,1', '1,3', '1,2,3'])test(`invalid topology ${JSON.stringify(value)}`,()=>assert.throws(()=>headlessConnectors(1,value)));
