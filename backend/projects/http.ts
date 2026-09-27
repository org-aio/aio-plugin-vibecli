import { createError, getRouterParam, readRawBody, getHeader, type H3Event } from 'h3';
import { z } from 'zod';
import { bundleSchema } from '../../shared/commands/model';

export const titleRequest = z.object({ title: z.string().trim().min(1).max(120) }).strict();
const expected = z.string().datetime();
export const draftRequest = z.object({ draft: bundleSchema, expected_updated_at: expected }).strict();
export const argvSchema = z.array(z.string().max(4096)).max(128);
export const previewRequest = z.object({ draft: bundleSchema, argv: argvSchema }).strict();
export const verifyRequest = z.object({ draft: bundleSchema }).strict();
export const publishRequest = z.object({ expected_updated_at: expected }).strict();
export const activateRequest = z.object({ revision: z.string().uuid(), expected_updated_at: expected }).strict();
export const generateRequest = z.object({
  intent: z.string().trim().min(1).max(12000), feedback: z.unknown().optional(), draft: bundleSchema.optional(),
}).strict();
export const invokeRequest = z.object({ argv: argvSchema }).strict();

export function projectId(event: H3Event): string {
  const parsed = z.string().uuid().safeParse(getRouterParam(event, 'id'));
  if (!parsed.success) { throw createError({ statusCode: 400, message: '项目 ID 无效' }); }
  return parsed.data;
}

export async function body<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const limit = 8 * 1024 * 1024;
  if (Number(getHeader(event, 'content-length')) > limit) {
    throw createError({ statusCode: 413, message: '请求超过 8 MiB' });
  }
  const raw = await readRawBody(event, false);
  if (!raw || raw.length > limit) { throw createError({ statusCode: 400, message: 'JSON 请求体缺失或超过配额' }); }
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')); }
  catch { throw createError({ statusCode: 400, message: '请求体必须是 JSON' }); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues.map(issue => issue.message).join('; ').slice(0, 1000) });
  }
  return parsed.data;
}
