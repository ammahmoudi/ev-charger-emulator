import type { OcppConfigurationStore } from '../src/lib/ocpp/remote-command-types';
export function positiveMeterInterval(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('METER_INTERVAL_S must be a positive integer');
  const seconds=Number(value);
  if (!Number.isSafeInteger(seconds) || seconds*1000>2147483647) throw new Error('METER_INTERVAL_S exceeds the supported timer range');
  return seconds;
}
/** Fixture override configures the same store read by APP remote engine and GetConfiguration. */
export async function configureMeterInterval(store: OcppConfigurationStore, override: string|undefined): Promise<number> {
  if (override!==undefined) {
    positiveMeterInterval(override);
    if (await store.set('MeterValueSampleInterval',override)!=='Accepted') throw new Error('MeterValueSampleInterval configuration not accepted');
  }
  const readback=await store.list(['MeterValueSampleInterval']);
  if(readback.known.length!==1 || readback.unknown.length || (override!==undefined && readback.known[0].value!==override)) throw new Error('MeterValueSampleInterval readback mismatch');
  return positiveMeterInterval(readback.known[0].value??'');
}
