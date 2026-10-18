import shopContracts from '../contracts/shop-mcp.contracts.json' with { type: 'json' };
import type { ContractFile } from './types.ts';

export * from './evaluate.ts';
export type * from './types.ts';

export const name = '@fiks/contracts';
export const SHOP_CONTRACTS = shopContracts as ContractFile;
export const SHOP_CONTRACTS_PATH = new URL('../contracts/shop-mcp.contracts.json', import.meta.url).pathname;
