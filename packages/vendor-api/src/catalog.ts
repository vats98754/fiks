export interface Product {
  id: string;
  name: string;
  category: 'laptop' | 'monitor' | 'cable' | 'dock' | 'keyboard';
  /** Unit price in US dollars (v1 wire format). */
  price: number;
  currency: 'USD';
  stock: number;
}

/** Fixed catalog. Every price is between $60 and $1,500. */
export const CATALOG: readonly Product[] = [
  { id: 'p-1001', name: 'Aero 14 Laptop', category: 'laptop', price: 1199, currency: 'USD', stock: 12 },
  { id: 'p-1002', name: 'Volt 13 Laptop', category: 'laptop', price: 899, currency: 'USD', stock: 30 },
  { id: 'p-1003', name: 'Titan 16 Laptop', category: 'laptop', price: 1499, currency: 'USD', stock: 4 },
  { id: 'p-1004', name: 'Nimbus 15 Laptop', category: 'laptop', price: 749.5, currency: 'USD', stock: 18 },
  { id: 'p-1005', name: 'Clarity 27 Monitor', category: 'monitor', price: 329, currency: 'USD', stock: 25 },
  { id: 'p-1006', name: 'Clarity 32 Monitor', category: 'monitor', price: 459, currency: 'USD', stock: 9 },
  { id: 'p-1007', name: 'Hub Pro Dock', category: 'dock', price: 189, currency: 'USD', stock: 40 },
  { id: 'p-1008', name: 'Quiet Mech Keyboard', category: 'keyboard', price: 129, currency: 'USD', stock: 50 },
  { id: 'p-1101', name: 'Thunderbolt 5 Cable 1m', category: 'cable', price: 69, currency: 'USD', stock: 100 },
  { id: 'p-1102', name: 'Thunderbolt 5 Cable 2m', category: 'cable', price: 89, currency: 'USD', stock: 80 },
  { id: 'p-1103', name: 'USB4 Cable 1m', category: 'cable', price: 60, currency: 'USD', stock: 120 },
  { id: 'p-1104', name: 'USB4 Cable 2m', category: 'cable', price: 64, currency: 'USD', stock: 90 },
  {
    id: 'p-1105',
    name: 'Active Optical HDMI Cable 10m',
    category: 'cable',
    price: 99,
    currency: 'USD',
    stock: 35,
  },
  {
    id: 'p-1106',
    name: 'DisplayPort 2.1 Cable 3m',
    category: 'cable',
    price: 72,
    currency: 'USD',
    stock: 60,
  },
  {
    id: 'p-1107',
    name: 'Braided Power Cable 2m',
    category: 'cable',
    price: 61.5,
    currency: 'USD',
    stock: 75,
  },
];

export function findProduct(id: string): Product | undefined {
  return CATALOG.find((p) => p.id === id);
}

/** Case-insensitive match on name or category. An empty query matches everything. */
export function searchCatalog(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CATALOG];
  return CATALOG.filter((p) => p.name.toLowerCase().includes(q) || p.category === q);
}
