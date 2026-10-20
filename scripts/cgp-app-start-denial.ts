// Pure interpretation of actual wire frames. Never manufactures a CSMS response.
export function confirmedAppStartDenial(
  frames: Array<{action: string; dir: string; payload: unknown}>,
  physicalTransactionExists: boolean,
): string | null {
  if (physicalTransactionExists || frames.some(f => f.action === 'MeterValues')) {
    throw Error('APP_NO_START_PHYSICAL_CONFLICT');
  }
  const starts = frames.filter(f => f.action === 'StartTransaction.conf' && f.dir === '<-CSMS');
  if (!starts.length) return null;
  if (starts.length !== 1) throw Error('APP_NO_START_AMBIGUOUS_RESPONSE');
  const reply = starts[0]!.payload as {idTagInfo?: {status?: string}};
  const status = reply?.idTagInfo?.status;
  if (typeof status !== 'string' || !['Blocked', 'Expired', 'Invalid', 'ConcurrentTx'].includes(status)) throw Error('APP_NO_START_DECLINE_REQUIRED');
  if (!frames.some(f => f.action === 'StartTransaction' && f.dir === '->CSMS')) {
    throw Error('APP_NO_START_REQUEST_REQUIRED');
  }
  return status;
}
