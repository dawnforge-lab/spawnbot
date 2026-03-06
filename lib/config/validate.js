export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  // Required: SOUL.yaml loaded
  if (!config.soul) {
    errors.push('config/SOUL.yaml not found or failed to parse');
  } else {
    if (!config.soul.identity?.name) errors.push('SOUL.yaml: identity.name is required');
    // Support both old (flat personality) and new (personality.traits) schemas
    if (!config.soul.personality || !config.soul.personality?.traits) {
      warnings.push('SOUL.yaml: no personality section (agent will use defaults)');
    }
  }

  // Telegram (core)
  if (!config.telegram.botToken) {
    warnings.push('TELEGRAM_BOT_TOKEN not set (Telegram integration disabled)');
  }
  if (!config.telegram.chatId) {
    warnings.push('TELEGRAM_CHAT_ID not set (Telegram input adapter disabled)');
  }

  // Kimi CLI
  if (!config.kimi.command) {
    errors.push('Kimi CLI path not configured (set KIMI_CLI_PATH or ensure "kimi" is in PATH)');
  }

  // Safeword
  if (!config.safeword) {
    warnings.push('No safeword configured (safety feature disabled)');
  }

  // Integrations
  const activeIntegrations = Object.entries(config.integrations)
    .filter(([, v]) => v.enabled);
  if (activeIntegrations.length > 0) {
    for (const [name, integration] of activeIntegrations) {
      if (!integration.poll_interval && !integration.pollInterval) {
        warnings.push(`Integration "${name}": no poll_interval set, using default`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
