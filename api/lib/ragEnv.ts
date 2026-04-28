export type ServiceAccountJSON = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri: string;
};

export function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getOptionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function parseServiceAccountFromEnv(): ServiceAccountJSON {
  const raw = mustGetEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  // Supports either raw JSON or base64 JSON (safer for env var storage).
  const jsonText =
    raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(jsonText) as ServiceAccountJSON;
  if (!parsed?.client_email || !parsed?.private_key || !parsed?.token_uri) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields");
  }
  return parsed;
}

