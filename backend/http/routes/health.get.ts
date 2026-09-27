import { defineEventHandler } from 'h3';
import { store } from '../../projects/store';
import { settingsStore } from '../../settings/store';
export default defineEventHandler(async () => {
  await store().ready();
  await settingsStore().ready();
  return { ok: true };
});
