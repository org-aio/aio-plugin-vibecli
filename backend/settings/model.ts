import { createError } from 'h3';
import { z } from 'zod';
import type { Configuration } from '../hosting/configuration';

export const settingsRequest = z.object({
  endpoint: z.string().trim().min(1).max(2048), model: z.string().trim().min(1).max(256),
  protocol: z.enum(['responses', 'chat-completions']),
  api_key: z.string().max(8192).optional(), clear_key: z.boolean().optional(),
}).strict();
export type SettingsDraft = z.infer<typeof settingsRequest>;
export interface SettingsRecord { endpoint: string; model: string; protocol: Configuration['aiProtocol']; ciphertext: string | null }
export interface SettingsView {
  endpoint: string; model: string; protocol: Configuration['aiProtocol']; has_key: boolean;
  allowed_endpoints: string[]; configured: boolean;
}

export function validateEndpoint(value: string, config: Configuration): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw createError({ statusCode: 400, message: '模型地址必须是完整 API 基址' }); }
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) {
    throw createError({ statusCode: 400, message: '模型地址配置无效' });
  }
  const normalized = value.replace(/\/+$/, '');
  if (config.hosted && !config.allowedEndpoints.includes(normalized)) {
    throw createError({ statusCode: 400, message: '模型地址未获宿主授权' });
  }
  if (!config.hosted && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw createError({ statusCode: 400, message: '模型地址必须是 HTTPS 或本机 loopback' });
  }
  return normalized;
}
