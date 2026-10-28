import { afterEach, describe, expect, it } from "vitest";
import { OcppClient, OcppChargePointSession, InMemoryConfigurationStore, registerRemoteCommandHandlers } from "../index";
import { MockCsmsServer } from "./mock-csms-server";


const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function until(check:()=>boolean,ms=3000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error("wire evidence deadline exceeded");await sleep(10);}}
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function setup(delay?:number){
 const server=await MockCsmsServer.start(),client=new OcppClient({url:server.url,reconnect:{enabled:false}});
 const session=new OcppChargePointSession(client,{identity:{chargePointVendor:"EVYAR",chargePointModel:"stop-delay-test"},connectors:[{connectorId:1,label:"A"}]});
 session.on("error",()=>{});
 const frames:Array<{action:string;payload:Record<string,unknown>;at:number}>=[],pending=new Map<string,(p:Record<string,unknown>)=>void>();let seq=0;
 const controller=registerRemoteCommandHandlers(client,session,{remoteStopDelayMs:delay,simulatedChargeRateKw:72,configStore:new InMemoryConfigurationStore([{key:"MeterValueSampleInterval",value:"1",readonly:false}])});
 cleanups.push(async()=>{controller.dispose();session.dispose();client.disconnect();await server.close();});
 client.connect();const socket=await server.waitForConnection();
 socket.on("message",data=>{
  const f=JSON.parse(data.toString());
  if(f[0]===3){pending.get(f[1])?.(f[2]);pending.delete(f[1]);return;}
  if(f[0]!==2)return;
  frames.push({action:f[2],payload:f[3],at:Date.now()});
  const result=f[2]==="BootNotification"?{status:"Accepted",interval:300,currentTime:new Date().toISOString()}:f[2]==="StartTransaction"?{transactionId:42,idTagInfo:{status:"Accepted"}}:f[2]==="Authorize"?{idTagInfo:{status:"Accepted"}}:{};
  socket.send(JSON.stringify([3,f[1],result]));
 });
 async function call(action:string,payload:Record<string,unknown>){const id=`c${++seq}`;const result=new Promise<Record<string,unknown>>(r=>pending.set(id,r));socket.send(JSON.stringify([2,id,action,payload]));return result;}
 await until(()=>session.getConnectorStatus(1)?.status==="Available");
 expect(await call("RemoteStartTransaction",{connectorId:1,idTag:"owned-test"})).toEqual({status:"Accepted"});
 await until(()=>controller.getActiveTransaction(1)?.transactionId===42);
 return {controller,frames,call,session};
}
describe("bounded delayed RemoteStop over native OCPP1.6 wire",()=>{
 it("ACKs first, keeps meter delivery active and emits one actual final meter after duplicate stops",async()=>{
  const c=await setup(1200),requestedAt=Date.now();
  expect(await c.call("RemoteStopTransaction",{transactionId:42})).toEqual({status:"Accepted"});
  expect(c.controller.getActiveTransaction(1)?.transactionId).toBe(42);
  expect(c.frames.filter(f=>f.action==="StopTransaction")).toHaveLength(0);
  await Promise.all(Array.from({length:5},()=>c.call("RemoteStopTransaction",{transactionId:42})));
  await until(()=>c.frames.some(f=>f.action==="StopTransaction"));
  const stops=c.frames.filter(f=>f.action==="StopTransaction");expect(stops).toHaveLength(1);
  const stop=stops[0]!;expect(stop.at-requestedAt).toBeGreaterThanOrEqual(1100);
  expect(stop.payload.meterStop).toBeGreaterThanOrEqual(20);
  expect((stop.payload.transactionData as Array<{timestamp:string}>)[0]!.timestamp).toBe(stop.payload.timestamp);
  expect(c.frames.some(f=>f.action==="MeterValues"&&f.at>requestedAt&&f.at<stop.at)).toBe(true);
  await until(()=>c.controller.getActiveTransaction(1)===undefined);
  expect(await c.call("RemoteStopTransaction",{transactionId:42})).toEqual({status:"Rejected"});
  expect(c.frames.filter(f=>f.action==="StopTransaction")).toHaveLength(1);
 });
 it("keeps ordinary default stopping immediate without a configured delay",async()=>{
  const c=await setup();expect(await c.call("RemoteStopTransaction",{transactionId:42})).toEqual({status:"Accepted"});
  await until(()=>c.frames.some(f=>f.action==="StopTransaction"));
  expect(c.frames.filter(f=>f.action==="StopTransaction")).toHaveLength(1);
 });
 it("cancels the delayed stop on disposal without a stray end event",async()=>{
  const c=await setup(200);await c.call("RemoteStopTransaction",{transactionId:42});c.controller.dispose();
  await sleep(300);expect(c.frames.filter(f=>f.action==="StopTransaction")).toHaveLength(0);
 });
 it.each([-1,1.5,60001,NaN,Infinity])("rejects unbounded/invalid delay %s before registration",delay=>{
  const client=new OcppClient({url:"ws://localhost:1",reconnect:{enabled:false}}),session=new OcppChargePointSession(client,{identity:{chargePointVendor:"EVYAR",chargePointModel:"test"},connectors:[]});
  expect(()=>registerRemoteCommandHandlers(client,session,{remoteStopDelayMs:delay})).toThrow(RangeError);session.dispose();
 });
});
