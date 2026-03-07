# OPRevoke — Claude Context

## What This App Does
OPRevoke is a non-custodial web UI for managing OP-20 token allowances on OPNet (Bitcoin L1 smart contracts). Users can scan, view, and revoke token approvals they've granted to spenders (DEXes, staking contracts, etc.).

## Tech Stack
- React 19 + TypeScript strict mode + Vite + Tailwind CSS
- OPNet SDK: `opnet`, `@btc-vision/bitcoin`, `@btc-vision/transaction`, `@btc-vision/walletconnect`
- Deployed on Vercel

## Key Files
| File | Purpose |
|------|---------|
| `src/config/contracts.ts` | Token & spender address registry (mainnet + testnet) |
| `src/config/networks.ts` | Network detection & RPC URLs |
| `src/hooks/useAllowances.ts` | Core scan logic, custom token/spender management |
| `src/hooks/useRevoke.ts` | Revocation transaction logic |
| `src/services/ContractService.ts` | Singleton contract instance cache |
| `src/App.tsx` | Main layout & UI orchestration |

## Known Contract Addresses

### Testnet (OPNet Signet — `networks.opnetTestnet`)
- MotoSwap Native Swap: `0x4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5`
- MotoSwap LP Router: `0x0e6ff1f2d7db7556cb37729e3738f4dae82659b984b2621fab08e1111b1b937a`
- MotoSwap Staking: `0x831ca1f8ebcc1925be9aa3a22fd3c5c4bf7d03a86c66c39194fef698acb886ae`
- MOTO token: `opt1sqzkx6wm5acawl9m6nay2mjsm6wagv7gazcgtczds`
- PILL token: `opt1sqp5gx9k0nrqph3sy3aeyzt673dz7ygtqxcfdqfle`

### Mainnet
- MotoSwap Native Swap: `0x4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5`
- See `src/config/contracts.ts` for full list

## Critical OPNet Rules (DO NOT BREAK)
- **Never** use `networks.testnet` — OPNet testnet is `networks.opnetTestnet` (Signet fork)
- **Never** construct raw PSBTs — wallet handles all signing
- **Frontend revoke calls**: `signer: null, mldsaSigner: null` in `sendTransaction()`
- Always `simulate()` before `sendTransaction()`
- Use `getContract<IOP20Contract>()` from `opnet` package for all contract calls
- Contract cache is keyed by `networkId:address` — call `clearCache()` on network change
- Network comparison uses bech32 prefix (not object reference equality)

## Scan Flow
1. Discover tokens (fallback to hardcoded config)
2. Merge with user-added custom tokens (persisted in `localStorage: oprevoke:customTokens`)
3. For each token × spender pair, call `contract.allowance(userAddress, spenderAddr)`
4. Record entries where `remaining > 0n`

## Revoke Flow
1. Get contract via `ContractService`
2. Call `contract.decreaseAllowance(spender, currentAllowance)`
3. Simulate: `contract.decreaseAllowance(...).simulate(provider, ...)`
4. Send: `simulation.sendTransaction({ signer: null, mldsaSigner: null, refundTo, feeRate: 10, maximumAllowedSatToSpend: 10000n, network })`

## Adding New Tokens/Spenders
Edit `src/config/contracts.ts` — add to both `MAINNET_SPENDERS`/`MAINNET_TOKENS` and `TESTNET_SPENDERS`/`TESTNET_TOKENS` as appropriate. If a contract exists on both networks, add it to both arrays.

## Dev Commands
```bash
npm run dev        # local dev server
npm run build      # typecheck + build to /dist
npm run lint       # ESLint strict
npm run typecheck  # tsc strict (no emit)
```
