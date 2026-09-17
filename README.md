# ALTCHA Self-Hosted & Manager (Sentinel)

ALTCHA is a self-hosted, privacy-first security solution that protects your websites, APIs, and online services from spam and abuse through a proof-of-work mechanism. This repository provides the complete backend service, rate limiter, domain whitelist protection, SQLite audit logger, and an integrated AdminLTE v4 management dashboard.

---

## 📁 Directory Structure

```text
altcha-selfhosted/
├── src/                          # Backend source code
│   ├── config.js                 # Environment configuration & path resolvers
│   ├── database.js               # SQLite access logging & aggregation
│   └── server.js                 # Express server & API endpoints
├── web/                          # Frontend dashboard & AdminLTE v4 assets
│   ├── index.html                # Telemetry & metrics overview
│   ├── keys.html                 # Key & Domain Manager (API keys & domain binding)
│   ├── integration.html          # API, code snippets & widget playground
│   ├── logs.html                 # Audit & access log explorer
│   ├── users.html                # User & role management (admin only)
│   ├── pow-policy.html           # Proof-of-Work difficulty configuration
│   ├── settings.html             # Branding & general settings
│   ├── login.html                # Authentication entry
│   ├── templates/                # Modular sidebar, header, footer partials
│   ├── css/                      # AdminLTE styling
│   └── js/                       # Modular UI scripts
├── database/                     # SQLite database files (altcha.db, log.altcha.db)
├── Dockerfile                    # Production Docker build
├── docker-compose.yml            # Docker Compose deployment definition
├── .dockerignore                 # Docker build ignore patterns
└── package.json                  # NPM dependencies & scripts
```

---

## 🚀 Quick Start (Local)

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env` and configure your HMAC key:
   ```bash
   cp .env.example .env
   ```

3. **Start the Application**:
   ```bash
   # Production mode
   npm start

   # Development mode with file watching
   npm run dev
   ```

4. **Access the Dashboard**:
   - ALTCHA Service: `http://localhost:3000`
   - ALTCHA Manager: `http://localhost:3000/manager`

---

## 🐳 Docker Deployment

The application is fully containerized and runs as a non-root `node` user for production security.

```bash
# Build and start services in the background
docker compose up -d --build

# View logs
docker compose logs -f altcha-server

# Check health status
docker compose ps
```

### Persistent Volumes
- `./database`: Contains SQLite database files (`altcha.db` for app data & `log.altcha.db` for telemetry/access logs).
- `./log`: Access logs directory.