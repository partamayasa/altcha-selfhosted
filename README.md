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
│   ├── index.html                # Main dashboard entry
│   ├── playground.html           # Interactive testing & snippets
│   ├── whitelist.html            # Domain whitelist management
│   ├── audit-logs.html           # Live log explorer
│   ├── js/                       # Modular UI scripts
│   ├── partials/                 # Header, sidebar, footer templates
│   └── dist/                     # AdminLTE & Bootstrap assets
├── tools/                        # Development & testing utilities
│   ├── altcha-widget.html        # Standalone widget test page
│   └── altcha-rate-tester.html   # Rate limiter & whitelist test harness
├── config/                       # Configuration templates
│   └── whitelist.example.json    # Example domain whitelist configuration
├── database/                     # SQLite database files (persistent volume)
├── log/                          # Daily rotation text log files (persistent volume)
├── Dockerfile                    # Production multi-stage Docker build
├── docker-compose.yml            # Docker Compose deployment definition
├── .dockerignore                 # Docker build ignore patterns
├── package.json                  # NPM dependencies & scripts
└── whitelist.json                # Runtime domain whitelist configuration
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
- `./database`: Contains SQLite database files (`altcha.db`).
- `./log`: Contains daily access log files.
- `./whitelist.json`: Live domain whitelist file mounted into the container.