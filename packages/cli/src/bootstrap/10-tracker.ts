// Registers the tracker Domain (DOM2; PLAN P8), so `--domain tracker` resolves through the
// registry. Imports @fiks/domains and @fiks/vendor-tracker only.
import { registerDomain } from '@fiks/domains';
import { trackerDomain } from '@fiks/vendor-tracker';

registerDomain(trackerDomain);
