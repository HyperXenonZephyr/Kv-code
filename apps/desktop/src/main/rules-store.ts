import { app } from "electron";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import {
  rulesSaveRequestSchema,
  rulesSnapshotSchema,
  type RulesDocument,
  type RulesSaveRequest,
  type RulesScope,
  type RulesSnapshot,
} from "../shared/rules";

const MAX_RULE_BYTES = 16_000;
const GLOBAL_RULES_FILE = "rules/global.md";
const PROJECT_RULES_FILE = ".kv-code/rules.md";

export class RulesStore {
  readonly #globalPath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.#globalPath = join(app.getPath("userData"), GLOBAL_RULES_FILE);
  }

  async load(): Promise<void> {
    await mkdir(dirname(this.#globalPath), { recursive: true });
  }

  async read(workspace: string): Promise<RulesSnapshot> {
    const project = workspace.trim()
      ? await this.#projectPath(workspace, false).then(
          (path) => this.#readDocument("project", path),
          (error: unknown) => unavailableDocument("project", PROJECT_RULES_FILE, error),
        )
      : unavailableDocument("project", PROJECT_RULES_FILE);
    const global = await this.#readDocument("global", this.#globalPath);
    return rulesSnapshotSchema.parse({
      global,
      project,
      resolvedContent: composeResolvedRules(global, project),
    });
  }

  async save(rawRequest: RulesSaveRequest): Promise<RulesSnapshot> {
    const request = rulesSaveRequestSchema.parse(rawRequest);
    const path = request.scope === "global"
      ? this.#globalPath
      : await this.#projectPath(request.workspace, true);
    const content = request.content.replace(/^\uFEFF/, "");
    await this.#enqueue(async () => {
      if (!content.trim()) {
        await unlinkIfPresent(path);
      } else {
        await mkdir(dirname(path), { recursive: true });
        const temporaryPath = `${path}.tmp`;
        await writeText(temporaryPath, content);
        await rename(temporaryPath, path);
      }
      if (request.scope === "project") await protectProjectRulesFromGit(request.workspace);
    });
    return this.read(request.workspace);
  }

  async #projectPath(workspace: string, create: boolean): Promise<string> {
    if (!workspace.trim()) throw new Error("Open a workspace before editing project rules.");
    const root = await realpath(resolve(workspace));
    const directory = join(root, ".kv-code");
    const realDirectory = create ? await mkdirAndRealpath(directory) : await realpath(directory);
    const pathFromRoot = relative(root, realDirectory);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
      throw new Error("Project rules directory escapes the workspace.");
    }
    return join(realDirectory, "rules.md");
  }

  async #readDocument(scope: RulesScope, path: string): Promise<RulesDocument> {
    try {
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new Error("Rules path is not a file.");
      if (metadata.size > MAX_RULE_BYTES) {
        throw new Error("Rules file exceeds the 16,000 character limit.");
      }
      return {
        scope,
        path,
        content: (await readFile(path, "utf8")).replace(/^\uFEFF/, ""),
        exists: true,
        updatedAt: Math.trunc(metadata.mtimeMs),
        loadStatus: "loaded",
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return {
          scope,
          path,
          content: "",
          exists: false,
          updatedAt: null,
          loadStatus: "missing",
        };
      }
      return unavailableDocument(scope, path, error, "error");
    }
  }

  async #enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.catch(() => undefined).then(write);
    this.#writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function composeResolvedRules(global: RulesDocument, project: RulesDocument): string {
  const sections: string[] = [];
  if (global.content.trim()) {
    sections.push(`<global_rules source="${global.path}">\n${global.content.trim()}\n</global_rules>`);
  }
  if (project.content.trim()) {
    sections.push(`<project_rules source="${project.path}">\n${project.content.trim()}\n</project_rules>`);
  }
  return sections.join("\n\n").slice(0, 32_000);
}

function unavailableDocument(
  scope: RulesScope,
  path: string,
  error?: unknown,
  status: "unavailable" | "error" = "unavailable",
): RulesDocument {
  return {
    scope,
    path,
    content: "",
    exists: false,
    updatedAt: null,
    loadStatus: status,
    ...(error ? { error: publicRulesError(error) } : {}),
  };
}

async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, `${content}\n`, "utf8");
}

async function mkdirAndRealpath(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return realpath(path);
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function protectProjectRulesFromGit(workspace: string): Promise<void> {
  const root = await realpath(resolve(workspace));
  const gitPath = join(root, ".git");
  let gitDirectory = gitPath;
  try {
    const metadata = await stat(gitPath);
    if (metadata.isFile()) {
      const pointer = (await readFile(gitPath, "utf8")).match(/^gitdir:\s*(.+)$/im)?.[1]?.trim();
      if (!pointer) return;
      gitDirectory = resolve(root, pointer);
    } else if (!metadata.isDirectory()) {
      return;
    }
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }

  const excludePath = join(gitDirectory, "info", "exclude");
  let contents = "";
  try {
    contents = await readFile(excludePath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  if (contents.split(/\r?\n/).some((line) => line.trim() === ".kv-code/")) return;
  await mkdir(dirname(excludePath), { recursive: true });
  const suffix = contents.endsWith("\n") || !contents ? "" : "\n";
  await writeFile(excludePath, `${contents}${suffix}# KV Code local project rules\n.kv-code/\n`, "utf8");
}

function publicRulesError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Rules could not be loaded.";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export const rulesConstants = { MAX_RULE_BYTES, GLOBAL_RULES_FILE, PROJECT_RULES_FILE } as const;
