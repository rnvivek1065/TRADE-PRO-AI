function decodeBase64Url(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function getLiveRatesKey(env) {
  // Temporary compatibility with an existing Cloudflare secret.
  if (env.LIVE_RATES_API_KEY) {
    return env.LIVE_RATES_API_KEY;
  }

  if (!env.DB || !env.MASTER_ENCRYPTION_KEY) {
    throw new Error("Secure API storage is not configured.");
  }

  const row = await env.DB.prepare(
    "SELECT encrypted_value FROM app_settings WHERE setting_name = ?"
  ).bind("live_rates_api_key").first();

  if (!row?.encrypted_value) {
    throw new Error("Live-Rates API key has not been saved.");
  }

  const parts = row.encrypted_value.split(".");

  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted API key format.");
  }

  const masterKey = decodeBase64Url(env.MASTER_ENCRYPTION_KEY);

  if (masterKey.length !== 32) {
    throw new Error("Invalid encryption key.");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    masterKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
