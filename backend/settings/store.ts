import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import type { Scope } from '../hosting/authentication';
import { configuration } from '../hosting/configuration';
import { databasePool } from '../hosting/database';
import type { SettingsRecord } from './model';

const migration = `CREATE TABLE IF NOT EXISTS vibecli_ai_settings (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, document JSONB NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
)`;

export interface SettingsStore {
  ready(): Promise<void>;
  get(scope: Scope): Promise<SettingsRecord | undefined>;
  update(scope: Scope, change: (current?: SettingsRecord) => Promise<SettingsRecord>): Promise<SettingsRecord>;
}

export class PostgresSettingsStore implements SettingsStore {
  private initialized?: Promise<void>;
  constructor(private readonly pool: Pool, private readonly initializeSchema = true) {}
  async ready(): Promise<void> {
    this.initialized ||= this.pool.query(this.initializeSchema ? migration : 'SELECT user_id FROM vibecli_ai_settings LIMIT 0').then(() => undefined);
    try { await this.initialized; }
    catch (error) { this.initialized = undefined; throw error; }
  }
  async get(scope: Scope): Promise<SettingsRecord | undefined> {
    await this.ready();
    const result = await this.pool.query<{ document: SettingsRecord }>(
      'SELECT document FROM vibecli_ai_settings WHERE tenant_id=$1 AND user_id=$2', [scope.tenant, scope.user],
    );
    return result.rows[0]?.document;
  }
  async update(scope: Scope, change: (current?: SettingsRecord) => Promise<SettingsRecord>): Promise<SettingsRecord> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 首次保存也使用同一事务锁，避免空行上的并发覆盖密钥。
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([scope.tenant, scope.user])]);
      const result = await client.query<{ document: SettingsRecord }>(
        'SELECT document FROM vibecli_ai_settings WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', [scope.tenant, scope.user],
      );
      const updated = await change(result.rows[0]?.document);
      await client.query('INSERT INTO vibecli_ai_settings(tenant_id,user_id,document) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET document=excluded.document',
        [scope.tenant, scope.user, JSON.stringify(updated)]);
      await client.query('COMMIT');
      return updated;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

interface StoredSettings { scope: Scope; settings: SettingsRecord }
export class FileSettingsStore implements SettingsStore {
  private queue = Promise.resolve();
  constructor(private readonly path: string) {}
  async ready(): Promise<void> { await mkdir(resolve(this.path, '..'), { recursive: true, mode: 0o700 }); }
  private async records(): Promise<StoredSettings[]> {
    try { return JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
      throw error;
    }
  }
  private matches(record: StoredSettings, scope: Scope): boolean {
    return record.scope.tenant === scope.tenant && record.scope.user === scope.user;
  }
  async get(scope: Scope): Promise<SettingsRecord | undefined> {
    await this.queue;
    return (await this.records()).find(record => this.matches(record, scope))?.settings;
  }
  update(scope: Scope, change: (current?: SettingsRecord) => Promise<SettingsRecord>): Promise<SettingsRecord> {
    const pending = this.queue.then(async () => {
      await this.ready();
      const records = await this.records();
      let record = records.find(value => this.matches(value, scope));
      const settings = await change(record?.settings);
      if (record) { record.settings = settings; }
      else { record = { scope: { ...scope }, settings }; records.push(record); }
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      await rename(temporary, this.path);
      return settings;
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

let singleton: SettingsStore | undefined;
export function settingsStore(): SettingsStore {
  if (singleton) { return singleton; }
  const config = configuration();
  if (config.databaseUrl) { singleton = new PostgresSettingsStore(databasePool(), !config.hosted); }
  else if (config.development) { singleton = new FileSettingsStore(resolve(process.env.VIBECLI_DATA_DIR || '.data', 'settings.json')); }
  else { throw new Error('正式运行必须配置 PostgreSQL 数据库'); }
  return singleton;
}
