CREATE TABLE IF NOT EXISTS vibecli_projects (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    id UUID NOT NULL,
    updated_at TEXT NOT NULL,
    document JSONB NOT NULL,
    PRIMARY KEY (tenant_id, user_id, id)
);
