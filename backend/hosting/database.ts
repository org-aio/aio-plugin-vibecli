import { Pool } from 'pg';
import { isAbsolute } from 'node:path';
import { configuration } from './configuration';

let pool: Pool | undefined;
export function databasePool(): Pool {
  const config = configuration();
  if (!config.databaseUrl) { throw new Error('PostgreSQL 数据库未配置'); }
  let connectionString = config.databaseUrl;
  if (config.hosted) {
    const url = new URL(connectionString);
    const host = url.searchParams.get('host');
    if (host && isAbsolute(host) && url.searchParams.get('sslmode') === 'prefer') {
      // pg 不支持 prefer 回退，宿主 Unix socket 使用本地非 TLS 连接。
      url.searchParams.set('sslmode', 'disable');
      connectionString = url.toString();
    }
  }
  pool ||= new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  return pool;
}
