import {
  ChevronRight,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Presentation,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceEntry } from "../../../shared/workspace-files";
import { useI18n } from "../i18n";
import { desktop } from "../lib/desktop";

export function WorkspaceTree({
  workspace,
  revision,
  onOpenFile,
}: {
  workspace: string;
  revision: number;
  onOpenFile(entry: WorkspaceEntry): void;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [manualRevision, setManualRevision] = useState(0);
  const previousWorkspace = useRef("");

  useEffect(() => {
    let active = true;
    const workspaceChanged = previousWorkspace.current !== workspace;
    previousWorkspace.current = workspace;
    if (!workspace) {
      setEntries({});
      setExpanded(new Set());
      setLoading(new Set());
      return () => { active = false; };
    }

    const directories = workspaceChanged ? [""] : ["", ...expanded];
    if (workspaceChanged) {
      setEntries({});
      setExpanded(new Set());
    }
    setLoading(new Set(directories));
    void Promise.all(directories.map(async (directory) => {
      try {
        return [directory, await desktop.listWorkspaceDirectory(workspace, directory)] as const;
      } catch {
        return [directory, null] as const;
      }
    })).then((loaded) => {
      if (!active) return;
      setEntries((current) => {
        const next = workspaceChanged ? {} : { ...current };
        for (const [directory, children] of loaded) {
          if (children) next[directory] = children;
          else delete next[directory];
        }
        return next;
      });
      setLoading(new Set());
    });
    return () => { active = false; };
  }, [manualRevision, revision, workspace]);

  const toggleDirectory = async (path: string) => {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(path));
    if (entries[path]) return;
    setLoading((current) => new Set(current).add(path));
    try {
      const children = await desktop.listWorkspaceDirectory(workspace, path);
      setEntries((current) => ({ ...current, [path]: children }));
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  };

  if (!workspace) {
    return (
      <div className="session-empty workspace-tree-empty">
        <Folder size={20} />
        <strong>{t("workbench.noWorkspace")}</strong>
      </div>
    );
  }

  return (
    <div className="workspace-tree">
      <div className="workspace-tree-toolbar">
        <span>{workspace.split(/[\\/]/).filter(Boolean).at(-1)}</span>
        <button title={t("workbench.refreshFiles")} onClick={() => setManualRevision((value) => value + 1)}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="workspace-tree-scroll" role="tree">
        {loading.has("") && <span className="workspace-tree-loading">LOADING</span>}
        <TreeLevel
          directory=""
          depth={0}
          entries={entries}
          expanded={expanded}
          loading={loading}
          onOpenFile={onOpenFile}
          onToggleDirectory={(path) => void toggleDirectory(path)}
        />
      </div>
    </div>
  );
}

function TreeLevel({
  directory,
  depth,
  entries,
  expanded,
  loading,
  onOpenFile,
  onToggleDirectory,
}: {
  directory: string;
  depth: number;
  entries: Record<string, WorkspaceEntry[]>;
  expanded: Set<string>;
  loading: Set<string>;
  onOpenFile(entry: WorkspaceEntry): void;
  onToggleDirectory(path: string): void;
}) {
  return entries[directory]?.map((entry) => {
    const isDirectory = entry.kind === "directory";
    const isExpanded = isDirectory && expanded.has(entry.path);
    const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : fileIcon(entry.extension);
    return (
      <div key={entry.path} role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
        <button
          className={`workspace-tree-entry ${entry.kind}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          title={entry.path}
          onClick={() => isDirectory ? onToggleDirectory(entry.path) : onOpenFile(entry)}
        >
          {isDirectory ? <ChevronRight className={isExpanded ? "expanded" : ""} size={12} /> : <i />}
          <Icon size={14} />
          <span>{entry.name}</span>
          {loading.has(entry.path) && <RefreshCw className="spin" size={11} />}
        </button>
        {isExpanded && (
          <TreeLevel
            directory={entry.path}
            depth={depth + 1}
            entries={entries}
            expanded={expanded}
            loading={loading}
            onOpenFile={onOpenFile}
            onToggleDirectory={onToggleDirectory}
          />
        )}
      </div>
    );
  }) ?? null;
}

function fileIcon(extension: string) {
  if (extension === "docx") return FileText;
  if (extension === "xlsx") return FileSpreadsheet;
  if (extension === "pptx") return Presentation;
  return File;
}
