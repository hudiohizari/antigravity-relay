# Antigravity Relay

Desktop account management, quota orchestration, and mobile remote control relay for Google Antigravity 2.0.

![Antigravity Relay Accounts Dashboard](images/app-preview.png)

> **Attribution**: Forked and adapted from [Antigravity Manager](https://github.com/Draculabo/AntigravityManager) by Draculabo. Antigravity Relay focuses exclusively on Antigravity 2.0, strips third-party telemetry, and isolates local storage to `~/.antigravity-relay/`.

---

## Highlights

### 1. Multi-Account Pool & Quota Orchestration

Connect multiple Google accounts via OAuth 2.0 loopback authentication. Monitor real-time quota fraction, 5-hour rolling pool limits, and individual model quotas (`gemini-3.8-flash`, `gemini-3.1-pro`, `claude-opus-4-6`, `claude-sonnet-4-6`) with live reset countdown timers and intelligent automatic failover.

### 2. Remote Mobile Tethering & Web UI Mirror

Supervise and control Antigravity sessions directly from your mobile device (iOS Safari / Android Chrome) over Local Wi-Fi or Cloudflare Quick Tunnels.

![Remote Control & Mobile Tethering](images/remote-control-preview.png)

- **Fastify Reverse Proxy**: Decoupled local relay server with zero impact on desktop agent execution.
- **One-Click Cloudflare Tunnel**: Automatic `cloudflared` binary detection with instant public HTTPS/WSS pairing.
- **Single-Use QR Pairing**: Secure tokenized pairing links for camera scan and instantaneous PWA connection.
- **Device Identification**: Persistent device fingerprinting (`ag_device_id`) preventing multi-tab session duplication, live heartbeat indicators, and 1-click remote session revocation.

### 3. System Tray Quick Switcher

Resident in your macOS Menu Bar / Windows System Tray for instant background management.

![System Tray Quick Switcher](images/tray-preview.png)

- **One-Click Rotation**: Switch to the next available account in the pool (`⌘N` / Tray click) without interrupting your IDE.
- **At-a-Glance Quota**: View 5h pool bottleneck and per-model quotas instantly.
- **Background Persistence**: Minimizes seamlessly to tray with zero UI overhead.

---

## Features

- **Antigravity 2.0 Focused**: Dedicated integration and account switching tailored exclusively for Google Antigravity 2.0.
- **Multi-Account Pool**: Connect and manage multiple Google accounts via OAuth 2.0 loopback authentication.
- **Local Account Discovery & Sync**: One-click discovery, verification, and import of local signed-in accounts across System Credential Store (macOS Keychain / Linux Secret Service), Antigravity CLI session files, IDE databases, and legacy Antigravity Manager databases (`~/.antigravity-agent/cloud_accounts.db`) with proactive token refresh.
- **Live Quota Monitoring**: Real-time per-model quota tracking, background polling, and reset timers.
- **Remote Mobile Tethering & Web UI Mirror**: Fastify reverse proxy mirror for Antigravity web interface with automatic upstream port discovery, proactive `cloudflared` binary availability detection with graceful disabled states, Cloudflare Tunnel support, and Local Wi-Fi QR pairing.
- **Device Identification & Session Deduplication**: Persistent device tracking (`ag_device_id` cookie / header) to prevent multi-tab session duplication, dual-mode real-time connection state (WebSocket + 45s HTTP activity), and remote session revocation.
- **System Tray Residency**: Menu bar quick switcher with global quota telemetry and hotkey support.
- **Zero Third-Party Telemetry**: Completely stripped of telemetry, crash beacons, and analytics (no Clarity, no Sentry, no OpenTelemetry).
- **Isolated & Encrypted Storage**: Dedicated storage (`~/.antigravity-relay/`) encrypted via OS Keychain (`AntigravityRelay`) with AES-256-GCM.

---

## Tech Stack

- **Runtime**: Electron 40+, Node.js 22+
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, Radix UI, TanStack Router & Query
- **Backend / IPC**: Electron Forge, Fastify, oRPC, SQLite (better-sqlite3) via Drizzle ORM
- **Packaging**: Electron Forge (Vite plugin + Auto-Unpack Natives)

---

## Quick Start

### Prerequisites

- Node.js >= 22.14.0
- pnpm >= 10
- `cloudflared` _(optional, required for Cloudflare Quick Tunnel)_:
  - macOS: `brew install cloudflared`
  - Windows: `winget install --id Cloudflare.cloudflared`
  - Linux: `sudo apt install cloudflared`
  - _Note_: If `cloudflared` is not installed, tunnel controls in the Dashboard and Status Bar are automatically disabled with setup guidance and one-click commands.

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

## Storage & Security

- **Database**: `~/.antigravity-relay/cloud_accounts.db` (encrypted with SQLCipher / AES-256-GCM)
- **Config & Logs**: `~/.antigravity-relay/`
- **Keytar Service**: `AntigravityRelay`

---

## License

MIT
