import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { createServer } from '../server.js';
import { createApi, ApiError } from '../public/api.js';

// Browser modules use Web Crypto; some Node 20 builds do not expose it globally.
globalThis.crypto ??= webcrypto;

async function listen(server, t) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('proxy preserves Gateway host, cookie lifecycle, idempotency, and denies spoofed identity', async t => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/login') res.setHeader('Set-Cookie', 'session_id=test-session; Domain=arch.homework; Path=/; HttpOnly; SameSite=Lax');
    if (req.url === '/auth/logout') { res.setHeader('Set-Cookie', 'session_id=; Path=/; HttpOnly; Max-Age=0'); res.writeHead(204); res.end(); return; }
    res.writeHead(req.url === '/orders' ? 202 : 200); res.end('{"ok":true}');
  });
  const target = await listen(upstream, t);
  const base = await listen(createServer({ apiBaseUrl: target }), t);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"demo","password":"test"}' });
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.doesNotMatch(login.headers.get('set-cookie'), /Domain=/i);
  assert.equal(received[0].headers.host, new URL(target).host);
  const body = { productId: 1, quantity: 1, deliverySlotId: 10 };
  const order = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'session_id=test-session', 'Idempotency-Key': 'same-order', 'X-User-Id': '999', 'X-Forwarded-User': '999' }, body: JSON.stringify(body) });
  assert.equal(order.status, 202);
  assert.equal(received[1].headers.cookie, 'session_id=test-session');
  assert.equal(received[1].headers['idempotency-key'], 'same-order');
  assert.equal(received[1].headers['x-user-id'], undefined);
  assert.equal(received[1].headers['x-forwarded-user'], undefined);
  assert.deepEqual(JSON.parse(received[1].body), body);
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: 'session_id=test-session' } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  const forbidden = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: 'http://unrelated.example' } });
  assert.equal(forbidden.status, 403);
  assert.equal((await fetch(`${base}/api/internal/accounts`, { method: 'POST' })).status, 404);
  assert.equal(received.length, 3);
});

test('all requests from the defense collection are reachable through the proxy', async t => {
  const collection = JSON.parse(await readFile(new URL('../../postman/project-defense.postman_collection.json', import.meta.url)));
  const seen = [];
  const gateway = await listen(http.createServer((req, res) => { seen.push(req.url); res.setHeader('Content-Type', 'application/json'); res.end('{}'); }), t);
  const base = await listen(createServer({ apiBaseUrl: gateway }), t);
  for (const item of collection.item) {
    const path = item.request.url.replace('{{baseUrl}}', '').replaceAll(/\{\{[^}]+\}\}/g, '1');
    const response = await fetch(`${base}/api${path}`, { method: item.request.method });
    assert.equal(response.status, 200, item.name);
  }
  assert.equal(seen.length, collection.item.length);
  for (const path of ['/profile/1', '/notifications?orderId=1', '/health/live']) assert.equal((await fetch(`${base}/api${path}`)).status, 200);
  assert.equal((await fetch(`${base}/api/profile/1`, { method: 'PUT', body: '{}' })).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/config`)).headers.get('cache-control'), 'no-store');
});

test('proxy reports Gateway failure and timeout as readable JSON', async t => {
  const unreachable = http.createServer(); unreachable.listen(0, '127.0.0.1'); await once(unreachable, 'listening');
  const closedPort = unreachable.address().port; await new Promise(resolve => unreachable.close(resolve));
  const base = await listen(createServer({ apiBaseUrl: `http://127.0.0.1:${closedPort}` }), t);
  const response = await fetch(`${base}/api/health/ready`);
  assert.equal(response.status, 502); assert.equal((await response.json()).code, 'GATEWAY_UNAVAILABLE');
  const slow = await listen(http.createServer(() => {}), t);
  const timed = await listen(createServer({ apiBaseUrl: slow, timeoutMs: 25 }), t);
  assert.equal((await fetch(`${timed}/api/health/ready`)).status, 504);
  assert.throws(() => createServer({ apiBaseUrl: 'http://example.com/internal' }));
});

test('request journal redacts passwords, accepts an expected 409, and expires unauthorized sessions', async t => {
  const entries = []; let unauthorized = 0;
  const api = createApi(entry => entries.push(entry), () => unauthorized++);
  let response = new Response('{"userId":1}', { status: 200 });
  t.mock.method(globalThis, 'fetch', async () => response);
  await api('/auth/login', { method: 'POST', body: { username: 'demo', password: 'secret' } });
  assert.equal(entries[0].body.password, '••••••••');
  assert.doesNotMatch(JSON.stringify(entries), /secret/);
  response = new Response('{"code":"IDEMPOTENCY_CONFLICT"}', { status: 409 });
  assert.equal((await api('/orders', { expected: [409] })).status, 409);
  response = new Response('{"message":"Unauthorized"}', { status: 401 });
  await assert.rejects(api('/billing/account'), ApiError); assert.equal(unauthorized, 1);
});
