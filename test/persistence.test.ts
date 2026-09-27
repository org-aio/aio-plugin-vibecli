import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PostgresStore } from '../backend/projects/store';
import { initialBundle, type Project } from '../shared/commands/model';

test('PostgreSQL 正式迁移、用户隔离、冲突、事务回滚与重新连接后的持久化', { skip: !process.env.VIBECLI_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.VIBECLI_TEST_DATABASE_URL, max: 4 });
  const scope = { tenant: randomUUID(), user: 'owner' };
  const other = { tenant: scope.tenant, user: 'other' };
  const project: Project = { id: randomUUID(), title: 'pg-test', draft: initialBundle(), revisions: [], active_revision: null, updated_at: new Date().toISOString() };
  try {
    await pool.query(await readFile(new URL('../backend/migrations/0001_projects.sql', import.meta.url), 'utf8'));
    const store = new PostgresStore(pool);
    await store.create(scope, project);
    assert.equal((await store.get(scope, project.id)).title, 'pg-test');
    assert.deepEqual(await store.list(other), []);
    await assert.rejects(store.get(other, project.id), /不存在/);
    await assert.rejects(store.update(scope, project.id, project.updated_at, async () => { throw new Error('rollback-test'); }), /rollback-test/);
    assert.equal((await store.get(scope, project.id)).updated_at, project.updated_at);
    const changes = await Promise.allSettled([
      store.update(scope, project.id, project.updated_at, async value => ({ ...value, title: 'first' })),
      store.update(scope, project.id, project.updated_at, async value => ({ ...value, title: 'second' })),
    ]);
    assert.equal(changes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(changes.filter(value => value.status === 'rejected').length, 1);
    const newPool = new Pool({ connectionString: process.env.VIBECLI_TEST_DATABASE_URL });
    try {
      const reconnected = await new PostgresStore(newPool).get(scope, project.id);
      assert.notEqual(reconnected.updated_at, project.updated_at);
      assert.ok(['first', 'second'].includes(reconnected.title));
    } finally { await newPool.end(); }
  } finally {
    await pool.query('DELETE FROM vibecli_projects WHERE tenant_id=$1', [scope.tenant]);
    await pool.end();
  }
});
