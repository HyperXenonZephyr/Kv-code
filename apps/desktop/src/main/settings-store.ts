import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  appSettingsSchema,
  defaultSettings,
  type AppSettings,
} from "../shared/settings";

const SETTINGS_FILE = "desktop-settings.json";

export class SettingsStore {
  readonly #path: string;
  #settings: AppSettings = defaultSettings;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.#path = join(app.getPath("userData"), SETTINGS_FILE);
  }

  async load(): Promise<AppSettings> {
    try {
      const contents = await readFile(this.#path, "utf8");
      this.#settings = appSettingsSchema.parse({
        ...defaultSettings,
        ...JSON.parse(contents),
      });
    } catch (error) {
      if (!isMissingFile(error)) {
        console.error("Failed to load desktop settings; using defaults.", error);
      }
      this.#settings = defaultSettings;
    }
    return this.#settings;
  }

  read(): AppSettings {
    return this.#settings;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = appSettingsSchema.parse({ ...this.#settings, ...patch });
    this.#settings = next;
    const write = this.#writeQueue
      .catch(() => undefined)
      .then(() => this.#write(next));
    this.#writeQueue = write;
    await write;
    return next;
  }

  async #write(settings: AppSettings): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#path);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
