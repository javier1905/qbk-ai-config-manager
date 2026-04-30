import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

export const AI_FILES = ['.agents', '.claude', 'AGENTS.md', 'CLAUDE.md'];

export const CONFIG_FILE = '.ai-config.json';
export const TEMP_DIR = '.qbk-temp';

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Logging ──────────────────────────────────────────────────

export function logSuccess(message: string) {
  console.log(`\n  ${chalk.green.bold('✔')}  ${chalk.white.bold(message)}`);
}

export function logInfo(message: string) {
  console.log(`\n  ${chalk.blue.bold('ℹ')}  ${chalk.white(message)}`);
}

export function logError(message: string) {
  console.log(`\n  ${chalk.red.bold('✖')}  ${chalk.red.bold(message)}`);
}

export function logWarning(message: string) {
  console.log(`\n  ${chalk.yellow.bold('⚠')}  ${chalk.yellow(message)}`);
}

export function logSuccessBox(title: string, detail: string) {
  const line = chalk.gray('──────────────────────────────────────────────────────');
  console.log(`\n  ${line}`);
  console.log(`  ${chalk.green.bold('✔ SUCCESS')}  ${chalk.white.bold(title)}`);
  console.log(`  ${chalk.gray(detail)}`);
  console.log(`  ${line}\n`);
}

export function logErrorBox(title: string, detail: string) {
  const line = chalk.gray('──────────────────────────────────────────────────────');
  console.log(`\n  ${line}`);
  console.log(`  ${chalk.red.bold('✖ ERROR')}  ${chalk.red.bold(title)}`);
  console.log(`  ${chalk.gray(detail)}`);
  console.log(`  ${line}\n`);
}

export function logSkull() {
  const skull = `
       ${chalk.red.bold('______')}
    ${chalk.red.bold('.-"      "-.')}
   ${chalk.red.bold('/            \\')}
  ${chalk.red.bold('|              |')}
  ${chalk.red.bold('|,  .-.  .-.  ,|')}
  ${chalk.red.bold('| )(__/  \\__)( |')}
  ${chalk.red.bold('|/     /\\     \\|')}
  ${chalk.red.bold('(_     ^^     _)')}
   ${chalk.red.bold('\\__|IIIIII|__/')}
    ${chalk.red.bold('| \\IIIIII/ |')}
    ${chalk.red.bold('\\          /')}
     ${chalk.red.bold('`--------`')}
  `;
  console.log(skull);
}

// ─── File Operations ──────────────────────────────────────────

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

export async function validateStructure(dir: string): Promise<boolean> {
  for (const item of AI_FILES) {
    const itemPath = path.join(dir, item);
    if (!(await checkFileExists(itemPath))) {
      return false;
    }
  }
  return true;
}

// ─── .gitignore Management ───────────────────────────────────

export async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  let content = '';
  if (await checkFileExists(gitignorePath)) {
    content = await fs.readFile(gitignorePath, 'utf8');
  }

  const filesToIgnore = [...AI_FILES, CONFIG_FILE, TEMP_DIR];
  let appended = false;
  for (const file of filesToIgnore) {
    if (!content.includes(file)) {
      content += `\n${file}`;
      appended = true;
    }
  }

  if (appended) {
    await fs.writeFile(gitignorePath, content, 'utf8');
    logSuccess('Updated .gitignore to ignore AI configuration files.');
  }
}
