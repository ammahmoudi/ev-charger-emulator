/**
 * Generates a plausible "master card" idTag for a new device instance — a factory-default RFID
 * code that always authorizes locally regardless of CSMS connection (see
 * `src/lib/device-instances/rfid.ts`). Purely a UX default: the field stays editable both at
 * creation and later from Settings.
 */
export function generateMasterCardIdTag(): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MASTER-${suffix}`;
}
