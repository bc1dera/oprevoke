import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';
import { BatchRevoke } from '../src/BatchRevoke';

// DO NOT TOUCH THIS.
Blockchain.contract = (): BatchRevoke => {
    // ONLY CHANGE THE CONTRACT CLASS NAME.
    return new BatchRevoke();
};

// VERY IMPORTANT — must come after Blockchain.contract assignment.
export * from '@btc-vision/btc-runtime/runtime/exports';

// VERY IMPORTANT — required abort handler.
export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}
