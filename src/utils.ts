import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

export const AI_FILES = [
  '.agents',
  '.claude',
  'AGENTS.md',
  'CLAUDE.md'
];

export const CONFIG_FILE = '.ai-config.json';
export const TEMP_DIR = '.qbk-temp';
export const PROFILES_FILE = '.qbk-profiles.json';

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function logSuccess(message: string) {
  console.log(chalk.green('✔') + ' ' + message);
}

export function logInfo(message: string) {
  console.log(chalk.blue('ℹ') + ' ' + message);
}

export function logError(message: string) {
  console.log(chalk.red('✖') + ' ' + message);
}

export function logWarning(message: string) {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

export async function copyAiFiles(srcDir: string, destDir: string): Promise<void> {
  for (const item of AI_FILES) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    
    if (existsSync(srcPath)) {
      await fs.rm(destPath, { recursive: true, force: true }).catch(() => {});
      await fs.cp(srcPath, destPath, { recursive: true, force: true, dereference: false });
    }
  }
}

export async function checkLocalChanges(destDir: string): Promise<boolean> {
  // A simplified check if there are any git modifications to these specific AI files
  // For the CLI, we could rely on simple-git in the destDir to check `git status --porcelain` on these files
  // That will be handled in git.ts
  return false;
}

export async function validateStructure(dir: string): Promise<void> {
  const missing = [];
  for (const item of AI_FILES) {
    const itemPath = path.join(dir, item);
    if (!(await checkFileExists(itemPath))) {
      missing.push(item);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Invalid AI config repository structure. Missing: ${missing.join(', ')}`);
  }
}
