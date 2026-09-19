/** Generate a launch command for the standard Claude CLI, without embedding a key. */
export function claudeCommand(profile: string, model: string, effort: string, consoleUrl: string, configDir?: string): string {
  const origin = new URL(consoleUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid console URL');
  if (!/^[a-zA-Z0-9-]+$/.test(profile)) throw new Error('Invalid subscription ID');
  if (!/^claude-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid model ID');
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'].includes(effort)) throw new Error('Invalid effort');
  if (configDir !== undefined && (!configDir.startsWith('/') || /[\r\n\0]/.test(configDir))) throw new Error('Invalid Claude configuration directory');
  const selected = `${model}[1m]`;
  return [
    ...(configDir ? [`CLAUDE_CONFIG_DIR='${configDir.replace(/'/g, "'\\''")}' \\`] : []),
    `ANTHROPIC_BASE_URL='${origin.origin}/inference/${profile}' \\`,
    'ANTHROPIC_AUTH_TOKEN="${CLIPROXY_API_KEY:?Set CLIPROXY_API_KEY to a proxy client key first}" \\',
    'CLAUDE_CODE_DISABLE_1M_CONTEXT=0 \\',
    ...['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'].map(key => `${key}='${selected}' \\`),
    `command claude --model '${selected}' --effort '${effort}'`,
  ].join('\n');
}
