1. _Any_ access to the Magento file system _must_ be done in `src/magentoFS.ts`. This module should be treated as an API that will eventually be exposed for other node-based tooling that works against Magento.