/**
 * Hospilot Widget Backend — utkarsh_rai assessment submission
 *
 * Tiny Node.js HTTP server (zero external dependencies).
 * All Hospilot API calls are made from here so the browser never
 * hits hospilot.carer.ai directly (required by CORS policy).
 *
 * Endpoints exposed to the frontend:
 *   POST /api/create-session  { goal: string }
 *     → logs in, creates a session, returns { sessionId, token }
 *   GET  /api/poll-session?sessionId=<uuid>&token=<jwt>
 *     → proxies GET /api/sessions/{id}, returns the raw session object
 *   GET  /                    → serves index.html
 *   GET  /index.html          → serves index.html
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ── Config ────────────────────────────────────────────────────────────────────

// Load .env manually (no dotenv dependency needed for this small file).
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
}

const HOSPILOT_BASE = 'hospilot.carer.ai';
const HOSPILOT_USERNAME = process.env.HOSPILOT_USERNAME;
const HOSPILOT_PASSWORD = process.env.HOSPILOT_PASSWORD;
const PORT = parseInt(process.env.PORT || '3001', 10);
const CANDIDATE_TAG = '[CANDIDATE-utkarsh_rai]';

if (!HOSPILOT_USERNAME || !HOSPILOT_PASSWORD) {
  console.error('ERROR: HOSPILOT_USERNAME and HOSPILOT_PASSWORD must be set in .env');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make an HTTPS request to hospilot.carer.ai and resolve with parsed JSON. */
function hospilotRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const options = {
      hostname: HOSPILOT_BASE,
      port: 443,
      path: apiPath,
      method,
      headers,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Hospilot API ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Hospilot response (status ${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Read request body as a string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Send a JSON response. */
function sendJSON(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // Allow same-origin requests from the HTML page we serve.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

/** Serve a static file from __dirname. */
function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /api/create-session
 * Body: { "goal": "<plain-english goal>" }
 *
 * 1. Logs in to Hospilot → gets token
 * 2. Creates a session with the candidate-prefixed goal
 * 3. Returns { sessionId, token } to the frontend
 */
async function handleCreateSession(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJSON(res, 400, { error: 'Invalid JSON body' });
  }

  const rawGoal = (body.goal || '').trim();
  if (!rawGoal) {
    return sendJSON(res, 400, { error: 'Goal is required' });
  }

  // Step 1 — Login
  let token;
  try {
    const loginResp = await hospilotRequest('POST', '/api/auth/login', null, {
      username: HOSPILOT_USERNAME,
      password: HOSPILOT_PASSWORD,
    });
    token = loginResp.token;
    if (!token) throw new Error('No token in login response');
  } catch (err) {
    console.error('Login failed:', err.message);
    return sendJSON(res, 502, { error: `Login failed: ${err.message}` });
  }

  // Step 2 — Create session
  const prefixedGoal = `${CANDIDATE_TAG} ${rawGoal}`;
  let sessionId;
  try {
    const sessionResp = await hospilotRequest('POST', '/api/sessions', token, {
      goal: prefixedGoal,
      constraints: '',
      autonomous: false,
    });
    sessionId = sessionResp.session_id;
    if (!sessionId) throw new Error('No session_id in response');
  } catch (err) {
    console.error('Session creation failed:', err.message);
    return sendJSON(res, 502, { error: `Session creation failed: ${err.message}` });
  }

  console.log(`Session created: ${sessionId} | goal: ${prefixedGoal}`);
  return sendJSON(res, 200, { sessionId, token });
}

/**
 * GET /api/poll-session?sessionId=<uuid>&token=<jwt>
 *
 * Proxies GET /api/sessions/{sessionId} and returns the raw response.
 * The frontend keeps calling this until `pipeline` is non-empty.
 */
async function handlePollSession(req, res, query) {
  const sessionId = query.sessionId;
  const token = query.token;

  if (!sessionId || !token) {
    return sendJSON(res, 400, { error: 'sessionId and token are required' });
  }

  try {
    const data = await hospilotRequest('GET', `/api/sessions/${sessionId}`, token, null);
    return sendJSON(res, 200, data);
  } catch (err) {
    console.error('Poll failed:', err.message);
    return sendJSON(res, 502, { error: `Polling failed: ${err.message}` });
  }
}

// ── Main HTTP server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // API routes
  if (req.method === 'POST' && pathname === '/api/create-session') {
    return handleCreateSession(req, res);
  }
  if (req.method === 'GET' && pathname === '/api/poll-session') {
    return handlePollSession(req, res, query);
  }

  // Static files
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(res, path.join(__dirname, 'index.html'));
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Hospilot widget backend running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser.`);
});

