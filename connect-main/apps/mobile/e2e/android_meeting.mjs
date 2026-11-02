// Drives the real app on an Android emulator against a disposable local API and LiveKit server.
// Never point this at production. Requires API_URL as reachable from the test machine.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const API_URL = process.env.API_URL || 'http://localhost:8080';
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:3000';
const PACKAGE = 'com.aitathastu.connect';
const stamp = Date.now();

assert.ok(/localhost|127\.0\.0\.1/.test(API_URL), 'This test only runs against a local API.');

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (name) => console.log(`STEP ${name}`);
const passed = (name) => console.log(`CHECK ok ${name}`);

function decode(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function screen() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml');
  const xml = adb('shell', 'cat', '/sdcard/window.xml');
  const nodes = [];
  for (const match of xml.matchAll(/<node [^>]*>/g)) {
    const attr = (name) => decode(match[0].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '');
    const bounds = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;
    nodes.push({
      text: attr('text'),
      label: attr('content-desc'),
      className: attr('class'),
      x: (Number(bounds[1]) + Number(bounds[3])) / 2,
      y: (Number(bounds[2]) + Number(bounds[4])) / 2,
    });
  }
  return nodes;
}

const matches = (node, wanted) => node.label === wanted || node.text === wanted || node.label.includes(wanted) || node.text.includes(wanted);

async function find(wanted, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last = [];
  while (Date.now() < deadline) {
    try {
      last = screen();
      const hit = last.find((node) => matches(node, wanted));
      if (hit) return hit;
    } catch {
      // The screen is changing; uiautomator cannot dump mid-transition.
    }
    await sleep(1000);
  }
  const seen = last.map((n) => n.label || n.text).filter(Boolean).slice(0, 25).join(' | ');
  throw new Error(`"${wanted}" did not appear. Saw: ${seen}`);
}

async function tap(wanted, timeout) {
  const node = await find(wanted, timeout);
  adb('shell', 'input', 'tap', String(Math.round(node.x)), String(Math.round(node.y)));
  await sleep(600);
}

async function typeInto(fieldIndex, value) {
  let fields = [];
  for (let i = 0; i < 20 && fields.length <= fieldIndex; i++) {
    fields = screen().filter((n) => n.className.includes('EditText'));
    if (fields.length <= fieldIndex) await sleep(1000);
  }
  assert.ok(fields[fieldIndex], `no text field ${fieldIndex}`);
  adb('shell', 'input', 'tap', String(Math.round(fields[fieldIndex].x)), String(Math.round(fields[fieldIndex].y)));
  await sleep(500);
  adb('shell', 'input', 'text', value.replace(/ /g, '%s'));
  await sleep(500);
  adb('shell', 'input', 'keyevent', '111');
  await sleep(500);
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function signup(name) {
  const email = `${name}-${stamp}@example.test`;
  const res = await api('POST', '/api/v1/auth/signup', null, { email, password: 'correct-horse-battery-9', displayName: name });
  assert.equal(res.status, 201, `signup ${name}`);
  return { name, email, token: res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1], id: res.data.user.id };
}

async function hostRoom(host, options = {}) {
  const created = await api('POST', '/api/v1/rooms', host.token, options);
  assert.equal(created.status, 201);
  const code = created.data.room.publicCode;
  assert.equal((await api('POST', `/api/v1/rooms/${code}/join`, host.token, {})).status, 200);
  return code;
}

async function until(fn, what, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function launch() {
  adb('shell', 'am', 'force-stop', PACKAGE);
  adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
}

async function joinByCode(code, name) {
  await typeInto(0, code);
  await tap('Join meeting');
  await find('Join meeting room');
  if (name) await typeInto(0, name);
  await tap('Join meeting room');
}

const backendEmpty = async (code, host) => (await api('GET', `/api/v1/rooms/${code}/messages`, host.token)).data.messages;

try {
  for (const permission of ['CAMERA', 'RECORD_AUDIO', 'POST_NOTIFICATIONS']) {
    try {
      adb('shell', 'pm', 'grant', PACKAGE, `android.permission.${permission}`);
    } catch {
      // Not declared on this version.
    }
  }

  const host = await signup('androidhost');

  step('a guest joins a meeting from the app');
  const code = await hostRoom(host);
  launch();
  await find('Join meeting');
  await joinByCode(code, 'Emu Guest');
  await find('Open in-meeting chat', 60000);
  passed('guest connected to a real LiveKit room');

  step('chat is stored with a server-set sender');
  await tap('Open in-meeting chat');
  await typeInto(0, 'hello from android');
  await tap('Send');
  const stored = await until(async () => (await backendEmpty(code, host)).find((m) => m.body === 'hello from android'), 'the message');
  assert.equal(stored.senderName, 'Emu Guest');
  assert.ok(stored.senderIdentity.startsWith('guest:'));
  passed('chat stored with the server-set sender');

  step('a message from the host reaches the app');
  assert.equal((await api('POST', `/api/v1/rooms/${code}/messages`, host.token, { clientMessageId: `h${stamp}`, body: 'hello from the host' })).status, 201);
  await find('hello from the host');
  passed('chat received');
  adb('shell', 'input', 'keyevent', '4');
  await sleep(1000);

  step('an announcement shows on the app');
  assert.equal((await api('POST', `/api/v1/rooms/${code}/messages`, host.token, { clientMessageId: `a${stamp}`, body: 'exam moved', kind: 'announcement' })).status, 201);
  await find('exam moved');
  await tap('Dismiss announcement');
  passed('announcement received');

  step('hand state round trips');
  await tap('Raise hand');
  const guestHand = await until(async () => {
    const hands = (await api('GET', `/api/v1/rooms/${code}/live-state`, host.token)).data.raisedHands;
    return hands.length === 1 ? hands[0] : null;
  }, 'the raised hand');
  assert.equal(guestHand, stored.senderIdentity);
  await find('Lower hand');
  assert.equal((await api('DELETE', `/api/v1/rooms/${code}/participants/${encodeURIComponent(guestHand)}/hand`, host.token)).status, 200);
  await find('Raise hand');
  passed('host lowered the hand and the app followed');

  step('a reaction is stored');
  await tap('Send emoji reaction');
  await sleep(1000);
  const emoji = screen().find((n) => ['👍', '👏', '❤️', '🎉', '💡', '🔥'].includes(n.text));
  assert.ok(emoji, 'no reaction picker');
  adb('shell', 'input', 'tap', String(Math.round(emoji.x)), String(Math.round(emoji.y)));
  await until(async () => (await api('GET', `/api/v1/rooms/${code}/live-state`, host.token)).data.reactions.length === 1, 'the reaction');
  passed('reaction stored');

  step('history survives an app restart');
  launch();
  await find('Join meeting');
  await joinByCode(code, 'Emu Guest');
  await tap('Open in-meeting chat', 60000);
  await find('hello from android');
  await find('hello from the host');
  passed('chat restored after restart');

  step('the waiting room holds the app until the host admits it');
  const waitingCode = await hostRoom(host, { waitingRoomEnabled: true });
  launch();
  await find('Join meeting');
  await joinByCode(waitingCode, 'Emu Waiter');
  await find('Waiting for the host', 30000);
  const pending = await until(async () => {
    const list = (await api('GET', `/api/v1/rooms/${waitingCode}/admission/pending`, host.token)).data.requests;
    return list?.length === 1 ? list[0] : null;
  }, 'the admission request');
  assert.equal((await api('POST', `/api/v1/rooms/${waitingCode}/admission/decision`, host.token, { requestId: pending.id, decision: 'admitted' })).status, 200);
  await find('Open in-meeting chat', 60000);
  passed('waiting room admitted the app');

  step('a signed-in user follows co-host changes');
  const member = await signup('androidmember');
  const roleCode = await hostRoom(host);
  launch();
  await tap('Sign in');
  await find('Sign in');
  const fields = screen().filter((n) => n.className.includes('EditText'));
  assert.ok(fields.length >= 2, 'no sign-in fields');
  await typeInto(fields.length - 2, member.email);
  await typeInto(fields.length - 1, 'correct-horse-battery-9');
  const submit = screen().filter((n) => n.text === 'Sign in' || n.label === 'Sign in').pop();
  adb('shell', 'input', 'tap', String(Math.round(submit.x)), String(Math.round(submit.y)));
  await sleep(3000);
  await joinByCode(roleCode);
  await find('Open in-meeting chat', 60000);
  assert.equal((await api('POST', `/api/v1/rooms/${roleCode}/participants/${encodeURIComponent(`user:${member.id}`)}/cohost`, host.token)).status, 200);
  await sleep(6000);
  await tap('Participants');
  await find('Co-host');
  await find('Mute');
  passed('co-host role reached the app');

  console.log('E2E PASS android meeting');
} catch (err) {
  console.log(`E2E FAIL android ${String(err.message).replace(/\s+/g, ' ').slice(0, 500)}`);
  process.exitCode = 1;
}
