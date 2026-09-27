import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

test('正式 ELF 在只读、无网络和 16 MiB 临时目录的容器内发布执行', { timeout: 120000 }, async () => {
  const image = 'node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
  assert.ok((await readFile('aio-plugin.toml', 'utf8')).includes(`image = "${image}"`));
  const context = process.env.VIBECLI_TEST_DOCKER_CONTEXT;
  const docker = async (...args) => promisify(execFile)('docker', [...(context ? ['--context', context] : []), ...args], { timeout: 90000, maxBuffer: 1024 * 1024 });
  const name = `vibecli-test-${randomUUID()}`;
  try {
    await docker('run', '--detach', '--rm', '--platform=linux/amd64', `--name=${name}`,
      '--network=none', '--read-only', '--user=65532:65532', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
      '--memory=1073741824', '--pids-limit=256', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16777216',
      `--mount=type=bind,src=${resolve('dist/server')},dst=/plugin/server,readonly`,
      '--env=VIBECLI_DEVELOPMENT=1', '--env=VIBECLI_DATA_DIR=/tmp/data', '--env=PORT=8080',
      '--entrypoint=/plugin/server', image);
    const result = await docker('exec', name, 'node', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const base = 'http://127.0.0.1:8080';
      let healthy = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        try { healthy = (await fetch(base + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
        if (healthy) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(healthy, '正式容器未就绪');
      async function api(path, body) {
        const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        return JSON.parse(text);
      }
      const project = await api('/api/projects', { title: '正式入口验收' });
      const published = await api('/api/projects/' + project.id + '/publish', { expected_updated_at: project.updated_at });
      assert.ok(published.active_revision);
      const output = await api('/api/cli/' + project.id + '/invoke', { argv: ['greet', '--name', 'Ada'] });
      assert.equal(output.stdout, 'Hello, Ada!\\n');
      assert.equal(output.exit_code, 0);
      console.log('正式 ELF、临时目录限额、发布与 QuickJS 执行通过');
    `);
    assert.match(result.stdout, /QuickJS/);
  } catch (error) {
    try { error.message += '\n' + (await docker('logs', name)).stdout; } catch {}
    throw error;
  } finally {
    try { await docker('rm', '--force', name); } catch {}
  }
});
