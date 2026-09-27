import { Pool } from 'pg';
import { configuration } from './configuration';

let pool: Pool | undefined;
export function databasePool(): Pool {
  const config = configuration();
  if (!config.databaseUrl) { throw new Error('PostgreSQL 数据库未配置'); }
  pool ||= new Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
  return pool;
}
