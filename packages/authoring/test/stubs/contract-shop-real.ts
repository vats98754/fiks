// Stub contract author that writes the hand-written shop contracts (read-after-write included), so
// a test can check that the evaluation replays the calls and runs the read-after-write probe.
import { readFileSync } from 'node:fs';
import type { StubAuthor } from '../../src/stub.ts';

const SHOP = new URL('../../../contracts/contracts/shop-mcp.contracts.json', import.meta.url);

const author: StubAuthor = (req) =>
  req.route === 'session' ? { files: { 'out/contracts.json': readFileSync(SHOP, 'utf8') } } : { text: '{}' };

export default author;
