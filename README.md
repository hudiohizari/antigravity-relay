# Antigravity Relay

Desktop account management and session relay for Google Antigravity 2.0.

> **Attribution**: Forked and adapted from [Antigravity Manager](https://github.com/Draculabo/AntigravityManager) by Draculabo. Antigravity Relay focuses exclusively on Antigravity 2.0, strips third-party telemetry, and isolates local storage to `~/.antigravity-relay/`.

---

## Features

- **Antigravity 2.0 Focused**: Dedicated integration and account switching for Google Antigravity 2.0.
- **Multi-Account Pool**: Connect and manage multiple Google accounts via OAuth 2.0 loopback authentication.
- **Local Account Discovery & Sync**: One-click discovery, verification, and import of local signed-in accounts across System Credential Store (macOS Keychain / Linux Secret Service), Antigravity CLI session files, IDE databases, and legacy Antigravity Manager databases (`~/.antigravity-agent/cloud_accounts.db`) with proactive token refresh.
- **Live Quota Monitoring**: Real-time per-model quota tracking, background polling, and reset timers.
- **Remote Mobile Tethering & Web UI Mirror**: Fastify reverse proxy mirror for Antigravity web interface with automatic upstream port discovery, Cloudflare Tunnel support, and Local Wi-Fi QR pairing.
- **Device Identification & Session Deduplication**: Persistent device tracking (`ag_device_id` cookie / header) to prevent multi-tab session duplication, dual-mode real-time connection state (WebSocket + 45s HTTP activity), and remote session revocation.
- **Zero Third-Party Telemetry**: Completely stripped of telemetry, crash beacons, and analytics (no Clarity, no Sentry, no OpenTelemetry).
- **Isolated & Encrypted Storage**: Dedicated storage (`~/.antigravity-relay/`) encrypted via OS Keychain (`AntigravityRelay`) with AES-256-GCM.

---

## Tech Stack

- **Runtime**: Electron 40+, Node.js 22+
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Radix UI
- **Backend / IPC**: Electron Forge, Fastify, oRPC, SQLite (better-sqlite3) via Drizzle ORM
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
