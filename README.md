# ALTCHA Self-Hosted & Manager

ALTCHA is a self-hosted, privacy-first security solution that protects your websites, APIs, and online services from spam and abuse through a proof-of-work mechanism. This repository provides the complete backend service, rate limiter, domain whitelist protection, dual-database SQLite audit logging, and an integrated AdminLTE v4 management dashboard.

---

## Directory Structure

```text
altcha-selfhosted/
├── src/                          # Backend source code
│   ├── config.js                 # Environment configuration & path resolvers
│   ├── database.js               # SQLite data persistence & telemetry logger
│   └── server.js                 # Express server & API endpoints
├── web/                          # Frontend dashboard & AdminLTE v4 assets
│   ├── index.html                # Telemetry & metrics overview
│   ├── keys.html                 # Key & Domain Manager (API keys & domain binding)
│   ├── integration.html          # API documentation & integration playground
│   ├── logs.html                 # Audit & access log explorer
│   ├── users.html                # User & role management (administrator only)
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

## Features

- **Self-Hosted PoW Engine**: Generate and verify ALTCHA proof-of-work challenges without third-party tracking.
- **Dual-Database SQLite Architecture**:
  - `altcha.db`: Stores transactional application data, user accounts, sessions, and system settings.
  - `log.altcha.db`: Dedicated database for request telemetry, access logs, and performance metrics.
- **Auto-Population on First Boot**: Automatically initializes schemas, default settings, and seeds the initial administrator account if database files are absent.
- **Key & Domain Manager**: Generate and rotate API keys with strict origin whitelist binding (including wildcard `*` support).
- **User Management & RBAC**: Manage users, assign administrator or user roles, and enforce password/confirm password matching.
- **Account Security**: Self-service Change Password functionality accessible from the user dropdown and sidebar.
- **Anti-Replay Protection**: Redis integration with automatic fallback to memory cache.
- **Rate Limiter**: Configurable request throttling per IP.
- **Integrated AdminLTE v4 Dashboard**: Clean, responsive management UI with extensionless URLs and dark mode support.

---

## Quick Start (Local)

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Configure Environment**:
   Copy `.env.example` to `.env` and configure your settings:

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
   - ALTCHA Manager: `http://localhost:3000/manager` (or `http://localhost:3000/login`)

---

## Default Administrator Account

On first start or when no database exists, the system automatically populates the schema and provisions the initial administrator account:

- **Username**: `admin` (configurable via `ADMIN_USERNAME`)
- **Password**: `admin12345` (configurable via `ADMIN_PASSWORD`)
- **Role**: `administrator`

*Note: Change the default administrator password immediately after initial login.*

---

## Client & Server Integration Code Snippets

### 1. Frontend HTML Form

Load the ALTCHA widget script and embed the `<altcha-widget>` tag inside your form with your API key:

```html
<!-- Load ALTCHA Widget script -->
<script async defer src="http://localhost:3000/altcha.min.js"></script>

<!-- Embed widget inside your HTML form -->
<form action="/api/submit-form" method="POST">
  <input type="text" name="name" placeholder="Your Name" required />
  
  <!-- ALTCHA Proof-of-Work Widget -->
  <altcha-widget challengeurl="http://localhost:3000/challenge?apiKey=YOUR_API_KEY"></altcha-widget>
  
  <button type="submit">Submit Form</button>
</form>
```

### 2. Backend Verification (Node.js / Express)

When the form is submitted, the widget attaches an `altcha` field containing the base64-encoded solution payload. Verify it on your backend using the `/verify` endpoint:

```javascript
import express from 'express';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ALTCHA_SERVICE_URL = 'http://localhost:3000';
const ALTCHA_API_KEY = 'YOUR_API_KEY';

app.post('/api/submit-form', async (req, res) => {
  const altchaPayload = req.body.altcha || req.body.payload;

  if (!altchaPayload) {
    return res.status(400).json({ error: 'CAPTCHA verification is required.' });
  }

  const response = await fetch(`${ALTCHA_SERVICE_URL}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ALTCHA_API_KEY}`
    },
    body: JSON.stringify({ payload: altchaPayload })
  });

  const result = await response.json();
  if (!result.success && !result.verification?.verified) {
    return res.status(400).json({ error: 'CAPTCHA verification failed.' });
  }

  // Continue processing form...
  res.json({ success: true, message: 'Form submitted successfully!' });
});
```

### 3. Backend Verification (PHP)

```php
<?php
$payload   = $_POST['altcha'] ?? $_POST['payload'] ?? '';
$apiKey    = 'YOUR_API_KEY';
$verifyUrl = 'http://localhost:3000/verify';

if (empty($payload)) {
    http_response_code(400);
    die(json_encode(['error' => 'CAPTCHA verification is required.']));
}

$ch = curl_init($verifyUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['payload' => $payload]));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);
if ($httpCode !== 200 || (empty($result['success']) && empty($result['verification']['verified']))) {
    http_response_code(400);
    die(json_encode(['error' => 'CAPTCHA verification failed.']));
}

// Continue processing form...
echo json_encode(['success' => true, 'message' => 'Successfully verified!']);
?>
```

### 4. cURL CLI Testing

```bash
# 1. Request PoW Challenge
curl -X GET "http://localhost:3000/challenge?apiKey=YOUR_API_KEY"

# 2. Verify solved payload
curl -X POST "http://localhost:3000/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"payload": "BASE64_SOLVED_PAYLOAD"}'
```

---

## Docker Deployment

The application is containerized and runs as a non-root `node` user for production security.

```bash
# Build and start services in the background
docker compose up -d --build

# View container logs
docker compose logs -f altcha-server

# Check service status
docker compose ps
```

### Persistent Volumes

- `./database`: Contains SQLite database files (`altcha.db` and `log.altcha.db`).
- `./web`: Frontend templates and static assets.
