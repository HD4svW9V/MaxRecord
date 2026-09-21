import { parseTaskTitle, chooseOpenServe } from './parser.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const stateKey = id => `task:${id}`;
const safeId = id => `voice-${String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
const japanLocalTimestamp = value => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};
const fsValue = value => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, val]) => [key, fsValue(val)])) } };
};
const fromFs = value => {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, val]) => [key, fromFs(val)]));
  return null;
};
const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fsValue(value)]));

async function googleToken(env) {
  const saved = await env.MAXRECORD_STATE.get('google:oauth', 'json');
  if (!saved?.refresh_token) throw new Error('Google連携が未完了です。/oauth/startを開いてください。');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: saved.refresh_token, grant_type: 'refresh_token' }) });
  if (!response.ok) throw new Error(`Google token error: ${response.status}`);
  return (await response.json()).access_token;
}

async function firebaseToken(env) {
  const cached = await env.MAXRECORD_STATE.get('firebase:oauth', 'json');
  if (cached?.idToken && cached.expiresAt > Date.now() + 120000) return cached.idToken;
  let endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`;
  let body = '{}';
  if (cached?.refreshToken) {
    endpoint = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`;
    body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cached.refreshToken }).toString();
  }
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': cached?.refreshToken ? 'application/x-www-form-urlencoded' : 'application/json' }, body });
  if (!response.ok) throw new Error(`Firebase auth error: ${response.status}`);
  const data = await response.json();
  const auth = { idToken: data.idToken || data.id_token, refreshToken: data.refreshToken || data.refresh_token, expiresAt: Date.now() + (Number(data.expiresIn || data.expires_in || 3600) * 1000) };
  await env.MAXRECORD_STATE.put('firebase:oauth', JSON.stringify(auth));
  return auth.idToken;
}

const firestoreBase = env => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID || 'maxrecord')}/databases/(default)/documents`;
const collectionPath = env => `artifacts/${env.FIRESTORE_APP_ID || 'default-cat-app'}/public/data/cat_logs`;

async function listLogs(env, token) {
  const response = await fetch(`${firestoreBase(env)}/${collectionPath(env)}?pageSize=1000&orderBy=timestamp%20desc`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Firestore read error: ${response.status}`);
  const data = await response.json();
  return (data.documents || []).map(document => ({ id: document.name.split('/').pop(), ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, fromFs(value)])) }));
}

async function writeRecord(env, token, task, event, logs) {
  const now = new Date().toISOString();
  const timestamp = japanLocalTimestamp(task.updated || now);
  const docId = safeId(task.id);
  const record = { category: event.category, title: event.category === 'food' ? 'ごはん' : event.category === 'water' ? '水' : event.category === 'toilet' ? 'トイレ' : '補液等', timestamp, createdAt: now, updatedAt: now };
  let target = null;
  if (event.category === 'food') {
    record.details = { ...event.details, type: event.foodType, dryAction: event.action };
    if (event.action === 'serve') Object.assign(record.details, { serveGrams: event.amount, isClosed: false });
    else {
      const chosen = chooseOpenServe(event, logs); if (!chosen.ok) throw Object.assign(new Error(chosen.message), { code: chosen.code });
      target = chosen.log;
      Object.assign(record.details, { targetServeLogId: target.id, serveGrams: target.details.serveGrams, discardGrams: event.amount, eatenGrams: Math.round((target.details.serveGrams - event.amount) * 10) / 10, dish: target.details.dish || event.details.dish, productName: target.details.productName || event.details.productName, effectiveDate: timestamp.slice(0, 10) });
      if (event.amount > target.details.serveGrams) throw Object.assign(new Error('回収時の重さが配膳時を超えています。'), { code: 'DISCARD_OVER_SERVE' });
    }
  } else if (event.category === 'water') {
    record.details = { ...event.details, waterAction: event.action };
    if (event.action === 'serve') Object.assign(record.details, { serveMl: event.amount, isClosed: false });
    else {
      const chosen = chooseOpenServe(event, logs); if (!chosen.ok) throw Object.assign(new Error(chosen.message), { code: chosen.code });
      target = chosen.log;
      Object.assign(record.details, { targetServeLogId: target.id, serveMl: target.details.serveMl, discardMl: event.amount, drunkMl: Math.round((target.details.serveMl - event.amount) * 10) / 10, dish: target.details.dish || event.details.dish, effectiveDate: timestamp.slice(0, 10) });
      if (event.amount > target.details.serveMl) throw Object.assign(new Error('回収時の重さが配膳時を超えています。'), { code: 'DISCARD_OVER_SERVE' });
    }
  } else record.details = event.details;

  const writes = [{ update: { name: `${firestoreBase(env)}/${collectionPath(env)}/${docId}`, fields: fields(record) } }];
  if (target) {
    const updatedTarget = { ...target, details: { ...target.details, isClosed: true, closedBy: docId }, updatedAt: now };
    delete updatedTarget.id;
    writes.push({ update: { name: `${firestoreBase(env)}/${collectionPath(env)}/${target.id}`, fields: fields(updatedTarget) } });
  }
  const response = await fetch(`${firestoreBase(env)}:commit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
  if (!response.ok) throw new Error(`Firestore write error: ${response.status} ${await response.text()}`);
}

async function patchTask(token, taskId, patch) {
  const response = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  if (!response.ok) throw new Error(`Google Tasks update error: ${response.status}`);
}

export async function runBridge(env) {
  const token = await googleToken(env);
  const response = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&showHidden=false&maxResults=100', { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Tasks read error: ${response.status}`);
  const tasks = (await response.json()).items || [];
  const candidates = tasks.filter(task => /^マックス\s*記録/.test(String(task.title || '').normalize('NFKC')));
  const firebase = candidates.length ? await firebaseToken(env) : null;
  let logs = candidates.length ? await listLogs(env, firebase) : [];
  const result = { found: candidates.length, saved: 0, errors: [] };
  for (const task of candidates) {
    const fingerprint = `${task.updated}|${task.title}`;
    const previous = await env.MAXRECORD_STATE.get(stateKey(task.id), 'json');
    if (previous?.status === 'saved' || (previous?.status === 'input_error' && previous?.fingerprint === fingerprint)) continue;
    const parsed = parseTaskTitle(task.title);
    if (!parsed.ok) {
      const error = { status: 'input_error', fingerprint, code: parsed.code, message: parsed.message, at: new Date().toISOString() };
      await env.MAXRECORD_STATE.put(stateKey(task.id), JSON.stringify(error)); result.errors.push({ id: task.id, ...error }); continue;
    }
    try {
      if (!logs.some(log => log.id === safeId(task.id))) await writeRecord(env, firebase, task, parsed.event, logs);
      await patchTask(token, task.id, { status: 'completed', completed: new Date().toISOString() });
      await env.MAXRECORD_STATE.put(stateKey(task.id), JSON.stringify({ status: 'saved', fingerprint, at: new Date().toISOString() }));
      result.saved += 1;
      logs = await listLogs(env, firebase);
    } catch (error) {
      const info = { status: 'retry_error', fingerprint, code: error.code || 'WRITE_ERROR', message: error.message, at: new Date().toISOString() };
      await env.MAXRECORD_STATE.put(stateKey(task.id), JSON.stringify(info)); result.errors.push({ id: task.id, ...info });
    }
  }
  await env.MAXRECORD_STATE.put('bridge:last-run', JSON.stringify({ ...result, at: new Date().toISOString() }));
  return result;
}

export default {
  async scheduled(_controller, env, ctx) { ctx.waitUntil(runBridge(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/oauth/start') {
      const state = crypto.randomUUID(); await env.MAXRECORD_STATE.put(`oauth:state:${state}`, '1', { expirationTtl: 600 });
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/oauth/callback`, response_type: 'code', scope: 'https://www.googleapis.com/auth/tasks', access_type: 'offline', prompt: 'consent', state }).toString();
      return Response.redirect(auth.toString(), 302);
    }
    if (url.pathname === '/oauth/callback') {
      const state = url.searchParams.get('state'); if (!state || !await env.MAXRECORD_STATE.get(`oauth:state:${state}`)) return json({ error: 'invalid_state' }, 400);
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/oauth/callback`, grant_type: 'authorization_code' }) });
      const data = await response.json(); if (!response.ok || !data.refresh_token) return json({ error: 'oauth_failed', detail: data }, 400);
      await env.MAXRECORD_STATE.put('google:oauth', JSON.stringify({ refresh_token: data.refresh_token }));
      return new Response('Google Tasksとの連携が完了しました。この画面を閉じてください。', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname === '/status') return json(await env.MAXRECORD_STATE.get('bridge:last-run', 'json') || { status: 'not_run' });
    if (url.pathname === '/run' && request.method === 'POST') {
      if (request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      return json(await runBridge(env));
    }
    return json({ ok: true, service: 'MaxRecord Google Tasks bridge' });
  }
};
