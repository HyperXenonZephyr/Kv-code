import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appSettingsSchema, type AppSettings } from "../shared/settings";
import {
  conversationCompactionRequestSchema,
  conversationIdSchema,
  conversationSchema,
  conversationWorkspaceSchema,
  type ConversationCompactionRequest,
  type Conversation,
} from "../shared/conversations";
import {
  chatStartRequestSchema,
  providerSaveInputSchema,
  type ChatEvent,
  type ChatStartRequest,
  type ProviderSaveInput,
} from "../shared/providers";
import { buildSystemPrompt } from "./agent-prompt";
import { ProviderStore } from "./provider-store";
import {
  compactProviderContext,
  publicProviderError,
  streamProviderResponse,
  testProviderConnection,
} from "./provider-runtime";
import { SettingsStore } from "./settings-store";
import { ConversationStore } from "./conversation-store";
import { listWorkspaceDirectory, readWorkspaceFile } from "./workspace-files";
import { workspaceRelativePathSchema } from "../shared/workspace-files";
import { watchWorkspace } from "./workspace-watcher";

let mainWindow: BrowserWindow | null = null;
let settingsStore: SettingsStore;
let providerStore: ProviderStore;
let conversationStore: ConversationStore;
let ultraPulseGeneration = 0;
const activeTurns = new Map<string, AbortController>();
const workspaceWatchers = new Map<number, () => void>();
const workspaceWatchGenerations = new Map<number, number>();
const workspaceWatcherSenders = new Set<number>();
const inlineDocuments = new Map<string, { document: string; senderId: number }>();
const inlineDocumentSenders = new Set<number>();
const inlineDocumentSchema = z.string().max(512 * 1024);

protocol.registerSchemesAsPrivileged([{
  scheme: "kv-inline",
  privileges: {
    secure: true,
    standard: true,
  },
}]);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#090b0d",
    icon: join(
      __dirname,
      process.platform === "win32"
        ? "../../resources/desktop-logo.ico"
        : "../../resources/desktop-logo.png",
    ),
    title: "KV Code",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    ultraPulseGeneration += 1;
    if (mainWindow === window) mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle("settings:read", () => settingsStore.read());
  ipcMain.handle("settings:update", async (_event, patch: Partial<AppSettings>) => {
    const validatedPatch = appSettingsSchema.partial().parse(patch);
    const settings = await settingsStore.update(validatedPatch);
    nativeTheme.themeSource = settings.theme;
    return settings;
  });
  ipcMain.handle("providers:list", () => providerStore.list());
  ipcMain.handle("providers:save", async (_event, input: ProviderSaveInput) =>
    providerStore.save(providerSaveInputSchema.parse(input)),
  );
  ipcMain.handle("providers:remove", async (_event, providerId: string) =>
    providerStore.remove(providerId),
  );
  ipcMain.handle("providers:test", async (_event, providerId: string) => {
    const provider = providerStore.get(providerId);
    return testProviderConnection(provider, providerStore.apiKey(providerId));
  });
  ipcMain.handle(
    "chat:start",
    (event, rawRequest: ChatStartRequest): { turnId: string } => {
      const request = chatStartRequestSchema.parse(rawRequest);
      if (activeTurns.has(request.turnId)) throw new Error("Turn is already active.");
      const provider = providerStore.get(request.providerId);
      const apiKey = providerStore.apiKey(request.providerId);
      const controller = new AbortController();
      activeTurns.set(request.turnId, controller);

      const send = (chatEvent: ChatEvent): void => {
        if (!event.sender.isDestroyed()) event.sender.send("chat:event", chatEvent);
      };
      void streamProviderResponse({
        provider,
        apiKey,
        reasoning: request.reasoning,
        systemPrompt: buildSystemPrompt(
          request.mode,
          request.reasoning,
          request.additionalInstructions,
        ),
        messages: request.messages,
        signal: controller.signal,
        onDelta: (text) => send({ type: "delta", turnId: request.turnId, text }),
      })
        .then(() => send({ type: "done", turnId: request.turnId }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            send({ type: "cancelled", turnId: request.turnId });
          } else {
            send({
              type: "error",
              turnId: request.turnId,
              message: publicProviderError(error),
            });
          }
        })
        .finally(() => activeTurns.delete(request.turnId));

      return { turnId: request.turnId };
    },
  );
  ipcMain.handle("chat:cancel", (_event, turnId: string) => {
    const controller = activeTurns.get(turnId);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipcMain.handle("conversations:list", (_event, workspace: string) =>
    conversationStore.list(conversationWorkspaceSchema.parse(workspace)),
  );
  ipcMain.handle(
    "conversations:read",
    (_event, workspace: string, conversationId: string) =>
      conversationStore.read(
        conversationWorkspaceSchema.parse(workspace),
        conversationIdSchema.parse(conversationId),
      ),
  );
  ipcMain.handle("conversations:save", (_event, conversation: Conversation) =>
    conversationStore.save(conversationSchema.parse(conversation)),
  );
  ipcMain.handle(
    "conversations:remove",
    (_event, workspace: string, conversationId: string) =>
      conversationStore.remove(
        conversationWorkspaceSchema.parse(workspace),
        conversationIdSchema.parse(conversationId),
      ),
  );
  ipcMain.handle(
    "conversations:compact",
    async (_event, rawRequest: ConversationCompactionRequest) => {
      const request = conversationCompactionRequestSchema.parse(rawRequest);
      const provider = providerStore.get(request.providerId);
      return compactProviderContext(
        provider,
        providerStore.apiKey(request.providerId),
        request.priorSummary,
        request.messages.map(({ role, content }) => ({ role, content })),
        AbortSignal.timeout(60_000),
      );
    },
  );
  ipcMain.handle(
    "workspace:list",
    (_event, workspace: string, path: string) =>
      listWorkspaceDirectory(
        conversationWorkspaceSchema.parse(workspace),
        workspaceRelativePathSchema.parse(path),
      ),
  );
  ipcMain.handle(
    "workspace:read-file",
    (_event, workspace: string, path: string) =>
      readWorkspaceFile(
        conversationWorkspaceSchema.parse(workspace),
        workspaceRelativePathSchema.parse(path),
      ),
  );
  ipcMain.handle("workspace:watch", async (event, workspace: string) => {
    const validatedWorkspace = conversationWorkspaceSchema.parse(workspace);
    const senderId = event.sender.id;
    const generation = (workspaceWatchGenerations.get(senderId) ?? 0) + 1;
    workspaceWatchGenerations.set(senderId, generation);
    workspaceWatchers.get(senderId)?.();
    workspaceWatchers.delete(senderId);

    const close = await watchWorkspace(validatedWorkspace, (change) => {
      if (!event.sender.isDestroyed()) event.sender.send("workspace:changed", change);
    });
    if (workspaceWatchGenerations.get(senderId) !== generation) {
      close();
      return;
    }
    workspaceWatchers.set(senderId, close);
    if (!workspaceWatcherSenders.has(senderId)) {
      workspaceWatcherSenders.add(senderId);
      event.sender.once("destroyed", () => {
        workspaceWatcherSenders.delete(senderId);
        stopWorkspaceWatcher(senderId);
      });
    }
  });
  ipcMain.handle("workspace:unwatch", (event) => {
    stopWorkspaceWatcher(event.sender.id);
  });
  ipcMain.handle("inline:register", (event, rawDocument: string) => {
    const document = inlineDocumentSchema.parse(rawDocument);
    const id = randomUUID();
    inlineDocuments.set(id, { document, senderId: event.sender.id });
    if (!inlineDocumentSenders.has(event.sender.id)) {
      inlineDocumentSenders.add(event.sender.id);
      event.sender.once("destroyed", () => removeInlineDocumentsForSender(event.sender.id));
    }
    return `kv-inline://artifact/${id}`;
  });
  ipcMain.handle("inline:remove", (event, rawUrl: string) => {
    const id = inlineDocumentId(rawUrl);
    const registered = id ? inlineDocuments.get(id) : undefined;
    if (id && registered?.senderId === event.sender.id) inlineDocuments.delete(id);
  });
  ipcMain.handle("system:choose-directory", async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("system:info", () => ({
    platform: process.platform,
    architecture: process.arch,
    homeDirectory: homedir(),
    appVersion: app.getVersion(),
  }));
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle("window:ultra-pulse", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? pulseUltraWindow(window) : false;
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

function registerInlineProtocol(): void {
  protocol.handle("kv-inline", (request) => {
    const id = inlineDocumentId(request.url);
    const registered = id ? inlineDocuments.get(id) : undefined;
    if (!registered) return new Response("Not found.", { status: 404 });
    return new Response(registered.document, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'",
        "referrer-policy": "no-referrer",
      },
    });
  });
}

function inlineDocumentId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "kv-inline:" || url.hostname !== "artifact") return null;
    return /^\/[0-9a-f-]{36}$/.test(url.pathname) ? url.pathname.slice(1) : null;
  } catch {
    return null;
  }
}

function removeInlineDocumentsForSender(senderId: number): void {
  inlineDocumentSenders.delete(senderId);
  for (const [id, registered] of inlineDocuments) {
    if (registered.senderId === senderId) inlineDocuments.delete(id);
  }
}

function stopWorkspaceWatcher(senderId: number): void {
  workspaceWatchGenerations.set(
    senderId,
    (workspaceWatchGenerations.get(senderId) ?? 0) + 1,
  );
  workspaceWatchers.get(senderId)?.();
  workspaceWatchers.delete(senderId);
}

function pulseUltraWindow(window: BrowserWindow): boolean {
  if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) {
    return false;
  }

  const generation = ultraPulseGeneration + 1;
  ultraPulseGeneration = generation;
  const origin = window.getBounds();
  const offsets = [
    [-10, 1],
    [9, -4],
    [-7, 5],
    [6, -3],
    [-4, 2],
    [3, -1],
    [0, 0],
  ] as const;

  offsets.forEach(([x, y], index) => {
    setTimeout(() => {
      if (
        generation !== ultraPulseGeneration ||
        window.isDestroyed() ||
        window.isMaximized() ||
        window.isFullScreen()
      ) {
        return;
      }
      window.setPosition(origin.x + x, origin.y + y, /*animate*/ false);
    }, index * 38);
  });

  return true;
}

void app.whenReady().then(async () => {
  app.setAppUserModelId("dev.kvcode.desktop");
  settingsStore = new SettingsStore();
  providerStore = new ProviderStore();
  conversationStore = new ConversationStore();
  const settings = await settingsStore.load();
  await providerStore.load();
  await conversationStore.load();
  nativeTheme.themeSource = settings.theme;
  registerInlineProtocol();
  registerIpc();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
