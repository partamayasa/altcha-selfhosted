/**
 * ALTCHA Sentinel - Playground & Integration Module
 */

const SentinelPlayground = {
  currentChallenge: null,

  init() {
    this.updateSnippets();
    this.setupWidgetListener();
  },

  setupWidgetListener() {
    const widget = document.getElementById('sentinel-demo-widget');
    if (!widget) return;

    // Dynamically set challenge URL to the current server
    const currentOrigin = window.location.origin;
    widget.setAttribute('challengeurl', `${currentOrigin}/challenge`);

    widget.addEventListener('statechange', (ev) => {
      const state = ev.detail?.state;
      const statusText = document.getElementById('widget-state-indicator');
      if (statusText) {
        statusText.textContent = `Widget State: ${state}`;
      }

      if (state === 'verified') {
        const payload = ev.detail?.payload;
        const payloadBox = document.getElementById('widget-payload-output');
        if (payloadBox) {
          payloadBox.textContent = payload || 'Verified!';
        }
      }
    });
  },

  async testManualChallenge() {
    const outputEl = document.getElementById('manual-challenge-output');
    if (!outputEl) return;

    outputEl.textContent = 'Requesting challenge from server...';

    try {
      const data = await SentinelAPI.getChallenge();
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
      const data = await SentinelAPI.verify(payload);
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
    const origin = window.location.origin;

    const htmlSnippet = `<!-- 1. Load ALTCHA Widget script -->
<script async defer src="${origin}/altcha.min.js" type="module"></script>

<!-- 2. Embed widget inside your HTML form -->
<form action="/api/submit-form" method="POST">
  <input type="text" name="name" placeholder="Your Name" required />
  
  <altcha-widget challengeurl="${origin}/challenge"></altcha-widget>
  
  <button type="submit">Submit Form</button>
</form>`;

    const nodeSnippet = `// ALTCHA Verification in Node.js (Express)
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/submit-form', async (req, res) => {
  const altchaPayload = req.body.altcha; // Automatically populated by widget

  const verifyResponse = await fetch('${origin}/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: altchaPayload })
  });

  const result = await verifyResponse.json();
  if (!result.success && !result.verification?.verified) {
    return res.status(400).json({ error: 'Captcha verification failed.' });
  }

  // Continue processing form...
  res.json({ status: 'Form submitted successfully!' });
});`;

    const phpSnippet = `<?php
// ALTCHA Verification in PHP
$payload = $_POST['altcha'] ?? '';

$ch = curl_init('${origin}/verify');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['payload' => $payload]));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
if (empty($result['success']) && empty($result['verification']['verified'])) {
    http_response_code(400);
    die('Spam verification failed.');
}

// Continue processing form...
echo "Successfully verified!";
?>`;

    const curlSnippet = `# 1. Request PoW Challenge
curl -X GET "${origin}/challenge"

# 2. Verify solved payload
curl -X POST "${origin}/verify" \\
  -H "Content-Type: application/json" \\
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

window.SentinelPlayground = SentinelPlayground;
