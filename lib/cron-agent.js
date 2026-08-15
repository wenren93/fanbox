'use strict';

const ACTIONS = new Set(['list', 'preview', 'save']);

function extractCronOps(reply) {
  const ops = [];
  const clean = String(reply || '').replace(/<cron(?:\s+action=["']?([\w-]+)["']?)?\s*>([\s\S]*?)<\/cron>/gi, (_, action, body) => {
    let data = {};
    try { data = body.trim() ? JSON.parse(body) : {}; } catch { data = { _invalid: true }; }
    ops.push({ action: String(action || data.action || '').toLowerCase(), data });
    return '';
  }).trim();
  return { clean, ops };
}

function validCronAction(action) {
  return ACTIONS.has(String(action || '').toLowerCase());
}

module.exports = { extractCronOps, validCronAction };
