// Site access rules (lib/gate.ts): password, Discord session tokens, open paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBearer, checkPassword, isOpenPath, signSession, verifySession } from '../lib/gate.ts';

const secret = 'test-secret';
const later = Math.floor(Date.now() / 1000) + 3600;

test('session tokens verify, and forged / expired / foreign ones do not', async () => {
  const token = await signSession(secret, { user: '1', guild: '2', exp: later });
  assert.deepEqual(await verifySession(secret, token), { user: '1', guild: '2', exp: later });
  assert.equal(await verifySession('other-secret', token), null);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ user: '9', guild: '2', exp: later })).toString('base64url');
  assert.equal(await verifySession(secret, `${forged}.${sig}`), null);
  assert.equal(await verifySession(secret, `${body}.`), null);
  assert.equal(await verifySession(secret, 'garbage'), null);
  const old = await signSession(secret, { user: '1', guild: '2', exp: 1000 });
  assert.equal(await verifySession(secret, old), null);
  assert.equal(await checkBearer(`Bearer ${token}`, secret), true);
  assert.equal(await checkBearer(`Bearer ${token}`, undefined), false);
  assert.equal(await checkBearer(token, secret), false);
});

test('password check', () => {
  const basic = (pw) => `Basic ${btoa(`anyone:${pw}`)}`;
  assert.equal(checkPassword(basic('CEPPI'), 'CEPPI'), true);
  assert.equal(checkPassword(basic('nope'), 'CEPPI'), false);
  assert.equal(checkPassword('Basic !!!', 'CEPPI'), false);
  assert.equal(checkPassword('Bearer x', 'CEPPI'), false);
});

test('only the page (when Discord launches it), code bundle and sign-in endpoint are open', () => {
  assert.equal(isOpenPath('/', '?frame_id=abc&instance_id=1&platform=desktop'), true);
  assert.equal(isOpenPath('/index.html', '?frame_id=abc'), true);
  assert.equal(isOpenPath('/', ''), false);
  assert.equal(isOpenPath('/assets/index-123.js', ''), true);
  assert.equal(isOpenPath('/api/discord/token', ''), true);
  for (const p of ['/gba/power_calligraphy/gfx.json', '/skins/diamond-star/skin.json', '/songs/index.json', '/gba/x?frame_id=1'])
    assert.equal(isOpenPath(p.split('?')[0], p.includes('?') ? '?' + p.split('?')[1] : ''), false, p);
});
