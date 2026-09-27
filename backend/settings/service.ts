import type { Scope } from '../hosting/authentication';
import { configuration, type Configuration } from '../hosting/configuration';
import { secretCipher, type SecretCipher } from './cryptography';
import { settingsStore, type SettingsStore } from './store';
import { settingsRequest, validateEndpoint, type SettingsDraft, type SettingsRecord, type SettingsView } from './model';

export class SettingsService {
  constructor(private readonly config: Configuration, private readonly storage: SettingsStore,
    private readonly cipher: () => Promise<SecretCipher> = () => secretCipher(config)) {}

  private view(record?: SettingsRecord): SettingsView {
    const endpoint = record?.endpoint || this.config.aiEndpoint || (this.config.hosted ? this.config.allowedEndpoints[0] : '') || '';
    const model = record?.model || this.config.aiModel || '';
    return {
      endpoint, model, protocol: record?.protocol || this.config.aiProtocol,
      has_key: record ? Boolean(record.ciphertext) : Boolean(this.config.aiKey),
      allowed_endpoints: [...this.config.allowedEndpoints], configured: Boolean(endpoint && model),
    };
  }
  async read(scope: Scope): Promise<SettingsView> { return this.view(await this.storage.get(scope)); }

  async save(scope: Scope, raw: SettingsDraft): Promise<SettingsView> {
    const draft = settingsRequest.parse(raw);
    const endpoint = validateEndpoint(draft.endpoint, this.config);
    const updated = await this.storage.update(scope, async current => {
      let ciphertext = current?.ciphertext || null;
      const secret = draft.api_key?.trim();
      if (draft.clear_key) { ciphertext = null; }
      else if (secret) { ciphertext = await (await this.cipher()).seal(scope, secret); }
      else if (!current && this.config.aiKey) { ciphertext = await (await this.cipher()).seal(scope, this.config.aiKey); }
      return { endpoint, model: draft.model, protocol: draft.protocol, ciphertext };
    });
    return this.view(updated);
  }

  async modelConfiguration(scope: Scope): Promise<Configuration> {
    const record = await this.storage.get(scope);
    if (!record) {
      return { ...this.config, aiEndpoint: this.config.aiEndpoint || (this.config.hosted ? this.config.allowedEndpoints[0] : undefined) };
    }
    const aiKey = record.ciphertext ? await (await this.cipher()).open(scope, record.ciphertext) : undefined;
    return { ...this.config, aiEndpoint: record.endpoint, aiModel: record.model, aiProtocol: record.protocol, aiKey };
  }
}

let singleton: SettingsService | undefined;
export function settings(): SettingsService {
  singleton ||= new SettingsService(configuration(), settingsStore());
  return singleton;
}
