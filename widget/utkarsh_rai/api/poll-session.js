'use strict';

const { sendJson, hospilotRequest } = require('./_hospilot');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const sessionId = req.query && req.query.sessionId;
  const token = req.query && req.query.token;
  if (!sessionId || !token) {
    return sendJson(res, 400, { error: 'sessionId and token are required' });
  }

  try {
    const data = await hospilotRequest('GET', `/api/sessions/${sessionId}`, token, null);
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, 502, { error: `Polling failed: ${err.message}` });
  }
};
