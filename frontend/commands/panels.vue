<script setup lang="ts">
import { Check, CheckCircle2, Download, Play, RotateCcw, ShieldCheck, Sparkles, XCircle } from 'lucide-vue-next';
import type { CommandDefinition, ExecutionResult, Project, VerificationReport } from '../../shared/commands/model';
import Arguments from './arguments.vue';
import { text as t } from './text';

defineProps<{
  tab: string; command?: CommandDefinition; documentation: string; previewArguments: string[];
  previewResult: ExecutionResult | null; report: VerificationReport | null; verificationStale: boolean;
  project?: Project; busy: string; disabled: boolean; aiConfigured: boolean;
}>();
const emit = defineEmits<{
  'update:previewArguments': [value: string[]]; preview: []; verify: []; fix: []; download: []; activate: [revision: string];
}>();

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
</script>

<template>
  <div v-if="tab === 'documentation'" class="document-panel">
    <header class="section-header panel-header"><h2>{{ t.generatedDocument }}</h2>
      <button type="button" class="button small" @click="emit('download')"><Download :size="15" />{{ t.download }}</button>
    </header>
    <pre class="document-content">{{ documentation }}</pre>
  </div>

  <div v-else-if="tab === 'preview'" class="preview-panel">
    <section class="preview-runner">
      <header class="section-header"><h2>{{ command ? `aio ${command.path.join(' ')}` : t.preview }}</h2>
        <button type="button" class="button primary small" :disabled="disabled || !command" @click="emit('preview')"><Play :size="14" />{{ busy === 'preview' ? t.running : t.run }}</button>
      </header>
      <div v-if="command" class="preview-inputs">
        <label class="field example-picker"><span>{{ t.chooseExample }}</span>
          <select :disabled="disabled" @change="emit('update:previewArguments', [...(command.examples[Number(($event.target as HTMLSelectElement).value)]?.argv || [])])">
            <option v-for="(_, index) in command.examples" :key="index" :value="index">{{ t.exampleNumber(index) }}</option>
          </select>
        </label>
        <div class="field"><span>{{ t.arguments }}</span><Arguments :model-value="previewArguments" :disabled="disabled" @update:model-value="emit('update:previewArguments', $event)" /></div>
      </div>
      <div v-if="previewResult" class="execution-output">
        <div class="output-heading"><span>{{ t.stdout }}</span><span :class="['badge', previewResult.exit_code === 0 ? 'success' : 'error']">{{ t.exitCode }} {{ previewResult.exit_code }}</span></div>
        <pre>{{ previewResult.stdout || t.noOutput }}</pre>
        <template v-if="previewResult.stderr"><div class="output-heading error-text">{{ t.stderr }}</div><pre class="stderr-output">{{ previewResult.stderr }}</pre></template>
      </div>
      <div v-else class="runner-empty"><Play :size="24" /><span>{{ t.noResult }}</span></div>
    </section>

    <section class="verification-section">
      <header class="section-header"><h2>{{ t.verification }}</h2>
        <div class="actions"><button v-if="report && !report.passed" type="button" class="button small" :disabled="disabled || !aiConfigured" @click="emit('fix')"><Sparkles :size="14" />{{ t.fixFailures }}</button>
          <button type="button" class="button small" :disabled="disabled" @click="emit('verify')"><ShieldCheck :size="14" />{{ busy === 'verify' ? t.verifying : t.verify }}</button>
        </div>
      </header>
      <div v-if="report" class="verification-summary">
        <span :class="['badge', report.passed ? 'success' : 'error']"><CheckCircle2 v-if="report.passed" :size="14" /><XCircle v-else :size="14" />{{ report.passed ? t.verified : t.verificationFailed }}</span>
        <span class="muted">{{ t.testCount(report.results.filter(result => result.passed).length, report.results.length) }}</span>
        <span v-if="verificationStale" class="warning-text">{{ t.verificationStale }}</span>
      </div>
      <p v-else class="muted section-empty">{{ t.noVerification }}</p>
      <div v-if="report" class="verification-results">
        <details v-for="(result, index) in report.results" :key="index" :open="!result.passed" class="verification-result">
          <summary><CheckCircle2 v-if="result.passed" :size="16" class="success-text" /><XCircle v-else :size="16" class="error-text" />
            <code>{{ result.argv.join(' ') }}</code><span :class="result.passed ? 'success-text' : 'error-text'">{{ result.passed ? t.passed : t.failed }}</span>
          </summary>
          <div class="comparison"><div><h3>{{ t.expected }} <span>{{ t.exitCode }} {{ result.expected_exit_code }}</span></h3><pre>{{ result.expected_stdout || t.noOutput }}</pre></div>
            <div><h3>{{ t.actual }} <span>{{ t.exitCode }} {{ result.actual.exit_code }}</span></h3><pre>{{ result.actual.stdout || t.noOutput }}</pre><pre v-if="result.actual.stderr" class="stderr-output">{{ result.actual.stderr }}</pre></div>
          </div>
        </details>
      </div>
    </section>
  </div>

  <div v-else-if="tab === 'versions'" class="versions-panel">
    <header class="section-header panel-header"><h2>{{ t.versions }} <span class="count">{{ project?.revisions.length || 0 }}</span></h2>
      <span class="muted metadata">{{ project?.active_revision ? t.published : t.unpublished }}</span>
    </header>
    <div v-if="project?.revisions.length" class="revision-list">
      <div v-for="revision in [...project.revisions].reverse()" :key="revision.id" class="revision-row">
        <div :class="['revision-icon', { selected: revision.id === project.active_revision }]"><Check :size="18" /></div>
        <div class="revision-details"><div class="revision-title"><code>{{ t.revisionShort(revision.id) }}</code><span v-if="revision.id === project.active_revision" class="badge success">{{ t.active }}</span></div>
          <div class="revision-meta"><time :datetime="revision.created_at">{{ formatDate(revision.created_at) }}</time><span>{{ t.commandCount(revision.bundle.commands.length) }}</span><span>{{ t.testCount(revision.report.results.filter(result => result.passed).length, revision.report.results.length) }}</span></div>
        </div>
        <button v-if="revision.id !== project.active_revision" type="button" class="button small" :disabled="disabled" @click="emit('activate', revision.id)"><RotateCcw :size="14" />{{ busy === 'activate' ? t.activating : t.rollback }}</button>
      </div>
    </div>
    <div v-else class="panel-empty"><RotateCcw :size="28" /><span>{{ t.noVersions }}</span></div>
  </div>
</template>
