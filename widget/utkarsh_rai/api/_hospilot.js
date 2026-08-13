'use strict';

const https = require('https');

const HOSPILOT_BASE = 'hospilot.carer.ai';
const CANDIDATE_TAG = '[CANDIDATE-utkarsh_rai]';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function hospilotRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(
      {
        hostname: HOSPILOT_BASE,
        port: 443,
        path: apiPath,
        method,
        headers,
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            reject(new Error(`Failed to parse Hospilot response (status ${res.statusCode})`));
            return;
          }

          if (res.statusCode >= 400) {
            reject(new Error(`Hospilot API ${res.statusCode}: ${JSON.stringify(parsed)}`));
            return;
          }

          resolve(parsed);
        });
      }
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = {
  CANDIDATE_TAG,
  sendJson,
  readJsonBody,
  hospilotRequest,
};

