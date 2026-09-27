CREATE TABLE IF NOT EXISTS vibecli_ai_settings (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    document JSONB NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);
