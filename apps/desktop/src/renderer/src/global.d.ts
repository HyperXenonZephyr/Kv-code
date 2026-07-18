import type { KvDesktopApi } from "../../shared/settings";

declare global {
  interface Window {
    kv?: KvDesktopApi;
  }
}

export {};

