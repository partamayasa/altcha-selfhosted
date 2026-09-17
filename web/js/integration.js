/**
 * ALTCHA Sentinel - API & Integration Module
 */

const SentinelIntegration = {
  currentChallenge: null,
  userApiKey: null,
  currentUsername: null,

  async init() {
    await this.loadUserProfile();
    this.updateSnippets();
  },

  async loadUserProfile() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        this.userApiKey = data.apiKey || null;
        this.currentUsername = data.username || null;
      }
    } catch (err) {
      console.warn('Could not load user profile for integration:', err.message);
    }
  },

  async testManualChallenge() {
    const outputEl = document.getElementById('manual-challenge-output');
    if (!outputEl) return;

    outputEl.textContent = 'Requesting challenge from server...';

    try {
      const reqHeaders = {};
      if (this.userApiKey) {
        reqHeaders['Authorization'] = `Bearer ${this.userApiKey}`;
      }
      const data = await SentinelAPI.getChallenge({ headers: reqHeaders });
      this.currentChallenge = data;
      outputEl.textContent = JSON.stringify(data, null, 2);
      SentinelApp.showToast('Challenge successfully retrieved!', 'success');
    } catch (err) {
      outputEl.textContent = 'Error: ' + err.message;
      SentinelApp.showToast('Failed to request challenge: ' + err.message, 'error');
    }
  },

  async testManualVerify() {
    const payloadInput = document.getElementById('manual-verify-input');
    const outputEl = document.getElementById('manual-verify-output');
    if (!payloadInput || !outputEl) return;

    const payload = payloadInput.value.trim();
    if (!payload) {
      SentinelApp.showToast('Please enter an ALTCHA payload to verify!', 'info');
      return;
    }

    outputEl.textContent = 'Verifying payload with /verify...';

    try {
      const reqHeaders = {};
      if (this.userApiKey) {
        reqHeaders['Authorization'] = `Bearer ${this.userApiKey}`;
      }
      const data = await SentinelAPI.verify(payload, { headers: reqHeaders });
      outputEl.textContent = JSON.stringify(data, null, 2);
      if (data.success || data.verification?.verified) {
        SentinelApp.showToast('Payload VALID! Successfully verified.', 'success');
      } else {
        SentinelApp.showToast('Payload INVALID or expired!', 'error');
      }
    } catch (err) {
      outputEl.textContent = 'Error: ' + err.message;
      SentinelApp.showToast('Verification failed: ' + err.message, 'error');
    }
  },

  updateSnippets() {
    const origin = window.AppSettings ? window.AppSettings.getBaseUrl() : window.location.origin;
    const apiKeyDisplay = this.userApiKey || 'YOUR_API_KEY';

    const htmlSnippet = `<!-- 1. Load ALTCHA Widget script -->
<script async defer src="${origin}/altcha.min.js"></script>

<!-- 2. Embed widget inside your HTML form with your API key -->
<form action="/api/submit-form" method="POST">
  <input type="text" name="name" placeholder="Your Name" required />
  
  <!-- ALTCHA Proof-of-Work Widget -->
  <altcha-widget challengeurl="${origin}/challenge?apiKey=${apiKeyDisplay}"></altcha-widget>
  
  <button type="submit">Submit Form</button>
</form>`;

    const nodeSnippet = `// ALTCHA Verification in Node.js (Express)
import express from 'express';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const ALTCHA_SERVICE_URL = '${origin}';
const ALTCHA_API_KEY = '${apiKeyDisplay}';

app.post('/api/submit-form', async (req, res) => {
  // Widget automatically attaches base64 payload into 'altcha' field
  const altchaPayload = req.body.altcha || req.body.payload;

  if (!altchaPayload) {
    return res.status(400).json({ error: 'CAPTCHA verification is required.' });
  }

  const verifyResponse = await fetch(\`\${ALTCHA_SERVICE_URL}/verify\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ALTCHA_API_KEY
    },
    body: JSON.stringify({ payload: altchaPayload })
  });

  const result = await verifyResponse.json();
  if (!result.success && !result.verification?.verified) {
    return res.status(400).json({ error: 'CAPTCHA verification failed.' });
  }

  // Continue processing form...
  res.json({ success: true, message: 'Form submitted successfully!' });
});`;

    const phpSnippet = `<?php
// ALTCHA Verification in PHP
$payload   = $_POST['altcha'] ?? $_POST['payload'] ?? '';
$apiKey    = '${apiKeyDisplay}';
$verifyUrl = '${origin}/verify';

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
?>`;

    const curlSnippet = `# 1. Request PoW Challenge (via Query Parameter or Authorization Header)
curl -X GET "${origin}/challenge?apiKey=${apiKeyDisplay}"

# 2. Verify solved payload with Authorization Header
curl -X POST "${origin}/verify" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKeyDisplay}" \\
  -d '{"payload": "BASE64_PAYLOAD_HERE"}'`;

    const setCode = (id, code) => {
      const el = document.getElementById(id);
      if (el) el.textContent = code;
    };

    setCode('code-snippet-html', htmlSnippet);
    setCode('code-snippet-node', nodeSnippet);
    setCode('code-snippet-php', phpSnippet);
    setCode('code-snippet-curl', curlSnippet);
  },

  copyCode(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    navigator.clipboard.writeText(el.textContent).then(() => {
      SentinelApp.showToast('Code snippet copied to clipboard!', 'success');
    }).catch(() => {
      SentinelApp.showToast('Failed to copy code snippet.', 'error');
    });
  }
};

window.SentinelIntegration = SentinelIntegration;
window.SentinelPlayground = SentinelIntegration; // Backwards compatibility alias

document.addEventListener('app-settings:loaded', () => {
  if (window.SentinelIntegration && typeof SentinelIntegration.updateSnippets === 'function') {
    SentinelIntegration.updateSnippets();
  }
});
