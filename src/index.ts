#!/usr/bin/env node

import { select, Separator, input } from '@inquirer/prompts';
import { readConfig, getSelectedRepo } from './config.js';
import type { AiConfig } from './config.js';
import { addRepoCommand, switchRepoCommand } from './commands/repo.js';
import { switchProfileCommand, addProfileCommand, removeProfileCommand } from './commands/profile.js';
import { switchVersionCommand } from './commands/version.js';
import { GitManager } from './git.js';
import chalk from 'chalk';
import readline from 'readline';

const cwd = process.cwd();

// ─── Global Escape Key Listener ───────────────────────────────
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (_str, key) => {
    if (key.name === 'escape') {
      console.clear();
      console.log(chalk.gray('\n  Goodbye! 👋\n'));
      process.exit(0);
    }
    if (key.ctrl && key.name === 'c') {
      console.clear();
      process.exit(0);
    }
  });
}

// ─── Header UI ────────────────────────────────────────────────

function printHeader(config: AiConfig | null) {
  console.clear();

  const bigLogo = `
  ${chalk.white.bold(' ██████   ██    ██  ██████   ██  ██   ██')}
  ${chalk.white.bold('██    ██  ██    ██  ██   ██  ██  ██  ██')}
  ${chalk.white.bold('██    ██  ██    ██  ██████   ██  █████')}
  ${chalk.white.bold('██ ▄▄ ██  ██    ██  ██   ██  ██  ██  ██')}
  ${chalk.white.bold(' ██████    ██████   ██████   ██  ██   ██')}
  ${chalk.white.bold('    ▀▀')}
  ${chalk.hex('#FF8C00').bold('       A I   C O N F I G   M A N A G E R')}
  `;

  console.log(bigLogo);
  console.log(`  ${chalk.bgBlack('  ')}${chalk.bgRed('  ')}${chalk.bgGreen('  ')}${chalk.bgYellow('  ')}${chalk.bgBlue('  ')}${chalk.bgMagenta('  ')}${chalk.bgCyan('  ')}${chalk.bgWhite('  ')}`);
  console.log(`\n${chalk.gray('──────────────────────────────────────────────────────')}`);

  // Sub-header with current repo info
  const repo = config ? getSelectedRepo(config) : null;

  if (repo) {
    console.log(`  ${chalk.green.bold('Repo:')}     ${chalk.blue(repo.name)} ${chalk.dim(`(${repo.url})`)}`);
    console.log(`  ${chalk.green.bold('Profile:')}  ${chalk.yellow(repo.currentBranch)}${repo.currentBranch === repo.defaultBranch ? chalk.dim(' (default)') : ''}`);
    console.log(`  ${chalk.green.bold('Version:')}  ${chalk.cyan(repo.currentVersion)}`);
  } else {
    console.log(`  ${chalk.dim('No repository configured. Add one to get started.')}`);
  }

  console.log(`${chalk.gray('──────────────────────────────────────────────────────')}\n`);
}

// ─── Menu Builder ─────────────────────────────────────────────

function buildMenuChoices(config: AiConfig | null, branchCount: number) {
  const hasRepo = config !== null && config.repositories.length > 0;
  const hasMultipleRepos = config !== null && config.repositories.length > 1;
  const hasSelectedRepo = config !== null && config.selectedRepoIndex >= 0;
  const hasMultipleProfiles = branchCount > 1;

  const choices: any[] = [];

  // 1. Add Repository (always visible)
  choices.push({
    name: `${chalk.bold.cyan('➕')}  Add Repository`,
    value: 'add-repo',
    description: 'Connect a new Git repository',
  });

  // 2. Switch Repository (visible if > 1 repos)
  if (hasMultipleRepos) {
    choices.push({
      name: `${chalk.bold.green('🔄')}  Switch Repository`,
      value: 'switch-repo',
      description: 'Change to a different repository',
    });
  }

  if (hasSelectedRepo) {
    choices.push(new Separator());

    // 3. Switch Profile (visible if > 1 profile)
    if (hasMultipleProfiles) {
      choices.push({
        name: `${chalk.bold.magenta('⇋')}   Switch Profile`,
        value: 'switch-profile',
        description: 'Change to a different branch',
      });
    }

    // 4. Add Profile (always if repo selected)
    choices.push({
      name: `${chalk.bold.yellow('➕')}  Add Profile`,
      value: 'add-profile',
      description: 'Create a new branch',
    });

    // 5. Remove Profile (visible if > 1 profile)
    if (hasMultipleProfiles) {
      choices.push({
        name: `${chalk.bold.red('🗑')}   Remove Profile`,
        value: 'remove-profile',
        description: 'Delete a branch',
      });
    }

    // 6. Switch Version (always if repo selected)
    choices.push({
      name: `${chalk.bold.blue('📋')}  Switch Version`,
      value: 'switch-version',
      description: 'Checkout a specific commit',
    });
  }

  choices.push(new Separator());
  choices.push({ name: `   Exit`, value: 'exit' });

  return choices;
}

// ─── Main Loop ────────────────────────────────────────────────

async function showMenu() {
  while (true) {
    const config = await readConfig(cwd);

    // Fetch branch count for the selected repo to decide menu visibility
    let branchCount = 0;
    const repo = config ? getSelectedRepo(config) : null;
    if (repo) {
      try {
        const gitManager = new GitManager(cwd);
        const branches = await gitManager.getRemoteBranches(repo.url);
        branchCount = branches.length;
      } catch {
        branchCount = 1;
      }
    }

    printHeader(config);

    const choices = buildMenuChoices(config, branchCount);

    try {
      const action = await select({
        message: 'What would you like to do?',
        choices,
        pageSize: 12,
      });

      switch (action) {
        case 'add-repo':
          await addRepoCommand(cwd);
          break;
        case 'switch-repo':
          await switchRepoCommand(cwd);
          break;
        case 'switch-profile':
          await switchProfileCommand(cwd);
          break;
        case 'add-profile':
          await addProfileCommand(cwd);
          break;
        case 'remove-profile':
          await removeProfileCommand(cwd);
          break;
        case 'switch-version':
          await switchVersionCommand(cwd);
          break;
        case 'exit':
          console.clear();
          console.log(chalk.gray('\n  Goodbye! 👋\n'));
          process.exit(0);
      }

      if (action !== 'exit') {
        await input({ message: chalk.dim('\nPress Enter to continue...') });
      }
    } catch {
      // User pressed Escape or Ctrl+C
      console.clear();
      console.log(chalk.gray('\n  Goodbye! 👋\n'));
      process.exit(0);
    }
  }
}

// ─── Entry Point ──────────────────────────────────────────────

showMenu().catch(err => {
  if (err.message?.includes('User force closed')) {
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
