'use strict';

const { CANDIDATE_TAG, sendJson, readJsonBody, hospilotRequest } = require('./_hospilot');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const username = process.env.HOSPILOT_USERNAME;
  const password = process.env.HOSPILOT_PASSWORD;
  if (!username || !password) {
    return sendJson(res, 500, { error: 'Missing HOSPILOT_USERNAME/HOSPILOT_PASSWORD env vars' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const rawGoal = (body.goal || '').trim();
  if (!rawGoal) {
    return sendJson(res, 400, { error: 'Goal is required' });
  }

  let token;
  try {
    const loginResp = await hospilotRequest('POST', '/api/auth/login', null, { username, password });
    token = loginResp.token;
    if (!token) throw new Error('No token in login response');
  } catch (err) {
    return sendJson(res, 502, { error: `Login failed: ${err.message}` });
  }

  const goal = `${CANDIDATE_TAG} ${rawGoal}`;
  try {
    const sessionResp = await hospilotRequest('POST', '/api/sessions', token, {
      goal,
      constraints: '',
      autonomous: false,
    });
    if (!sessionResp.session_id) throw new Error('No session_id in response');
    return sendJson(res, 200, { sessionId: sessionResp.session_id, token });
  } catch (err) {
    return sendJson(res, 502, { error: `Session creation failed: ${err.message}` });
  }
};
