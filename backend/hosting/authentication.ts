import { timingSafeEqual } from 'node:crypto';
import { createError, getHeader, type H3Event } from 'h3';
import { configuration } from './configuration';

export interface Scope { tenant: string; user: string }

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authenticate(event: H3Event): Scope {
  const config = configuration();
  if (config.hosted) {
    const token = getHeader(event, 'x-aio-token') || '';
    const tenant = getHeader(event, 'x-aio-tenant-id');
    const user = getHeader(event, 'x-aio-user-id');
    if (!equal(token, config.ingressToken || '') || tenant !== config.tenant || !user || user.length > 128) {
      throw createError({ statusCode: 401, message: 'AIO 调用身份无效' });
    }
    return { tenant, user };
  }
  if (config.accessToken) {
    const authorization = getHeader(event, 'authorization') || '';
    if (!equal(authorization, `Bearer ${config.accessToken}`)) {
      throw createError({ statusCode: 401, message: 'VibeCLI 调用凭据无效' });
    }
    return { tenant: 'standalone', user: 'owner' };
  }
  const address = event.node.req.socket.remoteAddress;
  if (!config.development || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) {
    throw createError({ statusCode: 401, message: '未配置调用凭据，本机开发仅允许 loopback' });
  }
  return { tenant: 'standalone', user: 'owner' };
}

export function scope(event: H3Event): Scope {
  return event.context.vibecliScope as Scope || authenticate(event);
}
