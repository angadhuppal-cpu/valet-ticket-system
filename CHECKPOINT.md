# 🅿️ Valet Ticket System — Project Checkpoint

_Last updated: 2026-08-03_

A running snapshot of where the project stands: what's built, key decisions,
how to run/test it, the planned GCP deployment, cost estimates, and open items.

---

## 1. What this is

A mobile-first web app that streamlines valet ticketing end to end:

1. **Phone first** — take the car owner's phone number.
2. **Capture the car — two ways:** scan **front/back photos** (AI reads the
   license plate, make/model, and color) or **type** the details.
3. **Auto ticket number** — assigned 1 → N per event (resettable per event).
4. **Text everyone** — SMS each owner their ticket + car details (single or bulk).
5. **Early pickup — two ways:** owner replies by **SMS**, or scans the **QR code**
   on the printed ticket / SMS link and taps "Request my car." Their ticket flips
   to 🔔 **Requested** on the live board; staff mark it **Ready → Delivered**.

Also includes: username/password **accounts** (cookie sessions), **printable QR
tickets**, and an owner-facing public status page.

---

## 2. Current status — DONE ✅

- Full app built and working end to end (verified via API + UI screenshots).
- **Accounts / auth**: signup/login, cookie sessions (scrypt-hashed passwords),
  optional `SIGNUP_CODE` gate; dashboard + APIs protected, public pages open.
- **AI vehicle recognition**: **Google Gemini Flash** (`gemini-2.5-flash`) —
  switched over from Anthropic. Verified via a local fake endpoint (request shape
  + parsing). **Live real-photo test still pending** (see Open Items).
- **SMS**: Twilio REST (send) + inbound webhook (`/api/sms/inbound`) for text-back;
  graceful mock/simulator when unconfigured.
- **Printable QR tickets** + public owner status page (`/ticket.html?t=…`).
- **Deploy assets**: `Dockerfile`, `.dockerignore`, `render.yaml` (free plan),
  GitHub Actions workflow building + publishing the image to GHCR on every push.
- **Test tooling**: `scripts/test-gemini.mjs` for live Gemini verification.
- Everything committed and pushed (see §8).

## Not yet started / in progress 🚧

- **GCP infrastructure (Terraform)** — architecture agreed at a high level, no
  code written yet.
- **SQLite → PostgreSQL refactor** — required before a proper autoscaling GCP
  deploy (see §5).
- **Live Gemini test with a real car photo** — to be run by the user locally /
  in Cloud Shell (sandbox network policy blocks Google APIs).
- **Twilio A2P 10DLC registration** — required for reliable US SMS.

---

## 3. Tech stack

- **Backend**: Node.js 22 + Express.
- **Database**: `node:sqlite` (built-in) — file-based, no native build. _Will move
  to Cloud SQL Postgres for GCP._
- **Frontend**: dependency-free HTML/CSS/JS, mobile-first (served by Express).
- **AI**: Google **Gemini** Messages/`generateContent` API (vision), raw HTTPS.
- **SMS**: Twilio REST API + inbound webhook.
- **QR**: `qrcode` (server-side SVG).
- Runs fully in **demo mode** with no keys (mock AI + simulated SMS).

---

## 4. Repo layout

```
src/
  server.js            # Express app: routes, auth gate, static serving
  db.js                # SQLite schema + helpers (migration target: Postgres)
  auth.js              # scrypt passwords, cookie sessions
  services/
    ai.js              # Gemini vehicle recognition (+ mock fallback)
    sms.js             # Twilio send + message composition (+ mock)
    share.js           # QR code + owner share URL
public/                # index (dashboard), login, ticket (owner), print, app.js, styles.css
scripts/test-gemini.mjs  # live Gemini test CLI
Dockerfile, .dockerignore, render.yaml
.github/workflows/docker-publish.yml
CHECKPOINT.md (this file), README.md, .env.example
```

---

## 5. The one architectural prerequisite: SQLite → Postgres

The app currently stores tickets/accounts/sessions in **SQLite on local disk**.
That does not survive an autoscaling / restarting cloud deployment. For GCP we
move to **Cloud SQL for PostgreSQL**, which requires rewriting `db.js` and the
session/query code from `node:sqlite` to `pg`. Estimated a few hours; it makes
the container fully stateless. (Cheaper alternative — keep SQLite pinned to a
single always-on instance — is possible but not recommended for production.)

---

## 6. Configuration (environment variables)

| Var | Purpose | Notes |
|---|---|---|
| `PORT` | HTTP port | default 3000 |
| `DB_PATH` | SQLite file path | e.g. `./data/valet.db` (until Postgres) |
| `PUBLIC_BASE_URL` | Base URL for QR/share links | set to the live HTTPS URL |
| `SIGNUP_CODE` | Gate extra staff signups | first account is always allowed |
| `GEMINI_API_KEY` | Gemini vision (AI) | **secret** — never commit |
| `GEMINI_MODEL` | Gemini model id | default `gemini-2.5-flash` |
| `GEMINI_BASE_URL` | Override API base | for testing / Vertex swap |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS | **secrets** |

Secrets live only in local `.env` (git-ignored) or the deployment's secret store
(Render env / GCP Secret Manager) — never in git or Terraform state.

---

## 7. How to run & test

**Run locally (demo mode, no keys):**
```bash
npm install && npm start        # http://localhost:3000 → create first account
```

**Test Gemini with a real car photo (needs a key + network):**
```bash
GEMINI_API_KEY=YOUR_KEY node scripts/test-gemini.mjs front.jpg [back.jpg]
# source: "✅ live Gemini" on success
```
_Note: run this on your machine or Cloud Shell — the dev sandbox blocks Google
API egress._

---

## 8. Source control state

- **Repo**: `angadhuppal-cpu/valet-ticket-system`
- **Branch**: `claude/valet-ticket-system-ssqsb0` (currently the default branch;
  no separate `main`, no PR opened yet).
- **Status**: working tree clean; local and `origin` in sync.
- **Prebuilt image**: published to GHCR on every push
  (`ghcr.io/angadhuppal-cpu/valet-ticket-system:latest`, plus per-branch and
  `sha-<commit>` tags).

Commit history:
`Initial system → accounts + QR tickets + deploy → GH Actions image publish →
Render free plan → switch AI to Gemini Flash → Gemini test script`.

---

## 9. Deployment options today

- **Render (quickest)**: `render.yaml` blueprint on the **free** plan (ephemeral
  data, cold starts). Upgrade to Starter (~$7/mo) + disk for persistence.
- **Docker anywhere**: build from `Dockerfile` or pull the GHCR image.
- **GCP (target)**: see §10.

---

## 10. Target GCP architecture (planned, not yet built)

| Layer | Component | GCP service |
|---|---|---|
| Compute | Node container (stateless) | **Cloud Run** |
| Database | tickets/accounts/sessions | **Cloud SQL for PostgreSQL** |
| Images | Docker images | **Artifact Registry** |
| Secrets | Gemini/Twilio keys, DB pw, session secret | **Secret Manager** |
| Networking | Cloud Run → Cloud SQL (private) | **VPC + Serverless VPC Access** |
| Edge (optional) | custom domain, WAF, HTTPS | **HTTPS LB + Cloud Armor + Cloud DNS** |
| Identity | least-privilege runtime + CI auth | **Service Accounts + Workload Identity Federation** |
| CI/CD | build → push → deploy | **Cloud Build** or **GitHub Actions** |
| Observability | logs / metrics / alerts | **Cloud Logging / Monitoring** |

**Terraform layout (planned):** `infra/bootstrap` (GCS remote state) +
`infra/modules/{project-services, network, database, artifact-registry, secrets,
cloud-run, iam, loadbalancer, dns, monitoring}` + `infra/envs/{dev,prod}`.
Secret _values_ never go in Terraform — TF creates empty Secret Manager
containers; values are added out-of-band.

---

## 11. Cost estimate (summary)

- **Fixed GCP infra**: ~**$15–35/mo** lean (small Cloud SQL, scale-to-zero,
  `run.app` URL) → ~**$110–180/mo** production (bigger/HA DB, min-instance,
  HTTPS LB + Cloud Armor).
- **Per car (variable)**: **~$0.04–0.06** — SMS (~2–4¢) dominates; Gemini Flash
  AI is now a **fraction of a cent** (down from ~1–3¢ on the previous model).
- **Twilio fixed**: ~$3/mo (number + A2P campaign). **A2P 10DLC**: ~$4 one-time.
- **Ballpark totals**: pilot ~$40–70/mo; established operator ~$150–300/mo,
  increasingly SMS-driven at volume.

_Estimates, us-central1; actuals depend on chosen tiers and real usage._

---

## 12. Open items & decisions pending

**Build tasks**
- [ ] SQLite → Cloud SQL Postgres refactor (`db.js`, session/query code).
- [ ] Terraform: bootstrap remote state + project-services + Cloud Run / Cloud SQL
      / Secret Manager core, then LB/DNS/CI modules.
- [ ] Twilio signature validation on `/api/sms/inbound` (before public webhook).
- [ ] Live Gemini test with a real car photo (user-run).
- [ ] Twilio A2P 10DLC registration (for real US SMS).

**Decisions to confirm (steer the Terraform)**
- [ ] Database: **Cloud SQL Postgres** (recommended) vs. keep SQLite single-instance.
- [ ] Edge: `*.run.app` URL (simple) vs. custom domain + HTTPS LB + Cloud Armor.
- [ ] Environments: single **prod** vs. **dev + prod** from day one.
- [ ] Region: default **us-central1** (US phone numbers) — confirm.
- [ ] CI/CD: **Cloud Build** vs. **GitHub Actions** (Workload Identity Federation).
- [ ] Gemini access for prod: **API key** (Secret Manager) vs. **Vertex AI** (ADC).
- [ ] Open a **pull request**, or keep working directly on the branch?
