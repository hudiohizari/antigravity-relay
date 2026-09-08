# Antigravity Relay

Desktop account management and session relay for Google Antigravity.

> **Attribution**: Cloned and adapted from [Antigravity Manager](https://github.com/Draculabo/AntigravityManager) by Draculabo. Antigravity Relay streamlines the codebase by removing standalone proxy server modules and focusing specifically on account pooling, quota monitoring, and session relaying.

---

## Features

- **Multi-Account Pool**: Connect and manage multiple Google Gemini accounts via OAuth 2.0 loopback authentication.
- **Quota Monitoring**: Live per-model quota tracking, automatic background polling, and reset timers.
- **Relay & Remote**: Built-in relay server allowing remote session observation and coordination.
- **Environment Switching**: One-click switching of active accounts across Antigravity and Antigravity CLI (`agy`).
- **Isolated & Encrypted Storage**: Account credentials and tokens are stored separately from Antigravity Manager (`~/.antigravity-relay/`) and encrypted using OS Keychain (`AntigravityRelay`) with AES-256-GCM.

---

## Tech Stack

- **Runtime**: Electron 40+, Node.js 22+
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Radix UI / shadcn
- **Backend / IPC**: Electron Forge, oRPC, SQLite (better-sqlite3) via Drizzle ORM
- **Packaging**: Electron Forge (Vite plugin + Auto-Unpack Natives)

---

## Quick Start

### Prerequisites

- Node.js >= 22.14.0
- pnpm >= 10

### Installation

```bash
git clone https://github.com/hudiohizari/antigravity-relay.git
cd antigravity-relay
pnpm install
```

### Development

```bash
pnpm start
```

### Type Checking & Testing

```bash
pnpm run type-check
pnpm test
```

### Packaging

```bash
pnpm run package
pnpm run make
```

---

## Storage & Configuration

- **Database**: `~/.antigravity-relay/cloud_accounts.db`
- **Config & Logs**: `~/.antigravity-relay/`
- **Keytar Service**: `AntigravityRelay`

---

## License

MIT
