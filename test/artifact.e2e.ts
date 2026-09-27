import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as unixRequest } from 'node:http';
import { createConnection, createServer as createNetServer, type Socket } from 'node:net';
import { Pool } from 'pg';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { initialBundle, type CommandBundle, type Project, type ExecutionResult } from '../shared/commands/model';

const artifactCommand = process.platform === 'linux' && process.arch === 'x64'
  ? { executable: resolve('dist/server'), args: [] }
  : { executable: process.execPath, args: [resolve('dist/server.cjs')] };

test('独立 v2 artifact: AI 草稿、失败反馈、发布、动态命令与回滚闭环', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-e2e-'));
  let generated = initialBundle('AI 命令集');
  const prompts: string[] = [];
  const model = createServer(async (request, response) => {
    let payload = '';
    for await (const chunk of request) { payload += chunk; }
    prompts.push(payload);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify(generated) })}\n\nevent: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } })}\n\n`);
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  const modelPort = (model.address() as { port: number }).port;
  const child = spawn(artifactCommand.executable, artifactCommand.args, {
    cwd: directory, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', VIBECLI_DEVELOPMENT: '1', VIBECLI_DATA_DIR: directory,
      VIBECLI_AI_ENDPOINT: `http://127.0.0.1:${modelPort}/v1`, VIBECLI_AI_MODEL: 'test-generator',
      AIO_PLUGIN_CONFIG: '', AIO_PLUGIN_SOCKET: '', VIBECLI_ACCESS_TOKEN: '', VIBECLI_DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', value => { log += value; });
  child.stderr.on('data', value => { log += value; });
  const exit = once(child, 'exit');
  try {
    let base = '';
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) { throw new Error(log); }
      const match = /http:\/\/(?:127\.0\.0\.1|localhost):([0-9]+)/.exec(log);
      if (match) { base = `http://127.0.0.1:${match[1]}`; break; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(base, log);
    async function api<T>(path: string, method = 'GET', body?: unknown, expectedStatus = 200): Promise<T> {
      const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      assert.equal(response.status, expectedStatus, text);
      return JSON.parse(text) as T;
    }
    await api('/health');
    const describe = await api<{ pages: { id: string }[] }>('/aio/describe');
    assert.equal(describe.pages[0]!.id, 'vibecli');
    let project = await api<Project>('/api/projects', 'POST', { title: 'HTTP 闭环' });
    const path = `/api/projects/${project.id}`;
    const cli = `/api/cli/${project.id}`;
    await api(`${cli}/catalog`, 'GET', undefined, 409);
    generated.commands[0]!.source = 'return "wrong";';
    const first = await api<{ bundle: CommandBundle }>(`${path}/generate`, 'POST', { intent: '问候命令' });
    const report = await api<{ passed: boolean }>(`${path}/verify`, 'POST', { draft: first.bundle });
    assert.equal(report.passed, false);
    project = await api<Project>(path, 'PUT', { draft: first.bundle, expected_updated_at: project.updated_at });
    await api(`${path}/publish`, 'POST', { expected_updated_at: project.updated_at }, 422);
    generated = initialBundle('AI 命令集');
    const corrected = await api<{ bundle: CommandBundle; documentation: string }>(`${path}/generate`, 'POST', { intent: '修复问候结果', feedback: JSON.stringify(report), draft: first.bundle });
    assert.match(prompts[1]!, /verification_feedback/);
    assert.match(corrected.documentation, /--name/);
    project = await api<Project>(path, 'PUT', { draft: corrected.bundle, expected_updated_at: project.updated_at });
    project = await api<Project>(`${path}/publish`, 'POST', { expected_updated_at: project.updated_at });
    const firstRevision = project.active_revision;
    const firstOutput = await api<ExecutionResult>(`${cli}/invoke`, 'POST', { argv: ['greet', '--name', 'Ada'] });
    assert.equal(firstOutput.stdout, 'Hello, Ada!\n');
    const aioBin = process.env.VIBECLI_TEST_AIO_BIN;
    const binaryHash = aioBin ? createHash('sha256').update(await readFile(aioBin)).digest('hex') : '';
    const runAio = async (argv: string[]) => aioBin ? (await promisify(execFile)(aioBin, argv, { cwd: directory, env: { ...process.env, AIO_VIBECLI_URL: `${base}${cli}` } })).stdout : undefined;
    if (aioBin) { assert.equal(await runAio(['greet', '--name', 'Ada']), 'Hello, Ada!\n'); }
    const second = structuredClone(corrected.bundle);
    second.commands[0]!.path = ['welcome'];
    second.commands[0]!.source = 'return "Welcome, " + input.name + "!";';
    second.commands[0]!.examples[0]!.expected_stdout = 'Welcome, Ada!\n';
    const oldUpdatedAt = project.updated_at;
    project = await api<Project>(path, 'PUT', { draft: second, expected_updated_at: oldUpdatedAt });
    await api(path, 'PUT', { draft: corrected.bundle, expected_updated_at: oldUpdatedAt }, 409);
    assert.equal((await api<ExecutionResult>(`${cli}/invoke`, 'POST', { argv: ['greet', '--name', 'Ada'] })).stdout, firstOutput.stdout);
    project = await api<Project>(`${path}/publish`, 'POST', { expected_updated_at: project.updated_at });
    assert.notEqual(project.active_revision, firstRevision);
    assert.equal((await api<ExecutionResult>(`${cli}/invoke`, 'POST', { argv: ['welcome', '--name', 'Ada'] })).stdout, 'Welcome, Ada!\n');
    if (aioBin) {
      assert.equal(await runAio(['welcome', '--name', 'Ada']), 'Welcome, Ada!\n');
      assert.equal(createHash('sha256').update(await readFile(aioBin)).digest('hex'), binaryHash);
    }
    project = await api<Project>(`${path}/activate`, 'POST', { revision: firstRevision, expected_updated_at: project.updated_at });
    assert.equal(project.active_revision, firstRevision);
    assert.equal((await api<ExecutionResult>(`${cli}/invoke`, 'POST', { argv: ['greet', '--name', 'Ada'] })).stdout, 'Hello, Ada!\n');
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    if (child.exitCode === null) { await exit; }
    clearTimeout(timer);
    await new Promise<void>(resolve => model.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('AIO v2 Unix socket artifact 使用 prefer PostgreSQL socket 并校验宿主身份', { skip: !process.env.VIBECLI_TEST_DATABASE_URL, timeout: 30000 }, async () => {
  const databaseUrl = process.env.VIBECLI_TEST_DATABASE_URL;
  assert.ok(databaseUrl);
  const upstream = new URL(databaseUrl);
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-host-'));
  const pool = new Pool({ connectionString: databaseUrl });
  const tenant = randomUUID();
  const token = randomBytes(32).toString('hex');
  const socket = join(directory, 'service.sock');
  const connections = new Set<Socket>();
  let proxyError: Error | undefined;
  const proxy = createNetServer(client => {
    const target = createConnection({ host: upstream.hostname, port: Number(upstream.port || 5432) });
    connections.add(client);
    connections.add(target);
    const fail = (error: Error) => {
      proxyError ||= error;
      client.destroy();
      target.destroy();
    };
    client.on('error', fail);
    target.on('error', fail);
    client.on('close', () => { connections.delete(client); target.destroy(); });
    target.on('close', () => { connections.delete(target); client.destroy(); });
    client.pipe(target).pipe(client);
  });
  proxy.on('error', error => { proxyError ||= error; });
  let initialized = false;
  try {
    const listening = once(proxy, 'listening');
    proxy.listen(join(directory, '.s.PGSQL.5432'));
    await listening;
    for (const name of ['0001_projects.sql', '0002_ai_settings.sql']) {
      await pool.query(await readFile(new URL(`../backend/migrations/${name}`, import.meta.url), 'utf8'));
    }
    initialized = true;
    const hostedDatabaseUrl = new URL(databaseUrl);
    hostedDatabaseUrl.searchParams.set('host', directory);
    hostedDatabaseUrl.searchParams.set('port', '5432');
    hostedDatabaseUrl.searchParams.set('sslmode', 'prefer');
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({ abi_version: 2, tenant_id: tenant, database_url: hostedDatabaseUrl.toString(),
      ingress_token: token, broker_socket: join(directory, 'broker.sock'), endpoints: ['https://api.openai.com/v1'] }), { mode: 0o600 });
    const child = spawn(artifactCommand.executable, artifactCommand.args, {
      cwd: directory, env: { ...process.env, AIO_PLUGIN_CONFIG: configPath, AIO_PLUGIN_SOCKET: socket }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit');
    let log = '';
    child.stdout.on('data', value => { log += value; });
    child.stderr.on('data', value => { log += value; });
    const call = <T>(path: string, method = 'GET', payload?: unknown, actor = 'alice', secret = token): Promise<{ status: number; data: T }> => new Promise((resolve, reject) => {
      const request = unixRequest({ socketPath: socket, path, method, headers: { 'content-type': 'application/json', 'x-aio-token': secret,
        'x-aio-tenant-id': tenant, 'x-aio-user-id': actor } }, response => {
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { resolve({ status: response.statusCode!, data: JSON.parse(body) }); } catch (error) { reject(error); } });
      });
      request.on('error', reject);
      request.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
    try {
      let healthy = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (proxyError) { throw proxyError; }
        if (child.exitCode !== null) { throw new Error(log); }
        try { healthy = (await call('/health')).status === 200; } catch { /* 等待新服务的 socket。 */ }
        if (healthy) { break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(healthy, log);
      assert.equal((await call('/aio/describe')).status, 200);
      assert.equal((await call('/api/projects', 'GET', undefined, 'alice', 'wrong')).status, 401);
      const created = await call<Project>('/api/projects', 'POST', { title: 'AIO host test' });
      assert.equal(created.status, 200);
      const project = created.data;
      assert.equal((await call(`/api/projects/${project.id}`, 'GET', undefined, 'bob')).status, 404);
      const published = await call<Project>(`/api/projects/${project.id}/publish`, 'POST', { expected_updated_at: project.updated_at });
      assert.equal(published.status, 200);
      const output = await call<ExecutionResult>(`/api/cli/${project.id}/invoke`, 'POST', { argv: ['greet', '--name', 'Ada'] });
      assert.equal(output.status, 200);
      assert.equal(output.data.stdout, 'Hello, Ada!\n');
      const record = await pool.query('SELECT document FROM vibecli_projects WHERE tenant_id=$1 AND user_id=$2 AND id=$3', [tenant, 'alice', project.id]);
      assert.equal(record.rows[0].document.active_revision, published.data.active_revision);
      if (proxyError) { throw proxyError; }
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      if (child.exitCode === null) { await exit; }
      clearTimeout(timer);
    }
  } finally {
    for (const connection of connections) { connection.destroy(); }
    if (proxy.listening) { await new Promise<void>(resolve => proxy.close(() => resolve())); }
    try {
      if (initialized) { await pool.query('DELETE FROM vibecli_projects WHERE tenant_id=$1', [tenant]); }
    } finally {
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
