importScripts('tracker-rules.js', 'classifier.js');

const C = self.GhostTraceClassifier;
const FILTER = {urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']};
const DEFAULT = {port: 8765, key: '', enabled: true, excluded: []};
const QUEUE_MAX = 2500;
let settings = {...DEFAULT};
let pending = {}, sites = {}, hops = {}, queue = [], dropped = 0, remotePaused = false;
let connected = false, busy = false, lastError = '', lastFlush = 0, session = '';
let serial = Promise.resolve();

const ready = (async () => {
  const saved = await chrome.storage.local.get(['settings', 'queue', 'dropped']);
  settings = {...DEFAULT, ...saved.settings};
  queue = saved.queue || [];
  dropped = saved.dropped || 0;
  const state = await chrome.storage.session.get(['pending', 'sites', 'hops', 'session']);
  pending = state.pending || {};
  sites = state.sites || {};
  hops = state.hops || {};
  session = state.session || crypto.randomUUID();
  await chrome.storage.session.set({session});
})();

function schedule(fn) {
  serial = serial.then(async () => { await ready; await fn(); }).catch(error => { lastError = String(error.message || error); });
  return serial;
}
function bridge() { return 'http://127.0.0.1:' + settings.port; }
function allowed(d) {
  if (!settings.enabled || remotePaused || !settings.key || d.tabId < 0 || d.incognito) return false;
  const domain = C.normalize(d.url);
  if (!domain || ['127.0.0.1', 'localhost', '[::1]'].includes(domain)) return false;
  const site = sites[d.tabId] || C.normalize(d.initiator || '') || domain;
  return !settings.excluded.some(x => site === x || site.endsWith('.' + x));
}
async function saveSession() { await chrome.storage.session.set({pending, sites, hops}); }
async function persistQueue() { await chrome.storage.local.set({queue, dropped}); }

function makeRecord(d) {
  const domain = C.normalize(d.url);
  if (d.type === 'main_frame') sites[d.tabId] = domain;
  const site = sites[d.tabId] || C.normalize(d.initiator || '') || domain;
  const hop = hops[d.requestId] || 0;
  const evidence = C.inspect(d.url, site, d.type, self.GHOSTTRACE_RULES);
  return {id: session + '.' + d.requestId + '.' + hop, ts: d.timeStamp, site, domain,
          type: d.type, method: d.method, tab: d.tabId, state: 'attempt', ip: '', status: 0,
          evidence: {...evidence, cookie_sent: false, cookie_set: false}};
}

async function begin(d) {
  if (d.type === 'main_frame') sites[d.tabId] = C.normalize(d.url);
  if (!allowed(d)) return;
  pending[d.requestId] = makeRecord(d);
  await saveSession();
}
async function finish(d, state) {
  const record = pending[d.requestId] || (allowed(d) ? makeRecord(d) : null);
  if (record && allowed(d)) {
    record.ip = d.fromCache ? '' : d.ip || record.ip || '';
    record.status = d.statusCode || 0;
    record.state = d.fromCache ? 'cached' : state;
    queue.push(record);
    if (queue.length > QUEUE_MAX) { dropped += queue.length - QUEUE_MAX; queue = queue.slice(-QUEUE_MAX); }
    await persistQueue();
  }
  delete pending[d.requestId];
  if (state === 'redirect') hops[d.requestId] = (hops[d.requestId] || 0) + 1;
  else delete hops[d.requestId];
  await saveSession();
  if (queue.length >= 25 || Date.now() - lastFlush > 1800) void flush();
}

async function request(path, body) {
  const response = await fetch(bridge() + path, {method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.key},
                                               body: JSON.stringify(body), signal: AbortSignal.timeout(4000)});
  if (!response.ok) throw new Error(response.status === 401 ? 'Pairing key rejected. Pair again from the dashboard.' : 'Collector returned ' + response.status);
  return response.json();
}
async function flush() {
  await ready;
  if (busy || !settings.key) return;
  busy = true;
  try {
    const heartbeat = await request('/api/heartbeat', {});
    remotePaused = heartbeat.paused;
    connected = true; lastError = ''; lastFlush = Date.now();
    if (remotePaused) {
      await schedule(async () => { queue = []; pending = {}; await persistQueue(); await saveSession(); });
    } else {
      // Snapshot only after previously scheduled capture writes are committed.
      await serial;
      const batch = queue.slice(0, 250);
      if (batch.length) {
        await request('/api/events', {events: batch});
        const ids = new Set(batch.map(e => e.id));
        await schedule(async () => { queue = queue.filter(e => !ids.has(e.id)); await persistQueue(); });
      }
    }
  } catch (error) { connected = false; lastError = error.message || 'Collector offline'; }
  finally {
    busy = false;
    chrome.action.setBadgeText({text: !settings.enabled || remotePaused ? 'OFF' : connected ? '' : '!'});
    chrome.action.setBadgeBackgroundColor({color: connected ? '#32d6be' : '#c08cff'});
  }
}

// Register at module load so Chrome can wake the worker for network activity.
chrome.webRequest.onBeforeRequest.addListener(d => { void schedule(() => begin(d)); }, FILTER);
chrome.webRequest.onSendHeaders.addListener(d => { void schedule(async () => {
  if (pending[d.requestId]) {
    pending[d.requestId].evidence.cookie_sent = (d.requestHeaders || []).some(h => h.name.toLowerCase() === 'cookie');
    await saveSession();
  }
}); }, FILTER, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(d => { void schedule(async () => {
  if (pending[d.requestId]) {
    pending[d.requestId].evidence.cookie_set = (d.responseHeaders || []).some(h => h.name.toLowerCase() === 'set-cookie');
    await saveSession();
  }
}); }, FILTER, ['responseHeaders', 'extraHeaders']);
chrome.webRequest.onCompleted.addListener(d => { void schedule(() => finish(d, 'response')); }, FILTER);
chrome.webRequest.onBeforeRedirect.addListener(d => { void schedule(() => finish(d, 'redirect')); }, FILTER);
chrome.webRequest.onErrorOccurred.addListener(d => { void schedule(() => finish(d, d.error === 'net::ERR_BLOCKED_BY_CLIENT' ? 'client-blocked' : 'failed')); }, FILTER);
chrome.webNavigation.onCommitted.addListener(d => { if (d.frameId === 0) void schedule(async () => { sites[d.tabId] = C.normalize(d.url); await saveSession(); }); });
chrome.tabs.onRemoved.addListener(tab => { void schedule(async () => { delete sites[tab]; await saveSession(); }); });
chrome.alarms.create('ghosttrace-flush', {periodInMinutes: 0.5});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'ghosttrace-flush') void flush(); });
chrome.runtime.onStartup.addListener(() => { void flush(); });

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    await ready;
    if (message.action === 'save') {
      const port = Number(message.settings.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024–65535.');
      const key = String(message.settings.key || '').trim();
      if (key && !/^[A-Za-z0-9_-]{30,100}$/.test(key)) throw new Error('Paste the pairing key from the local dashboard.');
      const excluded = String(message.settings.excluded || '').split(/[\s,]+/).filter(Boolean).map(x => C.normalize('https://' + x)).filter(Boolean);
      await schedule(async () => {
        const changedKey = key !== settings.key;
        settings = {port, key, enabled: Boolean(message.settings.enabled), excluded};
        await chrome.storage.local.set({settings});
        if (!settings.enabled || changedKey) { pending = {}; queue = []; await persistQueue(); await saveSession(); }
      });
      await flush();
    }
    if (message.action === 'discard') await schedule(async () => {queue = []; pending = {}; dropped = 0; await persistQueue(); await saveSession();});
    if (message.action === 'flush') await flush();
    respond({settings, connected, paused: remotePaused, queue: queue.length, dropped, error: lastError});
  })().catch(error => respond({error: error.message}));
  return true;
});

// Capture top-level domains of already-open tabs, without collecting page titles or paths.
ready.then(async () => {
  const tabs = await chrome.tabs.query({});
  await schedule(async () => {
    for (const tab of tabs) if (tab.url && !tab.incognito) sites[tab.id] = C.normalize(tab.url);
    await saveSession();
  });
  void flush();
});
