import { watch, type FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceChange } from "../shared/workspace-files";

const CHANGE_DEBOUNCE_MS = 120;

export async function watchWorkspace(
  workspace: string,
  onChange: (change: WorkspaceChange) => void,
): Promise<() => void> {
  const root = await realpath(resolve(workspace));
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let watcher: FSWatcher;

  watcher = watch(root, { recursive: true }, (eventType, filename) => {
    const path = normalizeChangedPath(root, filename?.toString() ?? "");
    if (path === null) return;
    const previous = pending.get(path);
    if (previous) clearTimeout(previous);
    pending.set(path, setTimeout(() => {
      pending.delete(path);
      void pathExists(resolve(root, path || "."))
        .then((exists) => onChange({ workspace, path, eventType, exists }))
        .catch((error: unknown) => {
          console.error("Could not inspect a changed workspace path.", error);
        });
    }, CHANGE_DEBOUNCE_MS));
  });

  watcher.on("error", (error) => {
    console.error("Workspace file watcher failed.", error);
  });

  return () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    watcher.close();
  };
}

function normalizeChangedPath(root: string, filename: string): string | null {
  if (!filename) return "";
  const target = resolve(root, filename);
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  return pathFromRoot.split(sep).join("/");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
    }
    throw error;
  }
}
