import { randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import { spawn, type IPty } from "node-pty";
import type { TerminalEvent, TerminalSession } from "../shared/terminal";
import type { ToolTerminalBridge } from "./tool-runtime";

const OUTPUT_BUFFER_CHARACTERS = 2_000_000;

interface ManagedTerminal extends TerminalSession {
  process: IPty;
  output: string;
  exitPromise: Promise<void>;
  resolveExit(): void;
}

export class TerminalManager implements ToolTerminalBridge {
  readonly #sessions = new Map<string, ManagedTerminal>();

  constructor(private readonly emit: (event: TerminalEvent) => void) {}

  async create(workspace: string, requestedShell?: string): Promise<TerminalSession> {
    const cwd = workspace ? await realpath(workspace) : homedir();
    const shell = await resolveShell(requestedShell);
    const id = randomUUID();
    const process = spawn(shell.file, shell.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd,
      env: terminalEnvironment(),
      useConpty: processPlatformIsWindows(),
      useConptyDll: processPlatformIsWindows(),
    });
    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolvePromise) => { resolveExit = resolvePromise; });
    const session: ManagedTerminal = {
      id,
      title: basename(cwd) || "Terminal",
      workspace,
      cwd,
      shell: shell.file,
      running: true,
      createdAt: Date.now(),
      process,
      output: "",
      exitPromise,
      resolveExit,
    };
    this.#sessions.set(id, session);
    process.onData((data) => {
      session.output = boundedAppend(session.output, data);
      this.emit({ type: "data", terminalId: id, data });
    });
    process.onExit(({ exitCode }) => {
      session.running = false;
      session.resolveExit();
      this.emit({ type: "exit", terminalId: id, exitCode });
    });
    return publicSession(session);
  }

  async list(workspace = ""): Promise<TerminalSession[]> {
    return [...this.#sessions.values()]
      .filter((session) => !workspace || session.workspace === workspace)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(publicSession);
  }

  async write(id: string, data: string): Promise<void> {
    const session = this.require(id);
    if (!session.running) throw new Error("The terminal session has exited.");
    session.process.write(data);
  }

  async resize(id: string, columns: number, rows: number): Promise<void> {
    const session = this.require(id);
    if (session.running) session.process.resize(columns, rows);
  }

  async close(id: string): Promise<void> {
    const session = this.require(id);
    if (session.running) {
      session.process.kill();
      await Promise.race([
        session.exitPromise,
        new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 2_000)),
      ]);
    }
    this.#sessions.delete(id);
  }

  async read(id: string, maxCharacters = 200_000): Promise<{ id: string; output: string; truncated: boolean; running: boolean }> {
    const session = this.require(id);
    const start = Math.max(0, session.output.length - maxCharacters);
    return { id, output: session.output.slice(start), truncated: start > 0, running: session.running };
  }

  dispose(): void {
    for (const session of this.#sessions.values()) {
      if (session.running) session.process.kill();
    }
    this.#sessions.clear();
  }

  private require(id: string): ManagedTerminal {
    const session = this.#sessions.get(id);
    if (!session) throw new Error("Terminal session not found.");
    return session;
  }
}

async function resolveShell(requested?: string): Promise<{ file: string; args: string[] }> {
  if (requested) {
    await access(requested);
    return { file: requested, args: shellArgs(requested) };
  }
  if (processPlatformIsWindows()) {
    return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile"] };
  }
  const file = process.env.SHELL || "/bin/bash";
  return { file, args: ["-l"] };
}

function shellArgs(file: string): string[] {
  return /powershell|pwsh/i.test(file) ? ["-NoLogo", "-NoProfile"] : [];
}

function processPlatformIsWindows(): boolean {
  return process.platform === "win32";
}

function terminalEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") environment[key] = value;
  }
  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";
  return environment;
}

function boundedAppend(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= OUTPUT_BUFFER_CHARACTERS ? next : next.slice(next.length - OUTPUT_BUFFER_CHARACTERS);
}

function publicSession(session: ManagedTerminal): TerminalSession {
  const { process: _process, output: _output, exitPromise: _exitPromise, resolveExit: _resolveExit, ...summary } = session;
  return summary;
}
