import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Configuration } from '../hosting/configuration';
import { LocalCipher, HostCipher } from './cryptography';
import { FileSettingsStore } from './store';
import { SettingsService } from './service';

const config: Configuration = {
  hosted: false, development: true, tenant: 'standalone', allowedEndpoints: [], aiProtocol: 'responses',
};

test('设置按身份加密保存，GET 无明文，空白保留，显式清除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-settings-'));
  try {
    const path = join(directory, 'settings.json');
    const cipher = new LocalCipher(randomBytes(32));
    const storage = new FileSettingsStore(path);
    const settings = new SettingsService(config, storage, async () => cipher);
    const scope = { tenant: 'tenant', user: 'owner' };
    const draft = { endpoint: 'http://127.0.0.1:9999/v1', model: 'fixture', protocol: 'responses' as const };
    const saved = await settings.save(scope, { ...draft, api_key: 'fixture-private-secret' });
    assert.equal(saved.has_key, true);
    assert.equal(saved.configured, true);
    assert.equal(JSON.stringify(saved).includes('fixture-private-secret'), false);
    assert.equal((await readFile(path, 'utf8')).includes('fixture-private-secret'), false);
    assert.equal((await settings.modelConfiguration(scope)).aiKey, 'fixture-private-secret');
    assert.equal((await settings.read({ tenant: 'other', user: 'owner' })).has_key, false);
    assert.equal((await settings.read({ tenant: 'tenant', user: 'other' })).has_key, false);
    await settings.save(scope, { ...draft, model: 'changed', api_key: '   ' });
    assert.equal((await settings.modelConfiguration(scope)).aiKey, 'fixture-private-secret');
    await settings.save(scope, { ...draft, clear_key: true });
    assert.equal((await settings.read(scope)).has_key, false);
    assert.equal((await settings.modelConfiguration(scope)).aiKey, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('AES GCM 密文不能跨租户或用户解密，宿主设置拒绝未授权地址', async () => {
  const cipher = new LocalCipher(randomBytes(32));
  const scope = { tenant: 'tenant', user: 'owner' };
  const encrypted = await cipher.seal(scope, 'fixture-private-secret');
  await assert.rejects(cipher.open({ tenant: 'other', user: 'owner' }, encrypted));
  await assert.rejects(cipher.open({ tenant: 'tenant', user: 'other' }, encrypted));
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-settings-'));
  try {
    const settings = new SettingsService({ ...config, hosted: true, allowedEndpoints: ['https://approved.invalid/v1'] },
      new FileSettingsStore(join(directory, 'settings.json')), async () => cipher);
    await assert.rejects(settings.save(scope, { endpoint: 'https://other.invalid/v1', model: 'fixture', protocol: 'responses' }), { statusCode: 400 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('宿主密钥操作走 Unix broker 和绑定用户的 purpose', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-crypto-'));
  const socket = join(directory, 'broker.sock');
  const calls: { path: string; purpose: string; value: string }[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers['x-aio-token'], 'fixture-ingress-token');
    const chunks: Buffer[] = [];
    for await (const chunk of request) { chunks.push(Buffer.from(chunk)); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push({ path: request.url || '', ...body });
    response.setHeader('content-type', 'application/json');
    const clear = Buffer.from(body.value, 'base64').toString('utf8');
    const value = request.url === '/cryptography/seal' ? `sealed:${clear}` : clear.slice(7);
    response.end(JSON.stringify({ value: Buffer.from(value).toString('base64') }));
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  try {
    const cipher = new HostCipher({ ...config, hosted: true, brokerSocket: socket, ingressToken: 'fixture-ingress-token' });
    const scope = { tenant: 'tenant', user: 'owner' };
    const encrypted = await cipher.seal(scope, 'fixture-private-secret');
    assert.equal(await cipher.open(scope, encrypted), 'fixture-private-secret');
    assert.deepEqual(calls.map(call => [call.path, call.purpose]), [
      ['/cryptography/seal', 'vibecli-ai:owner'], ['/cryptography/open', 'vibecli-ai:owner'],
    ]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
