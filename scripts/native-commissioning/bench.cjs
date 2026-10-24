/* Test bench only: never imports Core, IAM, admission, wallet or production credentials. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const requireOk=(value,code)=>{if(!value)throw Error(code);};
function config(env){
 const identity=env.CGP_BENCH_IDENTITY,tag=env.CGP_BENCH_ID_TAG,nonce=env.CGP_BENCH_NONCE,token=env.CGP_BENCH_CONTROL_TOKEN;
 requireOk(/^[A-Za-z0-9_-]{16,100}$/.test(identity??''),'EXPLICIT_NEW_IDENTITY_REQUIRED');
 requireOk(/^BENCH-[a-f0-9]{12,14}$/.test(tag??''),'UNASSIGNED_BENCH_TAG_REQUIRED');
 requireOk(/^[a-f0-9]{32}$/.test(nonce??'')&&/^[a-f0-9]{64}$/.test(token??''),'PRIVATE_NONCE_AND_CONTROL_TOKEN_REQUIRED');
 const txBase=Number(env.CGP_BENCH_TX_BASE);requireOk(Number.isInteger(txBase)&&txBase>=1900000000&&txBase<=2100000000,'HIGH_DISTINCT_INT32_BASE_REQUIRED');
 const emulatorBaseUrl=env.CGP_BENCH_EMULATOR_BASE_URL,emulatorAppName=env.CGP_BENCH_EMULATOR_APP_NAME;validateEmulatorUrl(emulatorBaseUrl,emulatorAppName);
 const port=Number(env.PORT??8080);requireOk(Number.isInteger(port)&&port>0&&port<65536,'PORT_INVALID');
 const interval=Number(env.CGP_BENCH_METER_INTERVAL_S??1);requireOk(interval===1,'NATIVE_BENCH_EXPLICIT_1_SECOND_ONLY');
 const directory=env.CGP_BENCH_EVIDENCE_DIR;requireOk(path.isAbsolute(directory??''),'PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
 const stat=fs.lstatSync(directory);requireOk(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o700&&fs.realpathSync(directory)===directory,'REAL_PRIVATE_0700_DIRECTORY_REQUIRED');
 requireOk(env.CGP_BENCH_NATIVE_SOURCE_COMMIT==='UNKNOWN'||/^[a-f0-9]{40}$/.test(env.CGP_BENCH_NATIVE_SOURCE_COMMIT??''),'EXPLICIT_NATIVE_SOURCE_OR_UNKNOWN_REQUIRED');
 requireOk(/^sha256:[a-f0-9]{64}$/.test(env.CGP_BENCH_NATIVE_IMAGE_ID??''),'NATIVE_IMAGE_ID_REQUIRED');
 requireOk(Boolean(env.CGP_BENCH_NEW_INSTANCE_ID)&&Boolean(env.CGP_BENCH_MODEL_ID),'NEW_INSTANCE_MODEL_BINDING_REQUIRED');
 return{identity,tag,nonce,token,txBase,port,interval,directory,emulatorBaseUrl,emulatorAppName,sourceCommit:env.CGP_BENCH_NATIVE_SOURCE_COMMIT==='UNKNOWN'?null:env.CGP_BENCH_NATIVE_SOURCE_COMMIT,imageId:env.CGP_BENCH_NATIVE_IMAGE_ID,instanceId:env.CGP_BENCH_NEW_INSTANCE_ID,modelId:env.CGP_BENCH_MODEL_ID};
}
function validateEmulatorUrl(base,appName){
 requireOk(/^[A-Za-z0-9][A-Za-z0-9_-]{1,100}$/.test(appName??'')&&!['localhost'].includes(appName)&&!/^\d+\.\d+\.\d+\.\d+$/.test(appName),'PRIVATE_EMULATOR_APP_REQUIRED');
 const u=new URL(base);requireOk(u.protocol==='http:'&&u.hostname===appName&&u.port==='3000'&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password,'EXACT_PRIVATE_EMULATOR_URL_REQUIRED');
}
async function prepareOwnedEv(c,trial,{fetchImpl=fetch,record=()=>{}}={}){
 validateEmulatorUrl(c.emulatorBaseUrl,c.emulatorAppName);requireOk(typeof c.instanceId==='string'&&c.instanceId.length>0,'OWNED_INSTANCE_REQUIRED');
 const root='/api/device-instances/'+encodeURIComponent(c.instanceId)+'/connectors';
 const controller=new AbortController();const deadline=Date.now()+5000;const timer=setTimeout(()=>controller.abort(),5000);let phase='VERIFY_INACTIVE';
 async function request(action,method,endpoint,body){
  record({trial,action,phase:'REQUEST',method,path:endpoint,...(body?{body}:{}),requestedAt:new Date().toISOString()});
  const response=await fetchImpl(new URL(endpoint,c.emulatorBaseUrl),{method,redirect:'error',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
  record({trial,action,phase:'HTTP_STATUS',httpStatus:response.status,receivedAt:new Date().toISOString()});requireOk(response.status===200,'OWNED_EV_HTTP_'+response.status);
  const text=await response.text();requireOk(Buffer.byteLength(text)<=8192,'OWNED_EV_RESPONSE_TOO_LARGE');return JSON.parse(text);
 }
 function ready(v,status){requireOk(v&&v.connectorId===1&&v.evConnected===(status==='Preparing')&&v.locked===false&&v.activeSession===null&&v.status===status,'OWNED_EV_CONNECTOR_NOT_READY');}
 try{
  let observation=0;
  while(true){
   const before=await request('VERIFY_INACTIVE','GET',root);requireOk(Array.isArray(before.connectors),'OWNED_CONNECTOR_LIST_REQUIRED');const matches=before.connectors.filter(v=>v.connectorId===1);
   const v=matches.length===1?matches[0]:null;
   record({trial,action:'VERIFY_INACTIVE',phase:'OBSERVATION',observation:++observation,matchingConnectors:matches.length,...(v?{connector:{connectorId:1,status:typeof v.status==='string'?v.status:null,evConnected:typeof v.evConnected==='boolean'?v.evConnected:null,locked:typeof v.locked==='boolean'?v.locked:null,activeSessionPresent:v.activeSession!==null}}:{}),observedAt:new Date().toISOString()});
   requireOk(matches.length===1,'OWNED_CONNECTOR_NOT_UNIQUE');requireOk(typeof v.status==='string'&&typeof v.locked==='boolean'&&typeof v.evConnected==='boolean'&&Object.hasOwn(v,'activeSession'),'OWNED_CONNECTOR_RESPONSE_INVALID');
   if(v.activeSession===null&&v.locked===false&&['Available','Preparing'].includes(v.status)){
    record({trial,action:'VERIFY_INACTIVE',phase:'RESPONSE',httpStatus:200,connector:{connectorId:1,status:v.status,evConnected:v.evConnected,locked:false,activeSession:null},receivedAt:new Date().toISOString()});break;
   }
   requireOk(Date.now()<deadline&&!controller.signal.aborted,'OWNED_EV_IDLE_DEADLINE');await new Promise(resolve=>setTimeout(resolve,100));requireOk(Date.now()<deadline&&!controller.signal.aborted,'OWNED_EV_IDLE_DEADLINE');
  }
  phase='UNPLUG';
  const off=await request('UNPLUG','POST',root+'/1/ev',{connected:false});ready(off.connector,'Available');record({trial,action:'UNPLUG',phase:'RESPONSE',httpStatus:200,connector:{connectorId:1,status:'Available',evConnected:false,locked:false,activeSession:null},receivedAt:new Date().toISOString()});
  phase='PLUG';const on=await request('PLUG','POST',root+'/1/ev',{connected:true});ready(on.connector,'Preparing');record({trial,action:'PLUG',phase:'RESPONSE',httpStatus:200,connector:{connectorId:1,status:'Preparing',evConnected:true,locked:false,activeSession:null},receivedAt:new Date().toISOString()});
 }catch(e){const code=controller.signal.aborted?(phase==='VERIFY_INACTIVE'?'OWNED_EV_IDLE_DEADLINE':'OWNED_EV_HTTP_DEADLINE'):/^OWNED_[A-Z0-9_]+$/.test(e.message)?e.message:'OWNED_EV_HTTP_FAILED';record({trial,action:phase,phase:'ERROR',code,failedAt:new Date().toISOString()});throw Error(code);}finally{clearTimeout(timer);}
}
class Bench{
 constructor(options,{WebSocketServer,prepareEv,now=()=>Date.now(),mono=()=>Number(process.hrtime.bigint())/1e6}={}){
  this.c=options;this.prepareEv=prepareEv??(trial=>prepareOwnedEv(options,trial,{record:row=>this.recordHttp(row)}));this.httpActions=[];this.now=now;this.mono=mono;this.state='WAITING_FOR_BOOT';this.seq=0;this.nextTx=options.txBase;this.frames=[];this.pending=new Map();this.waiters=[];this.active=null;this.trials=[];
  this.rawPath=path.join(options.directory,options.nonce+'.raw.jsonl');this.rawFd=fs.openSync(this.rawPath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  this.httpPath=path.join(options.directory,options.nonce+'.http-actions.jsonl');this.httpFd=fs.openSync(this.httpPath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  this.triggerPath=path.join(options.directory,options.nonce+'.run-trigger.json');this.triggerFd=fs.openSync(this.triggerPath,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  this.server=http.createServer((req,res)=>this.http(req,res));
  this.wss=new WebSocketServer({noServer:true,handleProtocols:p=>p.has('ocpp1.6')?'ocpp1.6':false});
  this.server.on('upgrade',(req,socket,head)=>{
   if(req.url!=='/ocpp/'+options.identity||this.ws||!String(req.headers['sec-websocket-protocol']??'').split(',').map(x=>x.trim()).includes('ocpp1.6')){socket.destroy();return;}
   this.wss.handleUpgrade(req,socket,head,ws=>{this.ws=ws;ws.on('message',data=>{try{this.receive(JSON.parse(data.toString()));}catch(e){this.fail(e.message);}});ws.on('close',()=>{if(!['COMPLETE','FAILED'].includes(this.state))this.fail('UNEXPECTED_SOCKET_CLOSE');});});
  });
 }
 recordHttp(row){requireOk(!this.receipt,'HTTP_EVIDENCE_ALREADY_FROZEN');this.httpActions.push(row);fs.writeSync(this.httpFd,JSON.stringify(row)+'\n');}
 record(direction,frame){const entry={direction,receivedAt:new Date(this.now()).toISOString(),monotonicMs:this.mono(),frame};this.frames.push(entry);fs.writeSync(this.rawFd,JSON.stringify(entry)+'\n');return entry;}
 send(frame){requireOk(this.ws?.readyState===1,'SOCKET_NOT_OPEN');this.record('CSMS_TO_NATIVE',frame);this.ws.send(JSON.stringify(frame));}
 receive(frame){if(this.receipt)return;requireOk(Array.isArray(frame)&&[2,3,4].includes(frame[0])&&typeof frame[1]==='string','MALFORMED_OCPP_FRAME');const row=this.record('NATIVE_TO_CSMS',frame);
  if(frame[0]===2){const[,id,action,p]=frame;requireOk(p&&typeof p==='object','MALFORMED_CALL');let response={};
   if(action==='BootNotification'){requireOk(this.state==='WAITING_FOR_BOOT'&&p.chargePointSerialNumber===this.c.identity,'BOOT_SUBJECT_MISMATCH');this.boot=p;this.state='READY';response={status:'Accepted',currentTime:new Date(this.now()).toISOString(),interval:300};}
   else{requireOk(this.boot,'BOOT_REQUIRED');
    if(action==='Heartbeat')response={currentTime:new Date(this.now()).toISOString()};
    else if(action==='StatusNotification'){} // Actual runtime status, retained in raw evidence.
    else if(action==='Authorize'){requireOk(p.idTag===this.c.tag&&this.state==='RUNNING'&&this.startExpected,'FOREIGN_AUTHORIZATION_REJECTED');response={idTagInfo:{status:'Accepted'}};}
    else if(action==='StartTransaction'){requireOk(this.state==='RUNNING'&&this.startExpected&&!this.active&&p.idTag===this.c.tag&&p.connectorId===1&&Number.isFinite(p.meterStart),'UNEXPECTED_START_TRANSACTION');this.startExpected=false;this.active={tx:this.nextTx++,start:row,meterStart:p.meterStart,samples:[]};response={transactionId:this.active.tx,idTagInfo:{status:'Accepted'}};}
    else if(action==='MeterValues'){this.meter(p,row);}
    else if(action==='StopTransaction'){requireOk(this.active&&p.transactionId===this.active.tx&&p.idTag===this.c.tag&&this.active.stopCommand&&Number.isFinite(p.meterStop),'UNBOUND_STOP_TRANSACTION');this.active.stop=row;this.stopped=this.active;this.active=null;response={idTagInfo:{status:'Accepted'}};}
    else throw Error('UNEXPECTED_ACTION');
   }
   this.send([3,id,response]);
  }else{const pending=this.pending.get(frame[1]);requireOk(pending,'UNBOUND_CALL_RESULT');this.pending.delete(frame[1]);clearTimeout(pending.timer);frame[0]===4?pending.reject(Error('OCPP_CALL_ERROR')):pending.resolve({payload:frame[2],row});}
  for(const waiter of [...this.waiters])if(waiter.match(row)){this.waiters.splice(this.waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(row);}
 }
 meter(p,row){const a=this.active;requireOk(a&&p.transactionId===a.tx&&p.connectorId===1&&Array.isArray(p.meterValue),'UNBOUND_METER');
  for(const v of p.meterValue){const value=v.sampledValue?.find(x=>x.measurand==='Energy.Active.Import.Register');requireOk(value&&value.context==='Sample.Periodic'&&(!value.unit||value.unit==='Wh'),'PERIODIC_REGISTER_REQUIRED');const wh=Number(value.value),at=Date.parse(v.timestamp);requireOk(Number.isFinite(at)&&Math.abs(at-this.now())<=5000&&Number.isFinite(wh)&&wh>=a.meterStart,'INVALID_REGISTER');const prev=a.samples.at(-1);if(prev){requireOk(at>prev.at&&wh>=prev.wh,'NONMONOTONIC_METER');requireOk(at-prev.at>=750&&row.monotonicMs-prev.receivedMono>=750,'DUPLICATE_METER_LOOP');requireOk(at-prev.at<=5000,'STALE_METER_SAMPLE');}a.samples.push({at,wh,receivedMono:row.monotonicMs});}
 }
 call(action,payload,timeout=10000){const id='bench-'+(++this.seq);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('UNANSWERED_'+action));},timeout);this.pending.set(id,{resolve,reject,timer});this.send([2,id,action,payload]);});}
 wait(match,timeout=15000){return new Promise((resolve,reject)=>{const w={match,resolve,reject,timer:setTimeout(()=>{this.waiters=this.waiters.filter(x=>x!==w);reject(Error('OBSERVATION_TIMEOUT'));},timeout)};this.waiters.push(w);});}
 fail(code){if(this.state==='FAILED')return;this.state='FAILED';this.error=code;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(code));}this.pending.clear();for(const w of this.waiters){clearTimeout(w.timer);w.reject(Error(code));}this.waiters=[];this.finish();}
 async run(){requireOk(this.state==='READY','READY_SINGLE_USE_REQUIRED');this.state='RUNNING';try{
  const changes={MeterValueSampleInterval:'1',AuthorizeRemoteTxRequests:'true',LocalPreAuthorize:'false',AllowOfflineTxForUnknownId:'false',LocalAuthListEnabled:'false'};
  for(const[key,value]of Object.entries(changes)){const r=await this.call('ChangeConfiguration',{key,value});requireOk(r.payload?.status==='Accepted','CONFIGURATION_REJECTED_'+key);}
  const got=(await this.call('GetConfiguration',{key:Object.keys(changes)})).payload;const back=Object.fromEntries((got.configurationKey??[]).map(x=>[x.key,x.value]));for(const[k,v]of Object.entries(changes))requireOk(back[k]===v,'CONFIGURATION_READBACK_MISMATCH');this.configuration=back;
  for(let i=0;i<5;i++){
   requireOk(!this.active&&!this.startExpected,'OWNED_PRETRIAL_MUST_BE_INACTIVE');await this.prepareEv(i+1);
   this.stopped=null;this.startExpected=true;const started=this.wait(r=>r.direction==='NATIVE_TO_CSMS'&&r.frame[2]==='StartTransaction');requireOk((await this.call('RemoteStartTransaction',{connectorId:1,idTag:this.c.tag})).payload?.status==='Accepted','REMOTE_START_REJECTED');await started;
   await this.wait(()=>this.active?.samples.length>=4,20000);await new Promise(r=>setTimeout(r,350+i*50));const a=this.active;requireOk(a,'ACTIVE_TRIAL_MISSING');const stopPromise=this.wait(r=>r.direction==='NATIVE_TO_CSMS'&&r.frame[2]==='StopTransaction');a.stopCommand={at:this.now(),mono:this.mono()};requireOk((await this.call('RemoteStopTransaction',{transactionId:a.tx})).payload?.status==='Accepted','REMOTE_STOP_REJECTED');await stopPromise;
   const stopped=this.stopped;requireOk(stopped?.tx===a.tx&&stopped.samples.length>=3,'STOP_TRIAL_BINDING_MISSING');this.trials.push(measure(stopped));
   // Native Prisma-backed Finishing hold is real; observe Available rather than bypass it.
   const available=()=>this.frames.some(r=>r.direction==='NATIVE_TO_CSMS'&&r.monotonicMs>stopped.stop.monotonicMs&&r.frame[2]==='StatusNotification'&&r.frame[3]?.connectorId===1&&r.frame[3]?.status==='Available');if(!available())await this.wait(()=>available(),30000);
  }
  this.state='COMPLETE';return this.finish();
 }catch(e){this.fail(e.message);this.finish();throw e;}}
 finish(){if(this.receipt)return this.receipt;fs.fsyncSync(this.rawFd);fs.fsyncSync(this.httpFd);const evidence={reportedConfiguration:this.configuration??{},httpActions:this.httpActions,httpActionsSha256:sha(fs.readFileSync(this.httpPath)),commissioning:{subject:'Native Prisma-backed EV charger emulator, isolated trusted OCPP1.6 wire bench; NOT Core/group/CDR/finance',method:'Actual RemoteStop command to StopTransaction receive; register extrapolated from real periodic samples at command time',trials:this.trials.length,perTrial:this.trials,...(this.state==='COMPLETE'?{capability:derive(this.trials)}:{})},binding:{instanceId:this.c.instanceId,modelId:this.c.modelId,identity:this.c.identity,boot:this.boot,nativeSourceCommit:this.c.sourceCommit,nativeImageId:this.c.imageId},measuredAt:new Date(this.now()).toISOString(),outcome:this.state,error:this.error??null};const p=path.join(this.c.directory,this.c.nonce+'.evidence.json');fs.writeFileSync(p,JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});const receipt={kind:'CGP_NATIVE_EMULATOR_COMMISSIONING_V1',outcome:this.state,rawPath:this.rawPath,rawSha256:sha(fs.readFileSync(this.rawPath)),httpActionsPath:this.httpPath,httpActionsSha256:sha(fs.readFileSync(this.httpPath)),evidencePath:p,evidenceSha256:sha(fs.readFileSync(p)),benchSourceSha256:sha(fs.readFileSync(__filename)),measuredAt:evidence.measuredAt,nativeImageId:this.c.imageId,nativeSourceCommit:this.c.sourceCommit,identity:this.c.identity,instanceId:this.c.instanceId,activeTransactionUnresolved:Boolean(this.active),noBackendAdmissionOrFinancialClaim:true};fs.writeFileSync(path.join(this.c.directory,this.c.nonce+'.receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});return this.receipt=receipt;}
 checkTrigger(){if(this.triggerSeen)return false;const actual=fs.lstatSync(this.triggerPath),opened=fs.fstatSync(this.triggerFd);requireOk(actual.isFile()&&!actual.isSymbolicLink()&&actual.dev===opened.dev&&actual.ino===opened.ino&&(actual.mode&0o777)===0o600,'CONTROL_FILE_IDENTITY_CHANGED');if(opened.size===0)return false;this.triggerSeen=true;requireOk(opened.size<=256,'CONTROL_FILE_TOO_LARGE');let input;try{input=JSON.parse(fs.readFileSync(this.triggerPath,'utf8'));}catch{throw Error('CONTROL_FILE_JSON_INVALID');}requireOk(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join(',')==='action,nonce,token'&&input.action==='RUN'&&input.nonce===this.c.nonce&&input.token===this.c.token,'CONTROL_FILE_BINDING_REJECTED');requireOk(this.state==='READY','READY_SINGLE_USE_REQUIRED');fs.writeFileSync(path.join(this.c.directory,this.c.nonce+'.trigger-consumed.json'),JSON.stringify({nonce:this.c.nonce,action:'RUN',triggerSha256:sha(JSON.stringify(input)),acceptedAt:new Date(this.now()).toISOString()}),{mode:0o600,flag:'wx'});this.launch();return true;}
 launch(){void this.run().then(()=>{if(require.main===module)setTimeout(()=>void this.close().finally(()=>process.exit(0)),300);}).catch(()=>{if(require.main===module)setTimeout(()=>void this.close().finally(()=>process.exit(1)),300);});}
 http(req,res){const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};if(req.method==='GET'&&req.url==='/health')return reply(200,{status:'ok',kind:'isolated-test-bench'});if(req.headers.authorization!=='Bearer '+this.c.token)return reply(401,{error:'UNAUTHORIZED'});if(req.method==='GET'&&req.url==='/status')return reply(200,{state:this.state,trials:this.trials.length,error:this.error??null,activeTransactionUnresolved:Boolean(this.active),receipt:this.receipt??null});if(req.method==='POST'&&req.url==='/run'){if(this.state!=='READY')return reply(409,{error:'READY_SINGLE_USE_REQUIRED'});reply(202,{accepted:true});this.launch();return;}reply(404,{error:'NOT_FOUND'});}
 async close(){clearInterval(this.controlPoll);for(const p of this.pending.values())clearTimeout(p.timer);for(const w of this.waiters)clearTimeout(w.timer);this.ws?.terminate();await new Promise(r=>this.wss.close(r));if(this.server.listening)await new Promise(r=>this.server.close(r));fs.closeSync(this.rawFd);fs.closeSync(this.httpFd);fs.closeSync(this.triggerFd);}
}
function measure(a){const samples=a.samples,prev=samples.at(-2),last=samples.at(-1);requireOk(samples.length>=3&&last.at>prev.at,'INSUFFICIENT_PERIODIC_SAMPLES');const rate=(last.wh-prev.wh)/(last.at-prev.at);const requestRegister=last.wh+rate*(a.stopCommand.at-last.at);const stopWh=a.stop.frame[3].meterStop,delay=a.stop.monotonicMs-a.stopCommand.mono;requireOk(delay>=0&&delay<=10000&&stopWh>=last.wh,'INVALID_STOP_BOUND');const overshoot=Math.max(0,stopWh-requestRegister);requireOk(Number.isFinite(overshoot),'INVALID_OVERSHOOT');return{transactionId:a.tx,meterStartWh:a.meterStart,meterStopWh:stopWh,samples:samples.length,sampleIntervalsMs:samples.slice(1).map((s,i)=>s.at-samples[i].at),stopDelayMs:delay,overshootWh:overshoot,stopRequestAt:new Date(a.stopCommand.at).toISOString(),stopReceivedAt:a.stop.receivedAt,periodicSamples:samples};}
function derive(trials){requireOk(trials.length>=5,'FIVE_MEASURED_TRIALS_REQUIRED');return{overshootWh:Math.ceil(Math.max(...trials.map(t=>t.overshootWh))),stopDelayMs:Math.max(1,Math.ceil(Math.max(...trials.map(t=>t.stopDelayMs)))),meterIntervalSeconds:1,maxMeterStalenessSeconds:Math.max(1,Math.ceil(Math.max(...trials.flatMap(t=>t.sampleIntervalsMs))/1000))};}
module.exports={Bench,config,measure,derive,prepareOwnedEv,validateEmulatorUrl};
if(require.main===module){try{const c=config(process.env);const {WebSocketServer}=require('ws');const b=new Bench(c,{WebSocketServer});b.server.listen(c.port,'0.0.0.0');b.controlPoll=setInterval(()=>{try{b.checkTrigger();}catch(e){b.fail(e.message);}},250);setTimeout(()=>{if(!['COMPLETE','FAILED'].includes(b.state)){b.fail('TOTAL_BENCH_DEADLINE');b.finish();}void b.close().finally(()=>process.exit(b.state==='COMPLETE'?0:1));},600000).unref();}catch(e){console.error(e.message);process.exitCode=1;}}
