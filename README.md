# OPRevoke

A token allowance manager for the [OPNet](https://opnet.org) Bitcoin Layer 1 smart contract platform.

OPRevoke lets you view and revoke OP-20 token approvals you've granted to spenders — so you stay in full control of your Bitcoin assets.

## Features

- Connect your OPNet-compatible wallet
- View all OP-20 token allowances granted to spenders
- Revoke approvals in one click
- Add custom tokens by contract address (`op1…` or `0x…`)
- Supports Mainnet and Testnet

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev)
- [OPNet SDK](https://github.com/btc-vision/opnet)
- [@btc-vision/bitcoin](https://github.com/btc-vision/bitcoin)

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## What is OPNet?

OPNet is a Bitcoin Layer 1 smart contract platform that uses Tapscript-encoded calldata. OP-20 is the fungible token standard on OPNet, similar to ERC-20 on Ethereum.

## License

MIT
