// OPNet contract entry point — do not remove the runtime export wildcard.
export * from '@btc-vision/btc-runtime/runtime/exports';

import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { BatchRevoke } from '../src/BatchRevoke';

// Blockchain.contract expects a factory function: () => OP_NET
Blockchain.contract = (): BatchRevoke => new BatchRevoke();
