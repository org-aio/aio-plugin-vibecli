import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createError } from 'h3';
import { z } from 'zod';
import { bundleSchema, type CommandBundle } from '../../shared/commands/model';
import type { Configuration } from '../hosting/configuration';
import type { Scope } from '../hosting/authentication';
import { settings } from '../settings/service';
import { validateEndpoint } from '../settings/model';

const responseLimit = 2 * 1024 * 1024;
interface ModelResponse { status: number; contentType: string; text: string }

function endpoint(config: Configuration): URL {
  if (!config.aiEndpoint || !config.aiModel) {
    throw createError({ statusCode: 503, message: '尚未配置命令生成模型' });
  }
  return new URL(validateEndpoint(config.aiEndpoint, config));
}

function modelRequest(config: Configuration, protocol: Configuration['aiProtocol'], messages: { role: string; content: string }[], deadline: number): Promise<ModelResponse> {
  const base = endpoint(config);
  const payload = protocol === 'responses'
    ? { model: config.aiModel, stream: true, store: false, input: messages, text: { format: { type: 'json_object' } } }
    : { model: config.aiModel, stream: true, messages, response_format: { type: 'json_object' } };
  const body = Buffer.from(JSON.stringify(payload));
  const headers: Record<string, string> = {
    'content-type': 'application/json', accept: 'text/event-stream', 'content-length': String(body.length),
  };
  if (config.aiKey) { headers.authorization = `Bearer ${config.aiKey}`; }
  let url = new URL(`${base.href.replace(/\/+$/, '')}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`);
  if (config.brokerSocket) {
    url = new URL(`http://localhost/${protocol === 'responses' ? 'egress/responses' : 'egress'}`);
    headers['x-aio-token'] = config.ingressToken || '';
    headers['x-aio-endpoint'] = config.aiEndpoint || '';
  }
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'POST', headers, socketPath: config.brokerSocket,
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > responseLimit) {
          request.destroy(new Error('模型响应超过 2 MiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', error => { clearTimeout(timer); reject(error); request.destroy(); });
      response.on('end', () => {
        clearTimeout(timer);
        resolve({ status: response.statusCode || 502, contentType: String(response.headers['content-type'] || ''), text: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('close', () => {
        if (!response.complete) { request.destroy(new Error('模型响应连接提前关闭')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('模型生成超过 60 秒')), Math.max(1, deadline - Date.now()));
    request.on('error', error => { clearTimeout(timer); reject(error); });
    request.end(body);
  });
}

function outputText(response: Record<string, unknown>): string {
  const output = z.array(z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional(),
  }).passthrough()).safeParse(response.output);
  if (!output.success) { return ''; }
  return output.data.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
}

export function completionText(response: ModelResponse, protocol: Configuration['aiProtocol']): string {
  if (response.status < 200 || response.status >= 300) {
    throw createError({ statusCode: 502, message: `模型服务返回 HTTP ${response.status}` });
  }
  if (response.contentType.startsWith('application/json')) {
    const payload = JSON.parse(response.text);
    if (protocol === 'responses') {
      if (payload.status !== 'completed') { throw new Error('模型生成未完成'); }
      return outputText(payload);
    }
    if (payload.choices?.[0]?.finish_reason !== 'stop') { throw new Error('模型生成未完成'); }
    return payload.choices[0].message?.content || '';
  }
  if (!response.contentType.startsWith('text/event-stream')) { throw new Error('模型未返回 JSON 或 SSE'); }
  let text = ''; let complete = false;
  const frames = response.text.replaceAll('\r\n', '\n').split('\n\n');
  for (const frame of frames) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) { continue; }
    if (data === '[DONE]') {
      if (protocol === 'chat-completions') { complete = true; }
      continue;
    }
    const payload = JSON.parse(data);
    if (payload.error || ['error', 'response.failed', 'response.incomplete'].includes(payload.type)) {
      throw new Error('模型生成失败或输出不完整');
    }
    if (protocol === 'responses') {
      if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') { text += payload.delta; }
      if (payload.type === 'response.completed') {
        complete = payload.response?.status === 'completed';
        if (!text && payload.response) { text = outputText(payload.response); }
      }
      continue;
    }
    const choice = payload.choices?.[0];
    if (typeof choice?.delta?.content === 'string') { text += choice.delta.content; }
    if (choice?.finish_reason && choice.finish_reason !== 'stop') { throw new Error('模型输出未正常完成'); }
    if (choice?.finish_reason === 'stop') { complete = true; }
  }
  if (!complete || !text) { throw new Error('模型没有返回完整生成结果'); }
  return text;
}

export async function generate(scope: Scope, intent: string, draft: CommandBundle, feedback?: unknown): Promise<CommandBundle> {
  const config = await settings().modelConfiguration(scope);
  endpoint(config);
  const schema = z.toJSONSchema(bundleSchema, { unrepresentable: 'any' });
  const messages = [{
    role: 'system', content: [
      '你为 VibeCLI 生成完整 JSON 命令集。只输出一个 JSON 对象，不输出 Markdown。必须满足下列 JSON Schema。',
      JSON.stringify(schema),
      '命令 source 是同步 JavaScript 函数体，通过 input 获取参数，必须 return 一个字符串或 JSON 值。禁止网络、文件、process、require、import、异步和外部依赖。',
      '每条命令至少一个 examples。example.argv 只包含参数，不含命令路径；expected_stdout 必须与运行结果逐字一致并包含结尾换行。',
      '不要使用保留入口 init/plugin/tool/helper/open/vibecli/help/space/memory。参数 type 与 default 类型一致。',
    ].join('\n'),
  }, {
    role: 'user', content: JSON.stringify({ intent, current_draft: draft, verification_feedback: feedback ?? null }),
  }];
  const deadline = Date.now() + 60000;
  let protocol = config.aiProtocol;
  let response: ModelResponse;
  try {
    response = await modelRequest(config, protocol, messages, deadline);
    if (protocol === 'responses' && [404, 405, 501].includes(response.status)) {
      protocol = 'chat-completions';
      response = await modelRequest(config, protocol, messages, deadline);
    }
    const text = completionText(response, protocol);
    const value = JSON.parse(text);
    const parsed = bundleSchema.safeParse(value);
    if (!parsed.success) {
      throw createError({ statusCode: 502, message: '模型生成结果不满足命令契约，请调整需求后重试' });
    }
    return parsed.data;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) { throw error; }
    throw createError({ statusCode: 502, message: error instanceof Error ? error.message : '模型生成失败' });
  }
}
