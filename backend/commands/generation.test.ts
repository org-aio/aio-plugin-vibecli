import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completionText } from './generation';

test('Responses 必须收到 completed，不能把断开的 delta 当作成功', () => {
  const delta = 'data: {"type":"response.output_text.delta","delta":"{\\"schema_version\\":1}"}\n\n';
  assert.throws(() => completionText({ status: 200, contentType: 'text/event-stream', text: delta }, 'responses'), /完整/);
  const text = delta + 'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n';
  assert.equal(completionText({ status: 200, contentType: 'text/event-stream', text }, 'responses'), '{"schema_version":1}');
});

test('Chat Completions 保留内容并拒绝截断输出', () => {
  const first = 'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":null}]}\n\n';
  const complete = first + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  assert.equal(completionText({ status: 200, contentType: 'text/event-stream', text: complete }, 'chat-completions'), '{}');
  const truncated = first + 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n';
  assert.throws(() => completionText({ status: 200, contentType: 'text/event-stream', text: truncated }, 'chat-completions'), /正常完成/);
});
