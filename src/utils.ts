import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import readline from 'readline';
import { input, select, confirm } from '@inquirer/prompts';

export const AI_FILES = ['.agents', '.claude', '.claudeignore', 'skills-lock.json', 'AGENTS.md', 'CLAUDE.md'];
export const REQUIRED_AI_FILES = ['.agents', '.claude', 'AGENTS.md', 'CLAUDE.md'];

export const CONFIG_FILE = '.ai-config.json';
export const TEMP_DIR = '.qbk-temp';
export const STASH_DIR = '.qbk-stash';

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
  console.log(`  ${chalk.green.bold('✔')}  ${chalk.white.bold(message)}`);
}

export function logInfo(message: string) {
  console.log(`  ${chalk.blue.bold('ℹ')}  ${chalk.white(message)}`);
}

export function logError(message: string) {
  console.log(`  ${chalk.red.bold('✖')}  ${chalk.red.bold(message)}`);
}

export function logWarning(message: string) {
  console.log(`  ${chalk.yellow.bold('⚠')}  ${chalk.yellow(message)}`);
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

// ─── Interactive UI Helpers ───────────────────────────────────

/**
 * Internal helper to handle Escape key in prompts.
 */
async function withEscape<T>(promptFn: (context: any) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  
  const handleData = (data: Buffer) => {
    // 0x1b is the Escape key code. 
    // We only abort if it's a standalone Escape (length 1) to avoid breaking arrow keys.
    if (data.length === 1 && data[0] === 0x1b) {
      controller.abort();
    }
  };

  const isTTY = process.stdin.isTTY;
  const wasRaw = process.stdin.isRaw;
  
  if (isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  
  process.stdin.on('data', handleData);

  try {
    return await promptFn({ signal: controller.signal });
  } catch (err: any) {
    throw err;
  } finally {
    process.stdin.removeListener('data', handleData);
    if (isTTY) {
      process.stdin.setRawMode(wasRaw);
    }
  }
}

export async function qbkInput(options: {
  message: string;
  default?: string;
  validate?: (value: string) => string | boolean | Promise<string | boolean>;
  transformer?: (value: string, { isFinal }: { isFinal: boolean }) => string;
}) {
  return await withEscape((context) => input({
    ...options,
    theme: {
      prefix: chalk.cyan('?'),
      style: {
        message: (text: string) => chalk.white.bold(text),
        answer: (text: string) => chalk.cyan(text),
        defaultAnswer: (text: string) => chalk.dim(`(${text})`),
      },
    },
  }, context));
}

export async function qbkSelect<T>(options: {
  message: string;
  choices: any[];
  pageSize?: number;
}) {
  return await withEscape((context) => select({
    ...options,
    theme: {
      prefix: chalk.magenta('?'),
      style: {
        message: (text: string) => chalk.white.bold(text),
        answer: (text: string) => chalk.magenta(text),
      },
    },
  }, context));
}

export async function qbkConfirm(options: {
  message: string;
  default?: boolean;
}) {
  return await withEscape((context) => confirm({
    ...options,
    theme: {
      prefix: chalk.yellow('?'),
      style: {
        message: (text: string) => chalk.white.bold(text),
        answer: (text: string) => chalk.yellow(text),
      },
    },
  }, context));
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
  for (const item of REQUIRED_AI_FILES) {
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

  const filesToIgnore = [...AI_FILES, CONFIG_FILE, TEMP_DIR, STASH_DIR];
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
