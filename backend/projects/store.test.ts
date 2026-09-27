import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { initialBundle, type Project } from '../../shared/commands/model';
import { FileStore } from './store';

test('文件保存重启后保留，并隔离租户和用户', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-store-'));
  try {
    const path = join(directory, 'projects.json');
    const scope = { tenant: 'tenant', user: 'owner' };
    const project: Project = { id: randomUUID(), title: 'Commands', draft: initialBundle(), revisions: [], active_revision: null, updated_at: new Date().toISOString() };
    await new FileStore(path).create(scope, project);
    const restored = new FileStore(path);
    assert.deepEqual(await restored.get(scope, project.id), project);
    assert.deepEqual(await restored.list({ tenant: 'other', user: 'owner' }), []);
    await assert.rejects(restored.get({ tenant: 'tenant', user: 'other' }, project.id), { statusCode: 404 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('同时使用旧时间保存只允许一次成功，失败的变更不落盘', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vibecli-store-'));
  try {
    const storage = new FileStore(join(directory, 'projects.json'));
    const scope = { tenant: 'tenant', user: 'owner' };
    const project: Project = { id: randomUUID(), title: 'Commands', draft: initialBundle(), revisions: [], active_revision: null, updated_at: new Date().toISOString() };
    await storage.create(scope, project);
    const changes = await Promise.allSettled([
      storage.update(scope, project.id, project.updated_at, async current => ({ ...current, title: 'First' })),
      storage.update(scope, project.id, project.updated_at, async current => ({ ...current, title: 'Second' })),
    ]);
    assert.equal(changes.filter(change => change.status === 'fulfilled').length, 1);
    const failure = changes.find(change => change.status === 'rejected');
    assert.equal(failure?.status === 'rejected' && failure.reason.statusCode, 409);
    const current = await storage.get(scope, project.id);
    await assert.rejects(storage.update(scope, project.id, current.updated_at, async value => {
      value.title = 'Not saved';
      throw new Error('验证失败');
    }), /验证失败/);
    assert.deepEqual(await storage.get(scope, project.id), current);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
