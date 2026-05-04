import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, getSelectedRepo } from '../config.js';
import { GitManager } from '../git.js';
import {
  AI_FILES, STASH_DIR,
  logError, logInfo, logWarning, logSuccess, logSuccessBox,
  qbkSelect, qbkConfirm,
} from '../utils.js';

// ─── Diff Utilities ──────────────────────────────────────────

type DiffLine = { type: 'same' | 'added' | 'removed'; line: string };

function diffLines(local: string[], remote: string[]): DiffLine[] {
  const m = local.length, n = remote.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = local[i - 1] === remote[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && local[i - 1] === remote[j - 1]) {
      result.unshift({ type: 'same', line: local[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', line: remote[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', line: local[i - 1] });
      i--;
    }
  }
  return result;
}

function displayFileDiff(localContent: string, remoteContent: string): void {
  const diff = diffLines(localContent.split('\n'), remoteContent.split('\n'));
  let i = 0;
  while (i < diff.length) {
    if (diff[i].type === 'same') {
      let count = 0;
      while (i < diff.length && diff[i].type === 'same') { count++; i++; }
      console.log(chalk.dim(`     ... ${count} line${count !== 1 ? 's' : ''} without changes ...`));
    } else {
      while (i < diff.length && diff[i].type !== 'same') {
        const { type, line } = diff[i];
        if (type === 'removed') console.log(chalk.red(`  -  ${line}`));
        else console.log(chalk.green(`  +  ${line}`));
        i++;
      }
    }
  }
}

// ─── Stash Utilities ─────────────────────────────────────────

async function saveStash(cwd: string): Promise<void> {
  const stashDir = path.join(cwd, STASH_DIR);
  await fs.rm(stashDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(stashDir, { recursive: true });
  for (const item of AI_FILES) {
    const src = path.join(cwd, item);
    const dest = path.join(stashDir, item);
    if (existsSync(src)) {
      await fs.cp(src, dest, { recursive: true, force: true });
    }
  }
}

async function restoreStash(cwd: string): Promise<void> {
  const stashDir = path.join(cwd, STASH_DIR);
  for (const item of AI_FILES) {
    const src = path.join(stashDir, item);
    const dest = path.join(cwd, item);
    if (existsSync(src)) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      await fs.cp(src, dest, { recursive: true, force: true });
    }
  }
}

async function clearStash(cwd: string): Promise<void> {
  await fs.rm(path.join(cwd, STASH_DIR), { recursive: true, force: true }).catch(() => {});
}

// ─── Conflict Detection & Resolution ─────────────────────────

interface ConflictFile {
  relativePath: string;
  localPath: string;  // stash copy
  remotePath: string; // cwd (remote already applied)
}

async function getAllFilesIn(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await getAllFilesIn(full));
    else result.push(full);
  }
  return result;
}

/**
 * Merge the stash back into cwd (after remote was applied).
 * - Files only in stash (new local files) → copy back to cwd automatically.
 * - Files in both and identical → no action needed (remote version stays).
 * - Files in both and different → added to conflicts list for user to resolve.
 */
async function mergeStashIntoCwd(cwd: string): Promise<ConflictFile[]> {
  const stashDir = path.join(cwd, STASH_DIR);
  const conflicts: ConflictFile[] = [];

  for (const item of AI_FILES) {
    const stashPath = path.join(stashDir, item);
    const cwdPath = path.join(cwd, item);

    if (!existsSync(stashPath)) continue;

    const stashStat = await fs.stat(stashPath);

    if (stashStat.isDirectory()) {
      const stashFiles = await getAllFilesIn(stashPath);
      for (const stashFile of stashFiles) {
        const rel = path.relative(stashPath, stashFile);
        const targetPath = path.join(cwdPath, rel);

        if (!existsSync(targetPath)) {
          // Only in stash (new local file) → keep it
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(stashFile, targetPath);
        } else {
          const stashContent = await fs.readFile(stashFile, 'utf8').catch(() => '');
          const cwdContent = await fs.readFile(targetPath, 'utf8').catch(() => '');
          if (stashContent !== cwdContent) {
            conflicts.push({
              relativePath: path.join(item, rel),
              localPath: stashFile,
              remotePath: targetPath,
            });
          }
        }
      }
    } else {
      if (!existsSync(cwdPath)) {
        await fs.copyFile(stashPath, cwdPath);
      } else {
        const stashContent = await fs.readFile(stashPath, 'utf8').catch(() => '');
        const cwdContent = await fs.readFile(cwdPath, 'utf8').catch(() => '');
        if (stashContent !== cwdContent) {
          conflicts.push({
            relativePath: item,
            localPath: stashPath,
            remotePath: cwdPath,
          });
        }
      }
    }
  }

  return conflicts;
}

async function resolveConflicts(conflicts: ConflictFile[]): Promise<'resolved' | 'cancelled'> {
  const sep = chalk.gray('──────────────────────────────────────────────────────');
  console.log(`\n${sep}`);
  console.log(`  ${chalk.yellow.bold(`⚠  ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} to resolve`)}\n`);

  for (let idx = 0; idx < conflicts.length; idx++) {
    const conflict = conflicts[idx];
    console.log(`  ${chalk.gray(`[${idx + 1}/${conflicts.length}]`)} ${chalk.bold('File:')} ${chalk.cyan(conflict.relativePath)}`);
    console.log(sep + '\n');

    const localContent = await fs.readFile(conflict.localPath, 'utf8').catch(() => '');
    const remoteContent = await fs.readFile(conflict.remotePath, 'utf8').catch(() => '');

    displayFileDiff(localContent, remoteContent);
    console.log(`\n  ${chalk.red('- red')} = your local version    ${chalk.green('+ green')} = remote changes\n`);

    let choice: string;
    try {
      choice = await qbkSelect({
        message: `"${conflict.relativePath}" — what do you want to keep?`,
        choices: [
          {
            name: `${chalk.yellow('↑')}  Keep mine (local)`,
            value: 'local',
            description: 'Uses your local version',
          },
          {
            name: `${chalk.blue('↓')}  Keep theirs (remote)`,
            value: 'remote',
            description: 'Uses the remote version',
          },
        ],
      });
    } catch {
      return 'cancelled';
    }

    if (choice === 'local') {
      await fs.copyFile(conflict.localPath, conflict.remotePath);
      logSuccess(`"${conflict.relativePath}" → your local version was kept.`);
    } else {
      logSuccess(`"${conflict.relativePath}" → remote version is used.`);
    }
    console.log('');
  }

  return 'resolved';
}

// ─── Main Command ─────────────────────────────────────────────

export async function pullCommand(cwd: string): Promise<boolean> {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Add a repository first.');
    return false;
  }

  const currentRepo = getSelectedRepo(config);
  if (!currentRepo) {
    logError('No repository selected.');
    return false;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Checking for remote changes...').start();

  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);

    let remoteHead = '';
    try {
      remoteHead = (await git.revparse(['HEAD'])).trim();
    } catch { /* fallback */ }

    const remoteShort = remoteHead.substring(0, 7);
    const originalVersion = currentRepo.currentVersion;

    // Already up to date?
    const upToDate =
      currentRepo.currentVersion === remoteShort ||
      remoteHead.startsWith(currentRepo.currentVersion) ||
      currentRepo.currentVersion === 'latest';

    if (upToDate) {
      spinner.stop();
      await gitManager.cleanTempRepo();
      logInfo('You are already up to date. No new changes in the remote.');
      return false;
    }

    spinner.stop();
    logInfo(`Remote is ahead: ${chalk.yellow(currentRepo.currentVersion)} → ${chalk.cyan(remoteShort)}`);

    // Detect local changes — pass branch so detectLocalChanges restores HEAD after comparing
    const spinnerCheck = ora('Checking for local changes...').start();
    const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentRepo.currentVersion, currentRepo.currentBranch);
    spinnerCheck.stop();

    // ─── No local changes → pull directly ───
    if (!hasChanges) {
      const spinnerPull = ora('Applying remote changes...').start();
      await gitManager.applyToWorkspace();
      currentRepo.currentVersion = remoteShort;
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerPull.stop();
      logSuccessBox('Pull complete', `Updated to version ${remoteShort}.`);
      return false;
    }

    // ─── Has local changes ───
    logWarning('You have local changes:');
    for (const f of files) {
      console.log(`    ${chalk.yellow('→')} ${f}`);
    }
    console.log('');

    let action: string;
    try {
      action = await qbkSelect({
        message: 'You have local changes. What do you want to do?',
        choices: [
          {
            name: `${chalk.green('📦')}  Stash & Pull`,
            value: 'stash',
            description: 'Saves your changes temporarily, pulls the remote, and merges them back',
          },
          {
            name: `${chalk.red('🗑')}   Descartar & Pull`,
            value: 'discard',
            description: 'Discards your local changes and applies the remote version',
          },
        ],
      });
    } catch {
      await gitManager.cleanTempRepo();
      return true; // Escape
    }

    // ─── Discard route ───
    if (action === 'discard') {
      let confirmed: boolean;
      try {
        confirmed = await qbkConfirm({
          message: 'Are you sure you want to discard all your local changes?',
          default: false,
        });
      } catch {
        await gitManager.cleanTempRepo();
        return true;
      }

      if (!confirmed) {
        await gitManager.cleanTempRepo();
        return false;
      }

      const spinnerPull = ora('Applying remote changes...').start();
      await gitManager.applyToWorkspace();
      currentRepo.currentVersion = remoteShort;
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerPull.stop();
      logSuccessBox('Pull complete', `Updated to ${remoteShort}. Local changes discarded.`);
      return false;
    }

    // ─── Stash route ───
    const spinnerStash = ora('Stashing local changes...').start();
    await saveStash(cwd);
    spinnerStash.succeed('Local changes saved to stash.');

    const spinnerApply = ora('Applying remote changes...').start();
    await gitManager.applyToWorkspace();
    currentRepo.currentVersion = remoteShort;
    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinnerApply.succeed('Remote changes applied.');

    const spinnerMerge = ora('Merging your changes back...').start();
    const conflicts = await mergeStashIntoCwd(cwd);
    spinnerMerge.stop();

    // No conflicts → clean merge
    if (conflicts.length === 0) {
      await clearStash(cwd);
      logSuccessBox('Pull complete', `Updated to ${remoteShort}. Your changes were automatically merged without conflicts.`);
      return false;
    }

    // Has conflicts → interactive resolution UI
    const result = await resolveConflicts(conflicts);

    if (result === 'cancelled') {
      logWarning('Resolution cancelled. Restoring your local changes...');
      await restoreStash(cwd);
      currentRepo.currentVersion = originalVersion;
      await writeConfig(cwd, config);
      await clearStash(cwd);
      logInfo('Your local changes were restored.');
      return true;
    }

    await clearStash(cwd);
    logSuccessBox(
      'Pull complete',
      `Updated to ${remoteShort}. ${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''} resolved.`
    );

  } catch (err: any) {
    spinner.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
    await clearStash(cwd);
  }

  return false;
}
