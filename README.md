
# OPRevoke

OPRevoke is a token allowance manager built for the [OPNet](https://opnet.org) Bitcoin Layer 1 smart contract platform. It gives users full visibility and control over OP-20 token approvals — so you can see exactly which contracts have spending access to your tokens and revoke them instantly.

Think of it as the Bitcoin-native version of revoke.cash, but built specifically for OPNet.

---

## The Problem

Every time you interact with a DeFi protocol on OPNet, you grant it an allowance to spend your OP-20 tokens. Over time, these approvals pile up — and any one of them could be exploited if a contract is compromised. Most users have no idea how many approvals they've given or to whom.

## The Solution

OPRevoke gives you a clear dashboard of every active allowance tied to your wallet. With one click, you can revoke any approval you no longer trust — reducing your attack surface and keeping your Bitcoin assets safe.

---

## Features

- Connect your OPNet-compatible wallet
- View all OP-20 token allowances granted to spenders
- Revoke approvals in one click
- Add custom tokens by contract address (`op1…` or `0x…`)
- Supports Mainnet and Testnet
- Clean, fast UI built for real users

---

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev)
- [OPNet SDK](https://github.com/btc-vision/opnet)
- [@btc-vision/bitcoin](https://github.com/btc-vision/bitcoin)

---

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

---

## What is OPNet?

OPNet is a Bitcoin Layer 1 smart contract platform that uses Tapscript-encoded calldata. OP-20 is the fungible token standard on OPNet, similar to ERC-20 on Ethereum — enabling DeFi, tokens, and smart contracts directly on Bitcoin.

---

## Built for the Vibecode.finance Hackathon

OPRevoke was built as a submission for the [Vibecode.finance](https://vibecode.finance) challenge — bringing essential DeFi security tooling to the OPNet ecosystem.

---

## License

MIT
```
