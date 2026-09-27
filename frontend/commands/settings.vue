<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { LoaderCircle, Trash2 } from 'lucide-vue-next';
import Modal from './modal.vue';
import { request } from './state';
import { text as t } from './text';

interface AiSettings {
  endpoint: string; model: string; protocol: 'responses' | 'chat-completions';
  has_key: boolean; allowed_endpoints: string[]; configured: boolean;
}
const emit = defineEmits<{ saved: [configured: boolean]; busy: [value: boolean] }>();
const settings = ref<AiSettings | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const apiKey = ref('');
const clearKey = ref(false);
const clearConfirmation = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  emit('busy', true);
  try {
    const result = await request<AiSettings>('GET', '/api/settings');
    if (result.allowed_endpoints.length && !result.allowed_endpoints.includes(result.endpoint)) {
      result.endpoint = result.allowed_endpoints[0]!;
    }
    settings.value = result;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    loading.value = false;
    emit('busy', false);
  }
}

async function save() {
  if (!settings.value || saving.value) {
    return;
  }
  saving.value = true;
  error.value = '';
  emit('busy', true);
  try {
    const next = await request<AiSettings>('PUT', '/api/settings', {
      endpoint: settings.value.endpoint.trim(), model: settings.value.model.trim(), protocol: settings.value.protocol,
      api_key: apiKey.value || undefined, clear_key: clearKey.value || undefined,
    });
    apiKey.value = '';
    emit('saved', next.configured);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    saving.value = false;
    emit('busy', false);
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="settings-loading" role="status"><LoaderCircle :size="20" /><span>{{ t.settingsLoading }}</span></div>
  <div v-else-if="!settings" class="settings-error" role="alert"><p>{{ t.settingsLoadError }}</p><p>{{ error }}</p><button type="button" class="button small" @click="load">{{ t.retry }}</button></div>
  <form v-else id="ai-settings-form" class="settings-fields" @submit.prevent="save">
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <label class="field"><span>{{ t.endpoint }}</span><select v-if="settings.allowed_endpoints.length" v-model="settings.endpoint" :disabled="saving" required><option v-for="endpoint in settings.allowed_endpoints" :key="endpoint" :value="endpoint">{{ endpoint }}</option></select><input v-else v-model="settings.endpoint" type="url" :placeholder="t.endpointPlaceholder" :disabled="saving" required></label>
    <label class="field"><span>{{ t.model }}</span><input v-model="settings.model" :placeholder="t.modelPlaceholder" :disabled="saving" required></label>
    <label class="field"><span>{{ t.protocol }}</span><select v-model="settings.protocol" :disabled="saving"><option value="responses">{{ t.responsesProtocol }}</option><option value="chat-completions">{{ t.chatProtocol }}</option></select></label>
    <label class="field"><span>{{ t.apiKey }}</span><input v-model="apiKey" type="password" autocomplete="new-password" :placeholder="settings.has_key && !clearKey ? t.keyStored : t.keyPlaceholder" :disabled="saving" @input="clearKey = false"></label>
    <div class="key-action"><span v-if="clearKey" class="warning-text">{{ t.keyCleared }}</span><button v-if="settings.has_key && !clearKey" type="button" class="button subtle small" :disabled="saving" @click="clearConfirmation = true"><Trash2 :size="14" />{{ t.clearKey }}</button></div>
  </form>
  <Modal :open="clearConfirmation" :title="t.clearKeyTitle" @close="clearConfirmation = false"><p>{{ t.clearKeyBody }}</p><template #footer><button type="button" class="button" @click="clearConfirmation = false">{{ t.cancel }}</button><button type="button" class="button destructive" @click="clearKey = true; apiKey = ''; clearConfirmation = false">{{ t.clearKey }}</button></template></Modal>
</template>
