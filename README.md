# Antigravity Relay

Desktop account management and session relay for Google Antigravity 2.0.

> **Attribution**: Forked and adapted from [Antigravity Manager](https://github.com/Draculabo/AntigravityManager) by Draculabo. Antigravity Relay focuses exclusively on Antigravity 2.0, strips third-party telemetry, and isolates local storage to `~/.antigravity-relay/`.

---

## Features

- **Antigravity 2.0 Focused**: Dedicated integration and account switching for Google Antigravity 2.0.
- **Multi-Account Pool**: Connect and manage multiple Google accounts via OAuth 2.0 loopback authentication.
- **Live Quota Monitoring**: Real-time per-model quota tracking, background polling, and reset timers.
- **Session Relay & Remote**: Built-in relay server allowing remote session observation and coordination.
- **Zero Third-Party Telemetry**: Completely stripped of telemetry, crash beacons, and analytics (no Clarity, no Sentry, no OpenTelemetry).
- **Isolated & Encrypted Storage**: Dedicated storage (`~/.antigravity-relay/`) encrypted via OS Keychain (`AntigravityRelay`) with AES-256-GCM.

---

## Tech Stack

- **Runtime**: Electron 40+, Node.js 22+
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Radix UI
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

### Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Configure your Google OAuth credentials in `.env` (or set them as GitHub Secrets for CI/CD release builds):

```env
ANTIGRAVITY_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
ANTIGRAVITY_OAUTH_CLIENT_SECRET=your-client-secret
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

## Storage

- **Database**: `~/.antigravity-relay/cloud_accounts.db`
- **Config & Logs**: `~/.antigravity-relay/`
- **Keytar Service**: `AntigravityRelay`

---

## License

MIT
