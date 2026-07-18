import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  providerConfigSchema,
  providerSaveInputSchema,
  type ProviderConfig,
  type ProviderSaveInput,
  type ProviderSummary,
} from "../shared/providers";

const profilesSchema = z.array(providerConfigSchema).max(50);
const secretsSchema = z.record(z.string(), z.string());

export class ProviderStore {
  readonly #profilesPath: string;
  readonly #secretsPath: string;
  #profiles: ProviderConfig[] = [];
  #secrets: Record<string, string> = {};
  #writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    const userData = app.getPath("userData");
    this.#profilesPath = join(userData, "providers.json");
    this.#secretsPath = join(userData, "provider-secrets.json");
  }

  async load(): Promise<void> {
    this.#profiles = await readJson(this.#profilesPath, profilesSchema, []);
    this.#secrets = await readJson(this.#secretsPath, secretsSchema, {});
  }

  list(): ProviderSummary[] {
    return this.#profiles.map((profile) => ({
      ...profile,
      hasApiKey: Boolean(this.#secrets[profile.id]),
    }));
  }

  get(providerId: string): ProviderConfig {
    const provider = this.#profiles.find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error("Provider not found.");
    return provider;
  }

  apiKey(providerId: string): string {
    const encrypted = this.#secrets[providerId];
    if (!encrypted) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this system.");
    }
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(rawInput: ProviderSaveInput): Promise<ProviderSummary[]> {
    const input = providerSaveInputSchema.parse(rawInput);
    const { apiKey, ...profile } = input;
    const index = this.#profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index === -1) this.#profiles.push(profile);
    else this.#profiles[index] = profile;

    const trimmedApiKey = apiKey?.trim();
    if (trimmedApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure credential storage is unavailable on this system.");
      }
      this.#secrets[profile.id] = safeStorage
        .encryptString(trimmedApiKey)
        .toString("base64");
    }

    await this.#persist();
    return this.list();
  }

  async remove(providerId: string): Promise<ProviderSummary[]> {
    this.#profiles = this.#profiles.filter((provider) => provider.id !== providerId);
    delete this.#secrets[providerId];
    await this.#persist();
    return this.list();
  }

  async #persist(): Promise<void> {
    const write = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeJson(this.#profilesPath, this.#profiles);
        await writeJson(this.#secretsPath, this.#secrets);
      });
    this.#writeQueue = write;
    await write;
  }
}

async function readJson<T>(
  path: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (!isMissingFile(error)) console.error(`Failed to load ${path}.`, error);
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
