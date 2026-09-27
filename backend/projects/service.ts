import { randomUUID } from 'node:crypto';
import { createError } from 'h3';
import { bundleSchema, initialBundle, type CommandBundle, type Project, type Revision, type Workspace } from '../../shared/commands/model';
import { documentation } from '../../shared/commands/documentation';
import type { Scope } from '../hosting/authentication';
import { configuration } from '../hosting/configuration';
import { execute, verify } from '../commands/runtime';
import { generate } from '../commands/generation';
import { store } from './store';
import { settings } from '../settings/service';

export async function workspace(scope: Scope): Promise<Workspace> {
  const config = configuration();
  const projects = await store().list(scope);
  const model = await settings().read(scope);
  return { projects, development: config.development, ai_configured: model.configured };
}

export async function create(scope: Scope, title: string): Promise<Project> {
  const project: Project = {
    id: randomUUID(), title, draft: initialBundle(title), active_revision: null,
    revisions: [], updated_at: new Date().toISOString(),
  };
  return store().create(scope, project);
}

export function get(scope: Scope, id: string): Promise<Project> { return store().get(scope, id); }

export function save(scope: Scope, id: string, draft: CommandBundle, expected: string): Promise<Project> {
  const bundle = bundleSchema.parse(draft);
  return store().update(scope, id, expected, async project => ({ ...project, title: bundle.title, draft: bundle }));
}

export async function preview(scope: Scope, id: string, draft: CommandBundle, argv: string[]) {
  await get(scope, id);
  return execute(bundleSchema.parse(draft), argv);
}

export async function verification(scope: Scope, id: string, draft: CommandBundle) {
  await get(scope, id);
  return verify(bundleSchema.parse(draft));
}

export function publish(scope: Scope, id: string, expected: string): Promise<Project> {
  return store().update(scope, id, expected, async project => {
    const bundle = bundleSchema.parse(project.draft);
    const report = await verify(bundle);
    if (!report.passed) {
      throw createError({ statusCode: 422, message: '示例验证未全部通过，无法发布', data: { report } });
    }
    const revision: Revision = {
      id: randomUUID(), created_at: new Date().toISOString(), bundle,
      documentation: documentation(bundle), report,
    };
    return { ...project, active_revision: revision.id, revisions: [...project.revisions, revision] };
  });
}

export function activate(scope: Scope, id: string, revisionId: string, expected: string): Promise<Project> {
  return store().update(scope, id, expected, async project => {
    const revision = project.revisions.find(value => value.id === revisionId);
    if (!revision || !revision.report.passed) {
      throw createError({ statusCode: 404, message: '已验证的发布版本不存在' });
    }
    return { ...project, active_revision: revision.id };
  });
}

export async function generation(scope: Scope, id: string, intent: string, feedback?: unknown, draft?: CommandBundle) {
  const project = await get(scope, id);
  const bundle = await generate(scope, intent, draft || project.draft, feedback);
  return { bundle, documentation: documentation(bundle) };
}

async function active(scope: Scope, id: string): Promise<Revision> {
  const project = await get(scope, id);
  const revision = project.revisions.find(value => value.id === project.active_revision);
  if (!revision) { throw createError({ statusCode: 409, message: '项目尚未发布可执行版本' }); }
  return revision;
}

export async function catalog(scope: Scope, id: string) {
  const revision = await active(scope, id);
  return {
    schema_version: 1 as const, revision: revision.id,
    commands: revision.bundle.commands.map(command => ({ path: command.path, description: command.description })),
  };
}

export async function invoke(scope: Scope, id: string, argv: string[]) {
  const revision = await active(scope, id);
  const output = await execute(revision.bundle, argv);
  return { ...output, revision: revision.id };
}
