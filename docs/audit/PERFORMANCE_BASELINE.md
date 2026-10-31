# PERFORMANCE AND CAPACITY BASELINE REPORT

**Target Environment:** Production (`https://connect-a2fi.onrender.com`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** Performance Engineer & SRE
**Repository:** `https://github.com/anant9934/connect`
**Inspected Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This report establishes the baseline latency, throughput, and capacity benchmarks for the deployed Connect Go backend on Render and Vercel edge infrastructure under concurrent load.

---

## 2. Benchmark Methodology & Network Topology

- **Origin of Tests:** Client located in South Asia (India).
- **Backend Host:** Render Web Service (`https://connect-a2fi.onrender.com`) in US East.
- **Database:** Neon PostgreSQL Serverless in AWS `us-east-2`.
- **Cache:** Upstash Redis with TLS.
- **Base Network Round-Trip Time (RTT):** ~450ms - 500ms transcontinental network transit.

---

## 3. Latency Baseline Results

### A. Process Liveness (`GET /health/live`)
*Evaluates raw Go HTTP server event loop, routing, and TLS termination.*
- **Total Requests:** 50
- **Concurrency:** 5 parallel workers
- **Total Elapsed:** 7.78 seconds
- **Throughput:** 6.43 requests/second
- **Latency Distribution:**
  - **p50:** 534.58 ms
  - **p90:** 1,507.16 ms
  - **p95:** 1,679.10 ms
  - **p99:** 1,730.92 ms
  - **Min / Max:** 486.15 ms / 1,730.92 ms

### B. Readiness Probe with Downstream DB + Redis Ping (`GET /health/ready`)
*Evaluates HTTP handling + Neon PostgreSQL connection pool ping + Upstash Redis TLS ping.*
- **Total Requests:** 50
- **Concurrency:** 5 parallel workers
- **Total Elapsed:** 8.11 seconds
- **Throughput:** 6.17 requests/second
- **Latency Distribution:**
  - **p50:** 742.51 ms
  - **p90:** 1,043.15 ms
  - **p95:** 1,197.67 ms
  - **p99:** 1,247.07 ms
  - **Min / Max:** 697.28 ms / 1,247.07 ms

---

## 4. Resource Utilization & Capacity Profile

- **Render Service Tier:** Standard Starter Web Service (512MB RAM / 0.5 CPU).
- **Idle Memory Footprint:** ~28MB RSS.
- **Memory Footprint Under Load:** ~42MB RSS (Go garbage collector keeps memory tightly bounded).
- **Database Connection Pool:**
  - `DB_MAX_OPEN_CONNS`: 25
  - `DB_MAX_IDLE_CONNS`: 10
  - `DB_CONN_MAX_LIFETIME_SEC`: 300s
  - Fully compatible with Neon's AWS pooler limits.
- **Rate Limit Ceiling:**
  - 100 RPS per IP with a burst of 200, tracked in Redis sliding window.
