import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { initialBundle, type Workspace } from '../shared/commands/model';

test('桌面与移动端命令编辑、试跑、发布、回滚和运行时模型设置', { timeout: 60000 }, async () => {
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) { /* 读取请求后返回确定性测试草稿。 */ }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(initialBundle('浏览器生成草稿')) }] }] }));
  });
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.VIBECLI_TEST_UI_URL || 'http://127.0.0.1:8791';
    await page.goto(base);
    await page.getByRole('button', { name: '新增命令集', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: '新建命令集' });
    const title = `界面验收 ${Date.now()}`;
    await dialog.getByLabel('命令集名称').fill(title);
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByLabel('命令路径')).toHaveValue('greet');
    await page.getByRole('button', { name: '验证', exact: true }).first().click();
    await expect(page.getByText('全部通过', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await expect(page.locator('.execution-output pre').first()).toHaveText('Hello, Ada!');
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await expect(page.getByText('版本已发布', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '逻辑', exact: true }).click();
    await page.getByLabel('命令路径').fill('wave');
    await page.getByLabel('执行逻辑').fill('return "Hi " + input.name;');
    await page.getByLabel('预期标准输出').fill('Hi Ada\n');
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await expect(page.getByText('版本已发布', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '版本', exact: true }).click();
    await expect(page.locator('.revision-row')).toHaveCount(2);
    await page.getByRole('button', { name: '启用此版本', exact: true }).click();
    await page.getByRole('dialog', { name: '切换发布版本？' }).getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByText('已切换发布版本', { exact: true })).toBeVisible();
    const workspace = await (await page.request.get(`${base}/api/projects`)).json() as Workspace;
    const project = workspace.projects.find(value => value.title === title)!;
    const invoked = await (await page.request.post(`${base}/api/cli/${project.id}/invoke`, { data: { argv: ['greet', '--name', 'Ada'] } })).json();
    assert.equal(invoked.stdout, 'Hello, Ada!\n');
    await page.getByRole('button', { name: 'AI 设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'AI 设置' }).first();
    await settings.getByLabel('模型入口', { exact: true }).fill(`http://127.0.0.1:${(model.address() as { port: number }).port}/v1`);
    await settings.getByLabel('模型', { exact: true }).fill('test-browser-generator');
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('AI 设置已保存', { exact: true })).toBeVisible();
    await page.getByLabel('AI 意图', { exact: true }).fill('生成问候命令');
    await page.getByRole('button', { name: '生成草稿', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '审核生成草稿' })).toBeVisible();
    await page.getByRole('button', { name: '采用草稿', exact: true }).click();
    await expect(page.getByLabel('命令集名称')).toHaveValue('浏览器生成草稿');
    await page.getByRole('tab', { name: '文档', exact: true }).click();
    await expect(page.locator('.document-content')).toContainText('aio greet --name');
    await page.getByRole('tab', { name: '逻辑', exact: true }).click();
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
    await page.getByRole('button', { name: '连接 CLI', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '连接 CLI' })).toBeVisible();
    await page.screenshot({ path: 'test-results/mobile-dialog.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise<void>(resolve => model.close(() => resolve()));
  }
});
