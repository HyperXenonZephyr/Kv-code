import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceEntry, WorkspaceFile } from "../shared/workspace-files";

const MAX_PREVIEW_BYTES = 256 * 1024 * 1024;

export async function listWorkspaceDirectory(
  workspace: string,
  relativeDirectory: string,
): Promise<WorkspaceEntry[]> {
  const { root, target } = await resolveWithinWorkspace(workspace, relativeDirectory);
  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => {
      const path = toRelativePath(relative(root, resolve(target, entry.name)));
      return {
        name: entry.name,
        path,
        kind: entry.isDirectory() ? "directory" as const : "file" as const,
        extension: entry.isFile() ? extname(entry.name).slice(1).toLowerCase() : "",
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { numeric: true });
    });
}

export async function readWorkspaceFile(
  workspace: string,
  relativePath: string,
): Promise<WorkspaceFile> {
  const { target } = await resolveWithinWorkspace(workspace, relativePath);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("Workspace path is not a file.");
  if (metadata.size > MAX_PREVIEW_BYTES) {
    throw new Error("Document is too large for the built-in previewer.");
  }
  const data = await readFile(target);
  return {
    name: relativePath.split("/").at(-1) ?? relativePath,
    path: relativePath,
    extension: extname(relativePath).slice(1).toLowerCase(),
    data,
  };
}

async function resolveWithinWorkspace(
  workspace: string,
  relativePath: string,
): Promise<{ root: string; target: string }> {
  if (!workspace) throw new Error("Open a workspace first.");
  if (isAbsolute(relativePath)) throw new Error("Workspace paths must be relative.");
  const root = await realpath(resolve(workspace));
  const candidate = resolve(root, relativePath || ".");
  const target = await realpath(candidate);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error("Workspace path escapes the current workspace.");
  }
  return { root, target };
}

function toRelativePath(path: string): string {
  return path.split(sep).join("/");
}
