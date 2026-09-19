export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = typeof EFFORTS[number];
export interface ClaudeModelOption {
  id: string;
  label: string;
  contextWindow: 1_000_000;
  maxEffort: Effort;
}
export const DEFAULT_CLAUDE_MODELS: ClaudeModelOption[] = [
  {id: 'claude-opus-5', label: 'Claude Opus 5', contextWindow: 1_000_000, maxEffort: 'max'},
  {id: 'claude-fable-5-1', label: 'Claude Fable 5.1', contextWindow: 1_000_000, maxEffort: 'max'},
];
export function validateClaudeModels(value: unknown): ClaudeModelOption[] {
  const fail = (message: string): never => { throw Object.assign(new Error(message), {status: 400}); };
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) fail('Configure between 1 and 50 Claude models');
  const ids = new Set<string>();
  return (value as unknown[]).map(entry => {
    if (!entry || typeof entry !== 'object') fail('Invalid Claude model');
    const model = entry as Record<string, unknown>;
    if (typeof model.id !== 'string' || !/^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(model.id) || ids.has(model.id)) fail('Use unique official Claude model IDs without account prefixes or context suffixes');
    if (typeof model.label !== 'string' || !model.label.trim() || model.label.trim().length > 100) fail('Model labels must contain 1–100 characters');
    if (model.contextWindow !== 1_000_000) fail('Only 1M-context models are allowed');
    if (!EFFORTS.includes(model.maxEffort as Effort)) fail('Invalid model effort cap');
    ids.add(model.id as string);
    return {id: model.id as string, label: (model.label as string).trim(), contextWindow: 1_000_000, maxEffort: model.maxEffort as Effort};
  });
}
