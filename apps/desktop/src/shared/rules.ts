import { z } from "zod";

export const rulesScopeSchema = z.enum(["global", "project"]);
export const rulesLoadStatusSchema = z.enum(["loaded", "missing", "unavailable", "error"]);

export const rulesDocumentSchema = z.object({
  scope: rulesScopeSchema,
  path: z.string().max(4_096),
  content: z.string().max(16_000),
  exists: z.boolean(),
  updatedAt: z.number().int().nonnegative().nullable(),
  loadStatus: rulesLoadStatusSchema,
  error: z.string().max(500).optional(),
});

export const rulesSnapshotSchema = z.object({
  global: rulesDocumentSchema,
  project: rulesDocumentSchema,
  resolvedContent: z.string().max(32_000),
});

export const rulesReadRequestSchema = z.object({
  workspace: z.string().max(4_096),
});

export const rulesSaveRequestSchema = z.object({
  workspace: z.string().max(4_096),
  scope: rulesScopeSchema,
  content: z.string().max(16_000),
});

export type RulesScope = z.infer<typeof rulesScopeSchema>;
export type RulesLoadStatus = z.infer<typeof rulesLoadStatusSchema>;
export type RulesDocument = z.infer<typeof rulesDocumentSchema>;
export type RulesSnapshot = z.infer<typeof rulesSnapshotSchema>;
export type RulesReadRequest = z.infer<typeof rulesReadRequestSchema>;
export type RulesSaveRequest = z.infer<typeof rulesSaveRequestSchema>;
