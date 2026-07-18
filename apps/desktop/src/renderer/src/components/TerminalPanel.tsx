import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminalSession } from "../../../shared/terminal";
import { desktop } from "../lib/desktop";
import { useI18n } from "../i18n";

export function TerminalPanel({ workspace, onClose }: { workspace: string; onClose(): void }) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef("");

  useEffect(() => {
    let mounted = true;
    setBusy(true);
    void desktop.listTerminals(workspace)
      .then(async (existing) => {
        if (!mounted) return;
        let next = existing;
        if (!next.length) next = [await desktop.createTerminal({ workspace })];
        if (!mounted) return;
        setSessions(next);
        setActiveId(next[0]?.id ?? "");
      })
      .finally(() => mounted && setBusy(false));
    return () => { mounted = false; };
  }, [workspace]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const element = host.current;
    if (!element || !activeId) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: {
        background: "#07090b",
        foreground: "#d6dcdf",
        cursor: "#82e9f5",
        selectionBackground: "#24484f",
        black: "#101417",
        brightBlack: "#657078",
        red: "#ff6f79",
        brightRed: "#ff8891",
        green: "#a8e063",
        brightGreen: "#c2f27e",
        yellow: "#e5c76b",
        brightYellow: "#f2d987",
        blue: "#65b9e8",
        brightBlue: "#84cdf4",
        magenta: "#bf8cff",
        brightMagenta: "#d0a8ff",
        cyan: "#72dce8",
        brightCyan: "#96edf5",
        white: "#d5dadd",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const resize = () => {
      try {
        fit.fit();
        void desktop.resizeTerminal({ terminalId: activeId, columns: terminal.cols, rows: terminal.rows });
      } catch { /* the panel may be transitioning */ }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const dataSubscription = terminal.onData((data) => {
      void desktop.writeTerminal({ terminalId: activeId, data });
    });
    const unsubscribe = desktop.onTerminalEvent((event) => {
      if (event.terminalId !== activeIdRef.current) return;
      if (event.type === "data") terminal.write(event.data);
      else {
        terminal.write(`\r\n\x1b[90m[process exited with code ${event.exitCode}]\x1b[0m\r\n`);
        setSessions((current) => current.map((session) => session.id === event.terminalId ? { ...session, running: false } : session));
      }
    });
    void desktop.readTerminal({ terminalId: activeId, maxCharacters: 1_000_000 })
      .then((snapshot) => {
        if (snapshot.truncated) terminal.write("\x1b[90m[earlier terminal output omitted]\x1b[0m\r\n");
        terminal.write(snapshot.output);
        requestAnimationFrame(resize);
        terminal.focus();
      });
    return () => {
      unsubscribe();
      dataSubscription.dispose();
      observer.disconnect();
      terminal.dispose();
    };
  }, [activeId]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await desktop.createTerminal({ workspace });
      setSessions((current) => [...current, session]);
      setActiveId(session.id);
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (terminalId: string) => {
    await desktop.closeTerminal(terminalId);
    setSessions((current) => {
      const next = current.filter((session) => session.id !== terminalId);
      if (activeId === terminalId) setActiveId(next[0]?.id ?? "");
      return next;
    });
  };

  return (
    <section className="terminal-panel">
      <header>
        <div className="terminal-tabs">
          {sessions.map((session, index) => (
            <button
              className={session.id === activeId ? "active" : ""}
              key={session.id}
              onClick={() => setActiveId(session.id)}
            >
              <TerminalSquare size={13} />
              <span>{session.title} {index + 1}</span>
              {!session.running && <i />}
              <X
                aria-label={t("terminal.closeSession")}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeSession(session.id);
                }}
                size={12}
              />
            </button>
          ))}
          <button className="terminal-new" disabled={busy} title={t("terminal.new")} onClick={() => void create()}>
            <Plus size={13} />
          </button>
        </div>
        <button className="terminal-panel-close" title={t("terminal.closePanel")} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="terminal-host" ref={host} />
    </section>
  );
}

export default TerminalPanel;
