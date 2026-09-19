/** Generate a launch command for the standard Claude CLI, without embedding a key. */
export function claudeCommand(profile: string, model: string, effort: string, consoleUrl: string): string {
  const origin = new URL(consoleUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid console URL');
  if (!/^[a-zA-Z0-9-]+$/.test(profile)) throw new Error('Invalid subscription ID');
  if (!/^claude-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid model ID');
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'].includes(effort)) throw new Error('Invalid effort');
  const selected = `${model}[1m]`;
  return [
    `ANTHROPIC_BASE_URL='${origin.origin}/inference/${profile}' \\`,
    'ANTHROPIC_AUTH_TOKEN="${CLIPROXY_API_KEY:?Set CLIPROXY_API_KEY to a proxy client key first}" \\',
    ...['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'].map(key => `${key}='${selected}' \\`),
    `command claude --model '${selected}' --effort '${effort}'`,
  ].join('\n');
}
