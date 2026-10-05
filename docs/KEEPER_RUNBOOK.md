# Epoch Protocol — Always-On Keeper Runbook & Operational Guide

**Source of Truth**: `docs/04-INTEGRATION_SPEC.md §8`, `docs/09-UX_SPEC.md §3.4`, Report 6 Item 7.  
**Classification**: `[MEASURED]` telemetry and `[SOURCED]` protocol parameters.

---

## 1. Executive Summary & Architecture

The Epoch Keeper is a permissionless off-chain service responsible for maintaining protocol liveness, executing batch crossing auctions, settling user ledgers, and providing Backstop Liquidity via the automated vault ladder.

### Architectural Core
- **Permissionless Clearing**: Any cranker can invoke `clear_batch` and `settle_users`.
- **Bundled Atomic Execution**: For batches where active participants fit in a single transaction ($\le 16$ distinct users), `clear_batch` and `settle_users` are bundled into a single atomic transaction. This guarantees immediate state transition from `OPEN` to `SETTLED` in one slot, eliminating post-clearing settlement backlog and keeping ring occupancy $\le 2$ (well within $R=8$).
- **Dual Connection Model**:
  - **WebSocket Slot Feed**: Low-latency `onSlotChange` subscription (`wss://api.devnet.solana.com`) for sub-millisecond slot tracking.
  - **HTTP/2 Cranking RPC**: Premium RPC (`https://devnet.helius-rpc.com`) with priority fees (`100,000` to `150,000` microLamports) for transaction submission and state queries.

---

## 2. Key Separation & Security Architecture

To prevent compromised operational keys from affecting program governance:
1. **Program Upgrade Authority Key**:
   - Address: `D2Lf1YPGLDLKBpm6h5tWGYmkxVs7ArDLudGqCzDrxaeR`
   - Purpose: Program deployment, parameter updates (`update_market_params`, `update_vault_params`).
   - Storage: Cold hardware wallet / air-gapped secure keystore. **Never loaded on the live keeper server.**
2. **Dedicated Cranker / Keeper Key**:
   - Address: `EARRxREsGyHaeNwQmeaMnL6osLoyiwHsA5XSYqqQC5j2`
   - Purpose: Transaction fee payment and permissionless cranking (`clear_batch`, `settle_users`, `vault_quote`, `liquidate`).
   - Funding: Maintained with 2.0 to 5.0 SOL working balance.
   - Permissions: Zero protocol admin authority; permissionless cranker only.

---

## 3. Economic Sizing & Operational Burn Rate

Based on continuous telemetry measured on Solana Devnet:
- **Compute Unit Consumption**:
  - `clear_batch`: 16,840 to 34,812 CU `[MEASURED]`
  - `settle_users`: ~14,200 CU (4 users) `[MEASURED]`
  - Bundled `clear_and_settle`: ~31,000 to ~48,000 CU `[MEASURED]`
  - `vault_quote`: ~18,500 CU `[MEASURED]`
- **Transaction Costs**:
  - Base signature fee: `5,000` lamports (0.000005 SOL)
  - Priority fee (at 100k microLamports / 500k CU): `5,000` lamports (0.000005 SOL)
  - Total per bundled clearance: `0.000010 SOL`
- **Measured Daily Burn Rate**:
  - 30-minute continuous pressure soak: `0.02065 SOL` spent across 403 submitted transactions.
  - Extrapolated 24-hour continuous active load: $\approx 0.99\text{ SOL / day}$ `[MEASURED]`.
  - Normal idle/light load (vault quoting every 5s): $\approx 0.15\text{ to }0.25\text{ SOL / day}$ `[ESTIMATE]`.
- **Funding Policy**: Maintain a minimum balance of `0.50 SOL`. Alert on `< 0.30 SOL`.

---

## 4. Production Deployment: Systemd Service (Linux VM)

For a dedicated Linux instance (Ubuntu 22.04 LTS / Debian 12 / AWS t4g.medium):

### 4.1 System Prerequisites
```bash
# Install Bun runtime
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Create epoch service user and directory
sudo useradd -r -s /bin/false epoch-keeper
sudo mkdir -p /etc/epoch /var/log/epoch
sudo chown -R epoch-keeper:epoch-keeper /var/log/epoch
```

### 4.2 Keeper Keypair Setup
```bash
# Copy dedicated keeper keypair (never use the deployer key)
sudo cp keeper/keeper-keypair.json /etc/epoch/keeper.json
sudo chmod 600 /etc/epoch/keeper.json
sudo chown epoch-keeper:epoch-keeper /etc/epoch/keeper.json
```

### 4.3 Systemd Unit Configuration: `/etc/systemd/system/epoch-keeper.service`
```ini
[Unit]
Description=Epoch Protocol Automated Keeper & Liquidity Cranker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=epoch-keeper
Group=epoch-keeper
WorkingDirectory=/opt/epoch/keeper
Environment="PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin"
Environment="EPOCH_RPC_URL=https://devnet.helius-rpc.com/?api-key=7f051d79-ac86-4394-bae9-346f64974d1a"
Environment="EPOCH_WS_URL=wss://api.devnet.solana.com"
Environment="EPOCH_PROGRAM_ID=CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap"
Environment="EPOCH_KEEPER_KEYPAIR_PATH=/etc/epoch/keeper.json"
Environment="NODE_ENV=production"

ExecStart=/home/ubuntu/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=3s
LimitNOFILE=65536

StandardOutput=append:/var/log/epoch/keeper.log
StandardError=append:/var/log/epoch/keeper.error.log

[Install]
WantedBy=multi-user.target
```

### 4.4 Enable & Start Service
```bash
sudo systemctl daemon-reload
sudo systemctl enable epoch-keeper
sudo systemctl start epoch-keeper
sudo systemctl status epoch-keeper
```

### 4.5 Log Rotation Configuration: `/etc/logrotate.d/epoch-keeper`
```
/var/log/epoch/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 epoch-keeper epoch-keeper
}
```

---

## 5. Docker Container Deployment

For container-managed clusters (ECS, Kubernetes, Nomad, or Docker Compose):

### 5.1 Dockerfile (`keeper/Dockerfile`)
```dockerfile
FROM oven/bun:1.3.11-alpine AS runner
WORKDIR /app

COPY package.json ./
RUN bun install --frozen-lockfile || bun install

COPY src/ ./src/
COPY ../app/src/lib/epoch_idl.json ./src/
COPY ../target/idl/epoch.json ./dist/idl.json

ENV NODE_ENV=production
ENTRYPOINT ["bun", "run", "src/index.ts"]
```

### 5.2 Docker Compose (`docker-compose.keeper.yml`)
```yaml
version: '3.8'

services:
  epoch-keeper:
    build:
      context: ./keeper
      dockerfile: Dockerfile
    restart: always
    environment:
      - EPOCH_RPC_URL=https://devnet.helius-rpc.com/?api-key=7f051d79-ac86-4394-bae9-346f64974d1a
      - EPOCH_WS_URL=wss://api.devnet.solana.com
      - EPOCH_PROGRAM_ID=CcEnJJnyCAPRJXJQHQKdmMpcfhrmmQHaoumnmbbcgHap
      - EPOCH_KEEPER_KEYPAIR_PATH=/secrets/keeper.json
    volumes:
      - ./keeper/keeper-keypair.json:/secrets/keeper.json:ro
      - keeper-logs:/var/log/epoch
    healthcheck:
      test: ["CMD", "bun", "run", "src/index.ts", "--once"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  keeper-logs:
```

---

## 6. Health Logging, Heartbeat & Telemetry

### 6.1 Telemetry JSON Schema
Every clearance, quote, and settlement is structured into `keeper/logs/keeper.log`:
```json
{
  "signature": "5iWbSPvp9Z2i33RbDt4cF8cwGjFq9xoQ4scdmkvexti2QNLwMF91imeRytVDn1nnCYCvRuStwYEbC4BgYu84Regn",
  "kind": "clear_and_settle",
  "source": "keeper",
  "network": "devnet",
  "submit_slot": 507649410,
  "landed_slot": 507649414,
  "cu_consumed": 38412,
  "success": true,
  "error": null,
  "created_at": "2026-10-05T07:05:00.000Z",
  "batch_id": 138380,
  "ring_index": 4
}
```

### 6.2 Frontend "Keeper Offline" Alarm
The UI polls on-chain state or snapshot every 2.5 seconds:
- If `Date.now() - last_cleared_batch_timestamp > 15,000 ms`, the UI renders a top banner:
  $$\text{"Keeper Offline: Last batch cleared } \Delta t \text{ ago. Settlement may be delayed."}$$
- When cleared within $< 15$ seconds, the status badge indicates: `Keeper: Online (Devnet)`.

---

## 7. Operational Troubleshooting & Runbook Procedures

| Symptom | Probable Cause | Action |
|---|---|---|
| `RingSlotBusy (6007)` | Unsettled orders in target batch slot $t \pmod 8$ | Check keeper logs; invoke `settleUsers` or let bundled clear+settle drain ring. |
| `BatchClosed (6008)` | Order landed $\ge$ close slot | Verify WebSocket slot feed latency; ensure client targets $B + L$ where $L=3$. |
| `429 Too Many Requests` | Excessive RPC polling on public Devnet | Ensure `dataConnection` is using authenticated RPC (`Helius`) with batch account decoding. |
| `Low Balance` (<0.3 SOL) | Normal operational cranker gas depletion | Transfer 2.0 SOL from administrative wallet to `EARRxREsGyHaeNwQmeaMnL6osLoyiwHsA5XSYqqQC5j2`. |
