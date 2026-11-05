import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_FILE, parseConfig, unknownRuleIds } from './core/config';
import type { TeamConfig } from './core/config';

export interface LoadedConfig {
  config: TeamConfig;
  /** Things worth telling the user that do not stop the audit, such as a misspelled rule id. */
  warnings: string[];
}

/** Reads `.diffauditor.json` from the repository root. A missing file is an empty config. */
export async function loadConfig(root: string): Promise<LoadedConfig> {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) {
    return { config: {}, warnings: [] };
  }
  const config = parseConfig(await readFile(file, 'utf8'));
  const unknown = unknownRuleIds(config.ignoreRules);
  const warnings = unknown.map((id) => `${CONFIG_FILE}: "${id}" in ignoreRules is not a rule id.`);
  return { config, warnings };
}
