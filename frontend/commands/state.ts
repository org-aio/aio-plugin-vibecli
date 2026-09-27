import { computed, onMounted, ref } from 'vue';
import { bundleSchema, type CommandBundle, type CommandDefinition, type ExecutionResult, type Project, type VerificationReport, type Workspace } from '../../shared/commands/model';
import { documentation } from '../../shared/commands/documentation';
import { text } from './text';

export interface CliConnection { endpoint?: string; url?: string; command?: string; revision?: string }
export interface WorkbenchProject extends Project { cli_connection?: CliConnection | string }
interface WorkbenchWorkspace extends Workspace { projects: WorkbenchProject[] }
interface GeneratedDraft { bundle: CommandBundle; documentation: string }
interface PluginBridge { json<T>(method: string, path: string, value?: unknown): Promise<T>; copy?(value: string): Promise<unknown> }

function bridge(): PluginBridge | undefined {
  return (window as unknown as { aioPlugin?: PluginBridge }).aioPlugin;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const value = JSON.parse(message) as { error?: string; message?: string };
    return value.error || value.message || message;
  } catch {
    return message;
  }
}

export async function request<T>(method: string, path: string, value?: unknown): Promise<T> {
  const guest = bridge();
  if (guest) {
    return guest.json<T>(method, path, value);
  }
  const response = await fetch(path, {
    method,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
    credentials: 'omit',
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || result.message || `HTTP ${response.status}`);
  }
  return result as T;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fingerprint(value: CommandBundle | null): string {
  return JSON.stringify(value);
}

export function useWorkbench() {
  const projects = ref<WorkbenchProject[]>([]);
  const projectId = ref('');
  const draft = ref<CommandBundle | null>(null);
  const savedDraft = ref('null');
  const selectedCommand = ref(0);
  const loading = ref(true);
  const loadFailure = ref('');
  const error = ref('');
  const notice = ref('');
  const busy = ref('');
  const development = ref(false);
  const aiConfigured = ref(false);
  const intent = ref('');
  const feedback = ref('');
  const generated = ref<GeneratedDraft | null>(null);
  const generatedFrom = ref('');
  const report = ref<VerificationReport | null>(null);
  const verifiedDraft = ref('');
  const previewArguments = ref<string[]>([]);
  const previewResult = ref<ExecutionResult | null>(null);
  const project = computed(() => projects.value.find(item => item.id === projectId.value));
  const command = computed(() => draft.value?.commands[selectedCommand.value]);
  const dirty = computed(() => fingerprint(draft.value) !== savedDraft.value);
  const editingDisabled = computed(() => Boolean(busy.value) && busy.value !== 'generate');
  const activeRevision = computed(() => project.value?.revisions.find(item => item.id === project.value?.active_revision));
  const draftDocumentation = computed(() => draft.value ? documentation(draft.value) : '');
  const verificationStale = computed(() => report.value !== null && fingerprint(draft.value) !== verifiedDraft.value);
  const generatedChanged = computed(() => fingerprint(draft.value) !== generatedFrom.value);
  const cliConnection = computed(() => {
    const connection = project.value?.cli_connection;
    if (typeof connection === 'string') {
      return connection.startsWith('aio ') ? { command: connection } : { endpoint: connection };
    }
    if (connection) {
      return connection;
    }
    if (development.value && !bridge() && projectId.value) {
      return { endpoint: `${window.location.origin}/api/cli/${encodeURIComponent(projectId.value)}` };
    }
    return null;
  });
  const connectionCommand = computed(() => {
    const connection = cliConnection.value;
    const endpoint = connection?.endpoint || connection?.url;
    return connection?.command || (endpoint ? `aio vibecli connect ${endpoint}` : '');
  });

  function selectCommand(index: number) {
    selectedCommand.value = index;
    previewArguments.value = clone(command.value?.examples[0]?.argv || []);
    previewResult.value = null;
  }

  function selectProject(id: string) {
    const next = projects.value.find(item => item.id === id);
    if (!next) {
      return;
    }
    projectId.value = next.id;
    draft.value = clone(next.draft);
    savedDraft.value = fingerprint(next.draft);
    report.value = null;
    verifiedDraft.value = '';
    generated.value = null;
    feedback.value = '';
    error.value = '';
    notice.value = '';
    selectCommand(0);
  }

  function updateProject(next: WorkbenchProject) {
    const index = projects.value.findIndex(item => item.id === next.id);
    if (index < 0) {
      projects.value.push(next);
    } else {
      projects.value[index] = next;
    }
  }

  async function operation(name: string, action: () => Promise<void>) {
    if (busy.value) {
      return;
    }
    busy.value = name;
    error.value = '';
    notice.value = '';
    try {
      await action();
    } catch (failure) {
      error.value = errorMessage(failure);
    } finally {
      busy.value = '';
    }
  }

  async function load() {
    loading.value = true;
    loadFailure.value = '';
    try {
      const workspace = await request<WorkbenchWorkspace>('GET', '/api/projects');
      projects.value = workspace.projects;
      development.value = workspace.development;
      aiConfigured.value = workspace.ai_configured;
      if (projects.value[0]) {
        selectProject(projects.value[0].id);
      }
    } catch (failure) {
      loadFailure.value = errorMessage(failure);
    } finally {
      loading.value = false;
    }
  }

  async function createProject(title: string) {
    await operation('create', async () => {
      if (!title.trim()) {
        throw new Error(text.emptyTitle);
      }
      const next = await request<WorkbenchProject>('POST', '/api/projects', { title: title.trim() });
      updateProject(next);
      selectProject(next.id);
      notice.value = text.createSuccess;
    });
  }

  function validDraft(): CommandBundle {
    const result = bundleSchema.safeParse(draft.value);
    if (!result.success) {
      throw new Error(`${text.invalidDraft}: ${result.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('\n')}`);
    }
    return result.data;
  }

  async function persistDraft() {
    if (!project.value) {
      throw new Error(text.notFound);
    }
    const next = await request<WorkbenchProject>('PUT', `/api/projects/${encodeURIComponent(projectId.value)}`, {
      draft: validDraft(), expected_updated_at: project.value.updated_at,
    });
    updateProject(next);
    draft.value = clone(next.draft);
    savedDraft.value = fingerprint(next.draft);
  }

  async function save() {
    await operation('save', async () => {
      await persistDraft();
      notice.value = text.saveSuccess;
    });
  }

  async function verify() {
    await operation('verify', async () => {
      const input = validDraft();
      const result = await request<VerificationReport>('POST', `/api/projects/${encodeURIComponent(projectId.value)}/verify`, { draft: input });
      report.value = result;
      verifiedDraft.value = fingerprint(draft.value);
      notice.value = result.passed ? text.verificationSuccess : '';
    });
  }

  async function publish() {
    await operation('publish', async () => {
      if (dirty.value) {
        await persistDraft();
      }
      const next = await request<WorkbenchProject>('POST', `/api/projects/${encodeURIComponent(projectId.value)}/publish`, {
        expected_updated_at: project.value?.updated_at,
      });
      updateProject(next);
      draft.value = clone(next.draft);
      savedDraft.value = fingerprint(next.draft);
      report.value = next.revisions.find(item => item.id === next.active_revision)?.report || null;
      verifiedDraft.value = fingerprint(draft.value);
      notice.value = text.publishSuccess;
    });
  }

  async function activate(revision: string) {
    await operation('activate', async () => {
      const next = await request<WorkbenchProject>('POST', `/api/projects/${encodeURIComponent(projectId.value)}/activate`, {
        revision, expected_updated_at: project.value?.updated_at,
      });
      updateProject(next);
      notice.value = text.activateSuccess;
    });
  }

  async function runPreview() {
    await operation('preview', async () => {
      if (!command.value) {
        return;
      }
      const input = validDraft();
      previewResult.value = await request<ExecutionResult>('POST', `/api/projects/${encodeURIComponent(projectId.value)}/preview`, {
        draft: input, argv: [...command.value.path, ...previewArguments.value],
      });
    });
  }

  async function generate() {
    if (!intent.value.trim() || !aiConfigured.value || !project.value) {
      return;
    }
    const input = clone(draft.value);
    generatedFrom.value = fingerprint(input);
    await operation('generate', async () => {
      const result = await request<GeneratedDraft>('POST', `/api/projects/${encodeURIComponent(projectId.value)}/generate`, {
        intent: intent.value.trim(), feedback: feedback.value || undefined, draft: input || undefined,
      });
      generated.value = result;
    });
  }

  function adoptGenerated() {
    if (!generated.value) {
      return;
    }
    draft.value = clone(generated.value.bundle);
    generated.value = null;
    report.value = null;
    notice.value = text.generatedSuccess;
    selectCommand(0);
  }

  function useFailureFeedback() {
    if (!report.value) {
      return;
    }
    feedback.value = JSON.stringify(report.value.results.filter(item => !item.passed), null, 2);
    if (!intent.value.trim()) {
      intent.value = text.fixIntent;
    }
  }

  function addCommand() {
    if (!draft.value) {
      return;
    }
    const paths = new Set(draft.value.commands.map(item => item.path.join(' ')));
    let name = 'command';
    let number = 1;
    while (paths.has(name)) {
      number += 1;
      name = `command-${number}`;
    }
    const next: CommandDefinition = {
      path: [name], description: text.untitledCommand, options: [], source: 'return "";',
      examples: [{ argv: [], expected_stdout: '\n', expected_exit_code: 0 }],
    };
    draft.value.commands.push(next);
    selectCommand(draft.value.commands.length - 1);
  }

  function deleteCommand() {
    draft.value?.commands.splice(selectedCommand.value, 1);
    selectCommand(Math.max(0, selectedCommand.value - 1));
  }

  async function copy(value: string) {
    try {
      const guest = bridge();
      if (guest?.copy) {
        await guest.copy(value);
      } else {
        await navigator.clipboard.writeText(value);
      }
      notice.value = text.copied;
    } catch (failure) {
      error.value = errorMessage(failure);
    }
  }

  function downloadDocumentation() {
    const blob = new Blob([draftDocumentation.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.value?.title || 'commands'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  onMounted(load);
  return {
    projects, projectId, project, draft, command, selectedCommand, dirty, loading, loadFailure,
    error, notice, busy, editingDisabled, development, aiConfigured, intent, feedback, generated,
    report, verificationStale, activeRevision, draftDocumentation, previewArguments, previewResult,
    generatedChanged, cliConnection, connectionCommand, selectCommand, selectProject,
    load, createProject, save, verify, publish, activate, runPreview, generate, adoptGenerated,
    useFailureFeedback, addCommand, deleteCommand, copy, downloadDocumentation,
  };
}
