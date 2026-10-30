# TATHASTU CONNECT — INDIA SELF-HOSTED LIVEKIT STAGING PACKAGE
**Environment:** Staging Pilot (Mumbai `in-bom`)  
**Production Policy:** LiveKit Cloud remains active for all production traffic. Zero production credentials are used here.

---

## 1. Directory Structure

```
infra/staging-livekit/
├── .env.staging.example       # Staging environment template (zero secrets)
├── docker-compose.yml         # Container orchestrator (LiveKit, Caddy, Prometheus, Node-Exporter)
├── livekit.yaml.template      # LiveKit SFU configuration template
├── caddy/
│   └── Caddyfile              # TLS termination & WSS proxy on Primary Public IP (443)
├── redis/
│   ├── redis.conf             # Hardened Mumbai Local Redis configuration (Private VLAN)
│   └── sentinel.conf          # Automated Master Failover configuration
├── prometheus/
│   └── prometheus.yml         # Telemetry scraper for LiveKit (:6789) and Node (:9100)
├── load-test/
│   └── load-test-plan.md      # 50, 100, 200, 500 CCU load testing protocol
└── README.md                  # This runbook
```

---

## 2. Infrastructure Prerequisites (Akamai Mumbai)

1. **Compute Instances:**
   * **Node 1 (SFU Media):** Linode Dedicated 8GB (4 Dedicated vCPUs, 8 GB RAM, 160 GB NVMe) in Mumbai (`in-bom`).
   * **Node 2 (SFU Media):** Linode Dedicated 8GB in Mumbai.
   * **Node 3 (Coordinator):** Linode Dedicated 4GB (2 Dedicated vCPUs, 4 GB RAM) for local Redis/KeyDB.
2. **Network & IP Allocations:**
   * **Linode VLAN (Private Network):** Attach all 3 nodes to a Mumbai private VLAN (`192.168.10.0/24`). All Redis traffic travels over this VLAN (< 1ms latency).
   * **Public IPv4 Allocation:** Each SFU media node requires **two public IPv4 addresses**:
     * `IP 1` (Primary): Used by Caddy for HTTPS/WSS on port 443 and WebRTC UDP ports 50000–60000.
     * `IP 2` (Secondary): Used exclusively by LiveKit embedded TURN over TLS on port 443 (avoids port 443 binding conflicts).
3. **DNS Records (Cloudflare / DNS Provider):**
   * `connect-staging-node1.aitathastu.com` -> Points to Node 1 Primary IP (DNS-only, bypass Cloudflare proxy)
   * `turn-staging-node1.aitathastu.com` -> Points to Node 1 Secondary IP (DNS-only)
   * `connect-staging-node2.aitathastu.com` -> Points to Node 2 Primary IP (DNS-only)
   * `turn-staging-node2.aitathastu.com` -> Points to Node 2 Secondary IP (DNS-only)

---

## 3. Host Kernel Optimization

Run on both media host instances before starting containers:

```bash
sudo cat <<EOF >> /etc/sysctl.d/99-livekit.conf
# Maximum receive/send socket buffer sizes (16MB)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
# Network device backlog queue depth
net.core.netdev_max_backlog = 100000
# File descriptor limits
fs.file-max = 2097152
EOF

sudo sysctl --system
```

---

## 4. Staging Deployment Procedure

1. **Clone repository onto Staging VM:**
   ```bash
   git clone https://github.com/shiviiii5165/connect.git /opt/connect
   cd /opt/connect/infra/staging-livekit
   ```
2. **Configure Environment:**
   ```bash
   cp .env.staging.example .env
   # Edit .env with real staging IPs, domains, and generated passwords
   chmod 600 .env
   ```
3. **Generate Configuration:**
   ```bash
   # Substitute environment variables into livekit.yaml
   envsubst < livekit.yaml.template > livekit.yaml
   ```
4. **Start Staging Services:**
   ```bash
   docker compose up -d
   ```
5. **Verify Service Health:**
   ```bash
   # Check container status
   docker compose ps

   # Verify LiveKit HTTP health probe
   curl -i http://127.0.0.1:7880/

   # Verify Prometheus metrics endpoint (Port 6789)
   curl -i http://127.0.0.1:6789/metrics

   # Verify WSS TLS signaling
   wscat -c wss://connect-staging-node1.aitathastu.com/
   ```

---

## 5. Instant Rollback to LiveKit Cloud (Zero-Downtime Failsafe)

If any quality degradation, packet loss, or server instability occurs during staging tests:
1. Production currently points to `LIVEKIT_URL=wss://tathastu-connect-htzr4167.livekit.cloud`.
2. Staging API points to `LIVEKIT_URL=wss://connect-staging-node1.aitathastu.com`.
3. To immediately revert staging traffic back to LiveKit Cloud:
   * Update `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the Go API backend environment variables.
   * Restart Go API service.
   * Time to restore: **< 10 seconds**.
