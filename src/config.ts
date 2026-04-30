import fs from 'fs/promises';
import path from 'path';
import { CONFIG_FILE, checkFileExists } from './utils.js';

/**
 * Represents a single repository entry in the configuration.
 */
export interface RepoEntry {
  /** The remote Git URL */
  url: string;
  /** A short display name (derived from the URL) */
  name: string;
  /** The default branch detected (main or master) */
  defaultBranch: string;
  /** The currently active branch (profile) */
  currentBranch: string;
  /** The currently checked-out commit hash (version) */
  currentVersion: string;
}

/**
 * The root configuration stored in .ai-config.json
 */
export interface AiConfig {
  /** List of configured repositories */
  repositories: RepoEntry[];
  /** Index of the currently selected repository (-1 if none) */
  selectedRepoIndex: number;
}

/**
 * Extract a short display name from a Git URL.
 * e.g. "https://github.com/user/my-repo.git" -> "my-repo"
 */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * Read the configuration file, returning null if it doesn't exist.
 */
export async function readConfig(cwd: string): Promise<AiConfig | null> {
  const configPath = path.join(cwd, CONFIG_FILE);
  if (!(await checkFileExists(configPath))) {
    return null;
  }

  const content = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(content);

  // Migration: if old format (has 'repo' field), convert to new format
  if (parsed.repo && !parsed.repositories) {
    const migrated: AiConfig = {
      repositories: [
        {
          url: parsed.repo,
          name: repoNameFromUrl(parsed.repo),
          defaultBranch: parsed.branch || 'main',
          currentBranch: parsed.branch || 'main',
          currentVersion: parsed.version || 'latest',
        },
      ],
      selectedRepoIndex: 0,
    };
    await writeConfig(cwd, migrated);
    return migrated;
  }

  return parsed as AiConfig;
}

/**
 * Write the configuration to disk.
 */
export async function writeConfig(cwd: string, config: AiConfig): Promise<void> {
  const configPath = path.join(cwd, CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Get the currently selected repository entry, or null if none selected.
 */
export function getSelectedRepo(config: AiConfig): RepoEntry | null {
  if (config.selectedRepoIndex < 0 || config.selectedRepoIndex >= config.repositories.length) {
    return null;
  }
  return config.repositories[config.selectedRepoIndex];
}
