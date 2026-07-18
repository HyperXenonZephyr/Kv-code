import { z } from "zod";
import { conversationWorkspaceSchema } from "./conversations";

export const terminalIdSchema = z.string().uuid();

export const terminalSessionSchema = z.object({
  id: terminalIdSchema,
  title: z.string().max(120),
  workspace: conversationWorkspaceSchema,
  cwd: z.string().max(4_096),
  shell: z.string().max(1_024),
  running: z.boolean(),
  createdAt: z.number().int().nonnegative(),
});

export const terminalCreateRequestSchema = z.object({
  workspace: conversationWorkspaceSchema,
  shell: z.string().max(1_024).optional(),
});

export const terminalResizeRequestSchema = z.object({
  terminalId: terminalIdSchema,
  columns: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
});

export const terminalWriteRequestSchema = z.object({
  terminalId: terminalIdSchema,
  data: z.string().max(256_000),
});

export const terminalReadRequestSchema = z.object({
  terminalId: terminalIdSchema,
  maxCharacters: z.number().int().min(1).max(1_000_000).optional(),
});

export const terminalEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("data"),
    terminalId: terminalIdSchema,
    data: z.string(),
  }),
  z.object({
    type: z.literal("exit"),
    terminalId: terminalIdSchema,
    exitCode: z.number().int(),
  }),
]);

export type TerminalSession = z.infer<typeof terminalSessionSchema>;
export type TerminalCreateRequest = z.infer<typeof terminalCreateRequestSchema>;
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;
export type TerminalWriteRequest = z.infer<typeof terminalWriteRequestSchema>;
export type TerminalReadRequest = z.infer<typeof terminalReadRequestSchema>;
export type TerminalEvent = z.infer<typeof terminalEventSchema>;
