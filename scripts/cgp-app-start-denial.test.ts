import {describe,it,expect} from 'vitest';
import {confirmedAppStartDenial} from './cgp-app-start-denial';
const request={action:'StartTransaction',dir:'->CSMS',payload:{connectorId:1,idTag:'private-fixture',meterStart:0}};
const response={action:'StartTransaction.conf',dir:'<-CSMS',payload:{idTagInfo:{status:'Blocked'},transactionId:-1}};
describe('actual APP no-start wire outcome',()=>{
 it('accepts only an actual sent start with a real declined response',()=>{expect(confirmedAppStartDenial([request,response],false)).toBe('Blocked');expect(confirmedAppStartDenial([request],false)).toBeNull();});
 it('rejects accepted, missing, ambiguous and physically conflicting evidence',()=>{
  for(const frames of [[response],[request,response,response],[request,{...response,payload:{idTagInfo:{status:'Accepted'}}}],[request,{...response,payload:{}}],[request,response,{action:'MeterValues',dir:'->CSMS',payload:{}}]])expect(()=>confirmedAppStartDenial(frames,false)).toThrow();
  expect(()=>confirmedAppStartDenial([request,response],true)).toThrow();
 });
});
