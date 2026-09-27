<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, Check, ChevronRight, Code2, Copy, Download, FileText, Folder, FolderOpen, GitBranch, Link2, LoaderCircle, Plus, Save, Send, Settings as SettingsIcon, ShieldCheck, Sparkles, Terminal, Trash2, Upload, X } from 'lucide-vue-next';
import { bundleSchema, type CommandBundle } from '../../shared/commands/model';
import Editor from './editor.vue';
import Panels from './panels.vue';
import Modal from './modal.vue';
import Settings from './settings.vue';
import { useWorkbench } from './state';
import { text as t } from './text';

const {
  projects, projectId, project, draft, command, selectedCommand, editorSession, dirty, loading, loadFailure,
  error, notice, busy, editingDisabled, development, aiConfigured, intent, feedback, generated,
  report, verificationStale, activeRevision, draftDocumentation, previewArguments, previewResult,
  generatedChanged, cliConnection, connectionCommand, selectCommand, selectProject,
  load, createProject, save, verify, publish, activate, runPreview, generate, adoptGenerated,
  useFailureFeedback, addCommand, deleteCommand, copy, downloadDocumentation,
} = useWorkbench();
const tab = ref('logic');
const modal = ref('');
const settingsBusy = ref(false);
const newTitle = ref('');
const pendingProject = ref('');
const pendingRevision = ref('');
const importedBundle = ref<CommandBundle | null>(null);
const importInput = ref<HTMLInputElement>();
const connectionMode = ref('aio');
const hostOrigin = ref('');
const sourceId = ref('');
const account = ref('');
const tabs = [
  { id: 'logic', label: t.logic, icon: Code2 },
  { id: 'documentation', label: t.documentation, icon: FileText },
  { id: 'preview', label: t.preview, icon: Terminal },
  { id: 'versions', label: t.versions, icon: GitBranch },
];
const titles: Record<string, string> = {
  create: t.newProject, delete: t.deleteTitle, switch: t.discardTitle, 'create-confirm': t.discardTitle,
  generation: t.generationTitle, replace: t.replaceTitle, connect: t.connectionTitle, activate: t.rollbackTitle,
  import: t.importTitle,
  settings: t.settings,
};
const modalTitle = computed(() => titles[modal.value] || '');
const treeRows = computed(() => {
  const rows: { key: string; label: string; depth: number; index: number | null }[] = [];
  const groups = new Set<string>();
  const commands = (draft.value?.commands || []).map((item, index) => ({ item, index }));
  commands.sort((first, second) => first.item.path.join(' ').localeCompare(second.item.path.join(' ')));
  for (const { item, index } of commands) {
    for (let depth = 0; depth < item.path.length - 1; depth += 1) {
      const key = item.path.slice(0, depth + 1).join(' ');
      if (!groups.has(key)) {
        groups.add(key);
        rows.push({ key: `group-${key}`, label: item.path[depth] || '', depth, index: null });
      }
    }
    rows.push({ key: `command-${index}`, label: item.path.at(-1) || t.untitledCommand, depth: Math.max(0, item.path.length - 1), index });
  }
  return rows;
});
const validHost = computed(() => {
  try {
    const value = new URL(hostOrigin.value);
    return ['http:', 'https:'].includes(value.protocol) ? value.origin : '';
  } catch {
    return '';
  }
});
const aioConnect = computed(() => validHost.value && sourceId.value.trim()
  ? `aio vibecli connect ${shellArgument(validHost.value)} --source ${shellArgument(sourceId.value.trim())} --project ${projectId.value}` : '');
const aioLogin = computed(() => validHost.value && account.value.trim()
  ? `aio vibecli login ${shellArgument(validHost.value)} --account ${shellArgument(account.value.trim())} --password-stdin` : '');

function shellArgument(value: string) {
  return /^[a-zA-Z0-9_./:@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function openCreate() {
  error.value = '';
  newTitle.value = '';
  modal.value = dirty.value ? 'create-confirm' : 'create';
}

function switchProject(id: string) {
  if (id === projectId.value) {
    return;
  }
  if (dirty.value) {
    pendingProject.value = id;
    modal.value = 'switch';
    return;
  }
  selectProject(id);
}

async function submitCreate() {
  await createProject(newTitle.value);
  if (!error.value) {
    modal.value = '';
  }
}

function adopt() {
  if (dirty.value || generatedChanged.value) {
    modal.value = 'replace';
    return;
  }
  adoptGenerated();
  modal.value = '';
  tab.value = 'logic';
}

async function fix() {
  useFailureFeedback();
  await generate();
}

async function startGeneration() {
  if (!aiConfigured.value) {
    modal.value = 'settings';
    return;
  }
  await generate();
}

function settingsSaved(configured: boolean) {
  aiConfigured.value = configured;
  notice.value = t.settingsSaved;
  modal.value = '';
}

function showConnection() {
  connectionMode.value = development.value && connectionCommand.value ? 'local' : 'aio';
  const endpoint = cliConnection.value?.endpoint || cliConnection.value?.url;
  if (endpoint) {
    hostOrigin.value = new URL(endpoint, window.location.origin).origin;
  }
  modal.value = 'connect';
}

function requestActivate(revision: string) {
  pendingRevision.value = revision;
  modal.value = 'activate';
}

async function confirmActivate() {
  await activate(pendingRevision.value);
  if (!error.value) {
    modal.value = '';
  }
}

function exportBundle() {
  const blob = new Blob([JSON.stringify(draft.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${draft.value?.title || 'commands'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function applyImport() {
  if (!importedBundle.value) {
    return;
  }
  draft.value = importedBundle.value;
  importedBundle.value = null;
  report.value = null;
  selectCommand(0);
  tab.value = 'logic';
  modal.value = '';
  notice.value = t.importSuccess;
}

async function importBundle(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  try {
    const result = bundleSchema.safeParse(JSON.parse(await file.text()));
    if (!result.success) {
      throw new Error(result.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('\n'));
    }
    importedBundle.value = result.data;
    if (dirty.value) {
      modal.value = 'import';
    } else {
      applyImport();
    }
  } catch (failure) {
    error.value = `${t.importError}: ${failure instanceof Error ? failure.message : String(failure)}`;
  } finally {
    input.value = '';
  }
}

watch(generated, value => {
  if (value) {
    modal.value = 'generation';
  }
});
watch(projectId, () => { tab.value = 'logic'; });
</script>

<template>
  <main class="vibe-workbench">
    <header class="workspace-topbar">
      <div class="brand"><div class="brand-mark"><Terminal :size="21" /></div><h1>{{ t.brand }}</h1><span>{{ t.workspace }}</span></div>
      <div class="topbar-actions">
        <span v-if="draft" :class="['draft-status', { dirty }]"><span class="status-dot" />{{ dirty ? t.unsaved : t.saved }}</span>
        <button type="button" class="icon-button" :disabled="Boolean(busy)" :title="t.settings" :aria-label="t.settings" @click="modal = 'settings'"><SettingsIcon :size="18" /></button>
        <button type="button" class="icon-button" :disabled="!project || Boolean(busy)" :title="t.connect" :aria-label="t.connect" @click="showConnection"><Link2 :size="18" /></button>
        <span class="toolbar-divider" />
        <button type="button" class="button" :disabled="!draft || !dirty || Boolean(busy)" @click="save"><Save :size="15" /><span>{{ busy === 'save' ? t.saving : t.save }}</span></button>
        <button type="button" class="button" :disabled="!draft || Boolean(busy)" @click="verify(); tab = 'preview'"><ShieldCheck :size="15" /><span>{{ busy === 'verify' ? t.verifying : t.verify }}</span></button>
        <button type="button" class="button primary" :disabled="!draft || Boolean(busy)" @click="publish"><Send :size="14" /><span>{{ busy === 'publish' ? t.publishing : t.publish }}</span></button>
      </div>
    </header>

    <div v-if="loading" class="workspace-state" role="status"><LoaderCircle :size="26" /><p>{{ t.loading }}</p></div>
    <div v-else-if="loadFailure" class="workspace-state error-text" role="alert"><Terminal :size="28" /><h2>{{ t.loadError }}</h2><p>{{ loadFailure }}</p><button type="button" class="button" @click="load">{{ t.retry }}</button></div>
    <div v-else class="workspace-layout">
      <aside class="workspace-sidebar">
        <section class="project-navigation">
          <header class="sidebar-heading"><h2>{{ t.projects }}</h2><button type="button" class="icon-button small" :disabled="Boolean(busy)" :title="t.addProject" :aria-label="t.addProject" @click="openCreate"><Plus :size="16" /></button></header>
          <nav v-if="projects.length" :aria-label="t.projects" class="project-list">
            <button v-for="item in projects" :key="item.id" type="button" :class="['project-button', { selected: item.id === projectId }]" :disabled="Boolean(busy)" @click="switchProject(item.id)">
              <FolderOpen v-if="item.id === projectId" :size="17" /><Folder v-else :size="17" />
              <span>{{ item.title }}</span><span v-if="item.active_revision" class="project-published-dot" :title="t.published" />
            </button>
          </nav>
          <p v-else class="sidebar-empty">{{ t.noProjects }}</p>
        </section>

        <section v-if="draft" class="command-navigation">
          <header class="sidebar-heading"><h2>{{ t.commands }} <span class="count">{{ draft.commands.length }}</span></h2><button type="button" class="icon-button small" :disabled="editingDisabled || draft.commands.length >= 64" :title="t.addCommand" :aria-label="t.addCommand" @click="addCommand(); tab = 'logic'"><Plus :size="16" /></button></header>
          <nav v-if="treeRows.length" :aria-label="t.commands" class="command-tree">
            <template v-for="row in treeRows" :key="row.key">
              <div v-if="row.index === null" class="tree-group" :style="{ paddingLeft: `${14 + row.depth * 14}px` }"><ChevronRight :size="12" /><Folder :size="14" /><span>{{ row.label }}</span></div>
              <button v-else type="button" :class="['tree-command', { selected: row.index === selectedCommand }]" :style="{ paddingLeft: `${18 + row.depth * 14}px` }" :disabled="editingDisabled" @click="selectCommand(row.index)"><Terminal :size="14" /><span>{{ row.label }}</span></button>
            </template>
          </nav>
          <p v-else class="sidebar-empty">{{ t.noCommands }}</p>
        </section>
        <div class="sidebar-footer"><span :class="['badge', activeRevision ? 'success' : 'warning']">{{ activeRevision ? t.published : t.draft }}</span><code v-if="activeRevision">{{ t.revisionShort(activeRevision.id) }}</code><span v-if="development" class="muted">{{ t.development }}</span></div>
      </aside>

      <div class="workspace-main">
        <div v-if="error" class="status-message error" role="alert"><span>{{ error }}</span><button type="button" class="icon-button small" :title="t.close" :aria-label="t.close" @click="error = ''"><X :size="15" /></button></div>
        <div v-else-if="notice" class="status-message success" role="status"><Check :size="16" /><span>{{ notice }}</span><button type="button" class="icon-button small" :title="t.close" :aria-label="t.close" @click="notice = ''"><X :size="15" /></button></div>

        <template v-if="draft">
          <header class="project-header"><div class="project-title-block"><span class="eyebrow">{{ t.projects }}</span><input v-model="draft.title" class="project-title" :aria-label="t.projectTitle" :disabled="editingDisabled"></div><div class="project-summary"><span>{{ t.commandCount(draft.commands.length) }}</span><span :class="['badge', { warning: dirty }]">{{ t.draft }}</span><button type="button" class="icon-button small" :title="t.exportBundle" :aria-label="t.exportBundle" :disabled="Boolean(busy)" @click="exportBundle"><Download :size="15" /></button><button type="button" class="icon-button small" :title="t.importBundle" :aria-label="t.importBundle" :disabled="Boolean(busy)" @click="importInput?.click()"><Upload :size="15" /></button><input ref="importInput" type="file" hidden accept=".json,application/json" @change="importBundle"></div></header>
          <div class="workspace-tabbar"><div class="tabs" role="tablist" :aria-label="t.workspace"><button v-for="item in tabs" :id="`tab-${item.id}`" :key="item.id" type="button" role="tab" :aria-selected="tab === item.id" :aria-controls="`panel-${item.id}`" :class="['tab', { selected: tab === item.id }]" @click="tab = item.id"><component :is="item.icon" :size="15" />{{ item.label }}<span v-if="item.id === 'preview' && report" :class="['tab-dot', report.passed ? 'success' : 'error']" /></button></div><button v-if="command && tab === 'logic'" type="button" class="icon-button danger small" :title="t.removeCommand" :aria-label="t.removeCommand" :disabled="editingDisabled" @click="modal = 'delete'"><Trash2 :size="15" /></button></div>
          <div :id="`panel-${tab}`" class="workspace-content" role="tabpanel" :aria-labelledby="`tab-${tab}`">
            <Editor v-if="tab === 'logic' && command" :key="editorSession" :command="command" :disabled="editingDisabled" />
            <div v-else-if="tab === 'logic'" class="panel-empty"><Terminal :size="30" /><h2>{{ t.emptyCommand }}</h2><button type="button" class="button" :disabled="editingDisabled" @click="addCommand"><Plus :size="15" />{{ t.addCommand }}</button></div>
            <Panels v-else :tab="tab" :command="command" :documentation="draftDocumentation" v-model:preview-arguments="previewArguments" :preview-result="previewResult" :report="report" :verification-stale="verificationStale" :project="project" :busy="busy" :disabled="Boolean(busy)" :ai-configured="aiConfigured" @preview="runPreview" @verify="verify" @fix="fix" @download="downloadDocumentation" @activate="requestActivate" />
          </div>
          <form class="ai-bar" @submit.prevent="startGeneration"><div class="ai-label"><Sparkles :size="16" /><label for="ai-intent">{{ t.aiIntent }}</label><span v-if="!aiConfigured" class="muted metadata">{{ t.aiUnavailable }}</span></div>
            <div v-if="feedback" class="feedback-badge"><span>{{ t.aiFeedback }}</span><button type="button" class="icon-button small" :title="t.clearFeedback" :aria-label="t.clearFeedback" :disabled="Boolean(busy)" @click="feedback = ''"><X :size="13" /></button></div>
            <div class="ai-input-row"><textarea id="ai-intent" v-model="intent" rows="2" :placeholder="t.aiPlaceholder" :disabled="Boolean(busy)" /><button type="submit" class="button ai-generate" :disabled="Boolean(busy) || (aiConfigured && !intent.trim())" :title="aiConfigured ? t.generate : t.configureAi"><LoaderCircle v-if="busy === 'generate'" :size="16" /><ArrowRight v-else :size="16" /><span>{{ busy === 'generate' ? t.generating : aiConfigured ? t.generate : t.configureAi }}</span></button></div>
          </form>
        </template>
        <div v-else class="panel-empty initial-empty"><Terminal :size="36" /><h2>{{ t.noProjects }}</h2><button type="button" class="button primary" @click="openCreate"><Plus :size="16" />{{ t.addProject }}</button></div>
      </div>
    </div>

    <Modal :open="Boolean(modal)" :title="modalTitle" :wide="modal === 'generation'" @close="() => { if (!settingsBusy && !busy) modal = ''; }">
      <p v-if="error && modal !== 'settings'" class="modal-error" role="alert">{{ error }}</p>
      <Settings v-if="modal === 'settings'" @saved="settingsSaved" @busy="settingsBusy = $event" />
      <form v-else-if="modal === 'create'" id="create-project-form" @submit.prevent="submitCreate"><label class="field"><span>{{ t.projectTitle }}</span><input v-model="newTitle" autofocus maxlength="120" :placeholder="t.projectPlaceholder" :disabled="Boolean(busy)" required></label></form>
      <p v-else-if="modal === 'delete'">{{ t.deleteBody }} <code>{{ command?.path.join(' ') }}</code></p>
      <p v-else-if="['switch', 'create-confirm'].includes(modal)">{{ t.discardBody }}</p>
      <p v-else-if="['replace', 'import'].includes(modal)">{{ t.replaceBody }}</p>
      <p v-else-if="modal === 'activate'">{{ t.rollbackBody }} <code>{{ t.revisionShort(pendingRevision) }}</code></p>
      <div v-else-if="modal === 'generation' && generated" class="generation-review"><div class="generation-heading"><h3>{{ generated.bundle.title }}</h3><span class="badge warning">{{ t.draft }}</span></div><p v-if="generatedChanged" class="warning-text">{{ t.generatedChanged }}</p><h4>{{ t.generatedCommands }}</h4><ul><li v-for="(item, index) in generated.bundle.commands" :key="index"><code>{{ item.path.join(' ') }}</code><span>{{ item.description }}</span></li></ul><pre class="generated-document">{{ generated.documentation }}</pre></div>
      <div v-else-if="modal === 'connect'" class="connection-settings">
        <div class="segmented-control"><button type="button" :class="{ selected: connectionMode === 'local' }" :disabled="!development || !connectionCommand" @click="connectionMode = 'local'">{{ t.localMode }}</button><button type="button" :class="{ selected: connectionMode === 'aio' }" @click="connectionMode = 'aio'">{{ t.aioMode }}</button></div>
        <div class="connection-version"><span>{{ t.connectionVersion }}</span><code v-if="activeRevision">{{ t.revisionShort(activeRevision.id) }}</code><span v-else class="badge warning">{{ t.unpublished }}</span></div>
        <template v-if="connectionMode === 'local'"><div class="connection-code"><span>{{ t.localConnection }}</span><code>{{ connectionCommand }}</code><button type="button" class="icon-button" :title="t.copy" :aria-label="t.copy" @click="copy(connectionCommand)"><Copy :size="16" /></button></div></template>
        <template v-else><div v-if="!development && connectionCommand" class="connection-code"><span>{{ t.connectionCommand }}</span><code>{{ connectionCommand }}</code><button type="button" class="icon-button" :title="t.copy" :aria-label="t.copy" @click="copy(connectionCommand)"><Copy :size="16" /></button></div><div class="connection-fields"><label class="field"><span>{{ t.hostOrigin }}</span><input v-model="hostOrigin" type="url" :placeholder="t.hostPlaceholder"></label><label class="field"><span>{{ t.sourceId }}</span><input v-model="sourceId" class="mono" :placeholder="t.sourcePlaceholder"></label><label class="field"><span>{{ t.account }}</span><input v-model="account" autocomplete="username" :placeholder="t.accountPlaceholder"></label></div>
          <div v-if="aioLogin" class="connection-code"><span>{{ t.loginCommand }}</span><code>{{ aioLogin }}</code><button type="button" class="icon-button" :title="t.copy" :aria-label="t.copy" @click="copy(aioLogin)"><Copy :size="16" /></button></div>
          <div v-if="aioConnect" class="connection-code"><span>{{ t.connectionCommand }}</span><code>{{ aioConnect }}</code><button type="button" class="icon-button" :title="t.copy" :aria-label="t.copy" @click="copy(aioConnect)"><Copy :size="16" /></button></div><p v-else class="muted">{{ t.connectionInputsMissing }}</p>
        </template>
      </div>
      <template #footer><button type="button" class="button" :disabled="Boolean(busy) || settingsBusy" @click="modal = ''">{{ modal === 'connect' ? t.close : t.cancel }}</button>
        <button v-if="modal === 'settings'" type="submit" form="ai-settings-form" class="button primary" :disabled="settingsBusy">{{ settingsBusy ? t.saving : t.save }}</button>
        <button v-else-if="modal === 'create'" type="submit" form="create-project-form" class="button primary" :disabled="!newTitle.trim() || Boolean(busy)">{{ t.create }}</button>
        <button v-else-if="modal === 'delete'" type="button" class="button destructive" @click="deleteCommand(); modal = ''">{{ t.delete }}</button>
        <button v-else-if="modal === 'switch'" type="button" class="button destructive" @click="selectProject(pendingProject); modal = ''">{{ t.discard }}</button>
        <button v-else-if="modal === 'create-confirm'" type="button" class="button destructive" @click="modal = 'create'">{{ t.discard }}</button>
        <button v-else-if="modal === 'generation'" type="button" class="button primary" @click="adopt">{{ t.adopt }}</button>
        <button v-else-if="modal === 'replace'" type="button" class="button primary" @click="adoptGenerated(); modal = ''; tab = 'logic'">{{ t.adopt }}</button>
        <button v-else-if="modal === 'import'" type="button" class="button primary" @click="applyImport">{{ t.confirm }}</button>
        <button v-else-if="modal === 'activate'" type="button" class="button primary" :disabled="Boolean(busy)" @click="confirmActivate">{{ busy === 'activate' ? t.activating : t.confirm }}</button>
      </template>
    </Modal>
  </main>
</template>
