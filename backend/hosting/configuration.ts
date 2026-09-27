import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const hostSchema = z.object({
  abi_version: z.literal(2), tenant_id: z.string().min(1),
  database_url: z.string().nullable().optional(), ingress_token: z.string().min(32),
  broker_socket: z.string().refine(isAbsolute), endpoints: z.array(z.string()),
}).passthrough();

export interface Configuration {
  hosted: boolean; development: boolean; tenant: string; databaseUrl?: string;
  ingressToken?: string; brokerSocket?: string; allowedEndpoints: string[];
  accessToken?: string; aiEndpoint?: string; aiModel?: string; aiKey?: string;
  aiProtocol: 'responses' | 'chat-completions';
}

let cached: Configuration | undefined;

export function configuration(): Configuration {
  if (cached) { return cached; }
  const path = process.env.AIO_PLUGIN_CONFIG;
  let host: z.infer<typeof hostSchema> | undefined;
  if (path) {
    const metadata = statSync(path);
    if (!metadata.isFile() || metadata.size > 65536) { throw new Error('AIO 宿主配置无效'); }
    host = hostSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  }
  const aiKey = process.env.VIBECLI_AI_API_KEY || undefined;
  const aiEndpoint = process.env.VIBECLI_AI_ENDPOINT || (aiKey ? 'https://api.openai.com/v1' : undefined);
  const protocol = process.env.VIBECLI_AI_PROTOCOL || 'responses';
  if (protocol !== 'responses' && protocol !== 'chat-completions') { throw new Error('模型协议配置无效'); }
  const development = !host && (process.env.NODE_ENV !== 'production' || process.env.VIBECLI_DEVELOPMENT === '1');
  cached = {
    hosted: Boolean(host), development, tenant: host?.tenant_id || 'standalone',
    databaseUrl: host?.database_url || process.env.VIBECLI_DATABASE_URL || undefined,
    ingressToken: host?.ingress_token, brokerSocket: host?.broker_socket,
    allowedEndpoints: host?.endpoints || [], accessToken: process.env.VIBECLI_ACCESS_TOKEN || undefined,
    aiEndpoint: aiEndpoint?.replace(/\/+$/, ''), aiModel: process.env.VIBECLI_AI_MODEL || undefined,
    aiKey, aiProtocol: protocol,
  };
  if (!cached.databaseUrl && !cached.development) { throw new Error('正式运行必须配置 PostgreSQL 数据库'); }
  return cached;
}
