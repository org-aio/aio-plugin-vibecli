import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createError } from 'h3';
import type { Project } from '../../shared/commands/model';
import type { Scope } from '../hosting/authentication';
import { configuration } from '../hosting/configuration';
import { databasePool } from '../hosting/database';

const migration = `CREATE TABLE IF NOT EXISTS vibecli_projects (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, id UUID NOT NULL,
  updated_at TEXT NOT NULL, document JSONB NOT NULL,
  PRIMARY KEY (tenant_id, user_id, id)
)`;

export interface ProjectStore {
  ready(): Promise<void>;
  list(scope: Scope): Promise<Project[]>;
  get(scope: Scope, id: string): Promise<Project>;
  create(scope: Scope, project: Project): Promise<Project>;
  update(scope: Scope, id: string, expected: string, change: (project: Project) => Promise<Project>): Promise<Project>;
}

function missing(): never { throw createError({ statusCode: 404, message: '命令项目不存在' }); }
function check(current: Project, expected: string): void {
  if (current.updated_at !== expected) {
    throw createError({ statusCode: 409, message: '项目已被修改，请重新加载后重试' });
  }
}
function timestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export class PostgresStore implements ProjectStore {
  private initialized?: Promise<void>;
  constructor(private readonly pool: Pool, private readonly initializeSchema = true) {}
  async ready(): Promise<void> {
    this.initialized ||= this.pool.query(this.initializeSchema ? migration : 'SELECT id FROM vibecli_projects LIMIT 0').then(() => undefined);
    try { await this.initialized; }
    catch (error) { this.initialized = undefined; throw error; }
    await this.pool.query('SELECT 1');
  }
  async list(scope: Scope): Promise<Project[]> {
    await this.ready();
    const result = await this.pool.query<{ document: Project }>(
      'SELECT document FROM vibecli_projects WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC',
      [scope.tenant, scope.user],
    );
    return result.rows.map(row => row.document);
  }
  async get(scope: Scope, id: string): Promise<Project> {
    await this.ready();
    const result = await this.pool.query<{ document: Project }>(
      'SELECT document FROM vibecli_projects WHERE tenant_id=$1 AND user_id=$2 AND id=$3',
      [scope.tenant, scope.user, id],
    );
    return result.rows[0]?.document || missing();
  }
  async create(scope: Scope, project: Project): Promise<Project> {
    await this.ready();
    await this.pool.query('INSERT INTO vibecli_projects(tenant_id,user_id,id,updated_at,document) VALUES($1,$2,$3,$4,$5)',
      [scope.tenant, scope.user, project.id, project.updated_at, JSON.stringify(project)]);
    return project;
  }
  async update(scope: Scope, id: string, expected: string, change: (project: Project) => Promise<Project>): Promise<Project> {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ document: Project }>(
        'SELECT document FROM vibecli_projects WHERE tenant_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',
        [scope.tenant, scope.user, id],
      );
      const current = result.rows[0]?.document || missing();
      check(current, expected);
      const updated = await change(structuredClone(current));
      updated.updated_at = timestamp(current.updated_at);
      await client.query('UPDATE vibecli_projects SET document=$4,updated_at=$5 WHERE tenant_id=$1 AND user_id=$2 AND id=$3',
        [scope.tenant, scope.user, id, JSON.stringify(updated), updated.updated_at]);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

interface StoredProject { scope: Scope; project: Project }

export class FileStore implements ProjectStore {
  private queue = Promise.resolve();
  constructor(private readonly path: string) {}
  async ready(): Promise<void> { await mkdir(resolve(this.path, '..'), { recursive: true, mode: 0o700 }); }
  private async records(): Promise<StoredProject[]> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as StoredProject[]; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
      throw error;
    }
  }
  private async write(records: StoredProject[]): Promise<void> {
    await this.ready();
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
    await rename(temporary, this.path);
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(action, action);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  private matches(record: StoredProject, scope: Scope): boolean {
    return record.scope.tenant === scope.tenant && record.scope.user === scope.user;
  }
  async list(scope: Scope): Promise<Project[]> {
    await this.queue;
    return (await this.records()).filter(record => this.matches(record, scope))
      .map(record => record.project).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }
  async get(scope: Scope, id: string): Promise<Project> {
    const projects = await this.list(scope);
    return projects.find(project => project.id === id) || missing();
  }
  create(scope: Scope, project: Project): Promise<Project> {
    return this.exclusive(async () => {
      const records = await this.records();
      records.push({ scope: { ...scope }, project: structuredClone(project) });
      await this.write(records);
      return structuredClone(project);
    });
  }
  update(scope: Scope, id: string, expected: string, change: (project: Project) => Promise<Project>): Promise<Project> {
    return this.exclusive(async () => {
      const records = await this.records();
      const record = records.find(item => this.matches(item, scope) && item.project.id === id) || missing();
      const current = record.project;
      check(current, expected);
      const updated = await change(structuredClone(current));
      updated.updated_at = timestamp(current.updated_at);
      record.project = structuredClone(updated);
      await this.write(records);
      return updated;
    });
  }
}

let singleton: ProjectStore | undefined;
export function store(): ProjectStore {
  if (singleton) { return singleton; }
  const config = configuration();
  if (config.databaseUrl) {
    singleton = new PostgresStore(databasePool(), !config.hosted);
  } else if (config.development) {
    singleton = new FileStore(resolve(process.env.VIBECLI_DATA_DIR || '.data', 'projects.json'));
  } else { throw new Error('正式运行必须配置 PostgreSQL 数据库'); }
  return singleton;
}
