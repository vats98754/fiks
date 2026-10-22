// Registers the shop Domain (CORE; PLAN P8). The Domain object is defined in
// packages/vendor-api/src/domain.ts; the members that live elsewhere come in as parameters:
// the repro hooks from @fiks/repro (shop defaults = ec241bc) and the bench tasks from @fiks/bench.
import { TASKS } from '@fiks/bench';
import { registerDomain } from '@fiks/domains';
import { shopReproEmitter, shopSuite } from '@fiks/repro';
import { createShopDomain } from '@fiks/vendor-api';

registerDomain(createShopDomain({ reproEmitter: shopReproEmitter, suite: shopSuite, tasks: TASKS }));
