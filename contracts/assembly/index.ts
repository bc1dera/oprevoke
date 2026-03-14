// OPNet contract entry point — do not remove the runtime export wildcard.
export * from '@btc-vision/btc-runtime/runtime/exports';

import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { BatchRevoke } from '../src/BatchRevoke';

// Register the contract with the OPNet runtime.
// The runtime calls Blockchain.contract.execute() for every inbound call.
Blockchain.contract = new BatchRevoke();
