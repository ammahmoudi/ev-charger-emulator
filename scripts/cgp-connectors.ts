/** Explicit fixture topology only; default headless behavior remains one primary connector. */
export function headlessConnectors(primary:number,configured:string|undefined):number[]{
 if(!Number.isInteger(primary)||primary<1)throw new Error('CONNECTOR_ID must be a positive integer');
 if(configured===undefined)return [primary];
 const ids=configured.split(',').map(value=>/^[1-9][0-9]*$/.test(value)?Number(value):NaN);
 if(ids.length!==2||new Set(ids).size!==2||!ids.includes(primary)||!ids.includes(1)||!ids.includes(2))throw new Error('CGP_CONNECTOR_IDS supports exactly1,2 and must include the primary connector');
 return ids;
}
