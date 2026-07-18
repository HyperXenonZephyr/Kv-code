import { z } from "zod";

export const workspaceRelativePathSchema = z.string().max(4_096);

export const workspaceEntrySchema = z.object({
  name: z.string().min(1).max(512),
  path: workspaceRelativePathSchema,
  kind: z.enum(["directory", "file"]),
  extension: z.string().max(32),
});

export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>;

export const workspaceChangeSchema = z.object({
  workspace: z.string().max(4_096),
  path: workspaceRelativePathSchema,
  eventType: z.enum(["change", "rename"]),
  exists: z.boolean(),
});

export type WorkspaceChange = z.infer<typeof workspaceChangeSchema>;

export interface WorkspaceFile {
  name: string;
  path: string;
  extension: string;
  data: Uint8Array;
}
