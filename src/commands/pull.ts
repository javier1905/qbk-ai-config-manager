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
      console.log(chalk.dim(`     ... ${count} línea${count !== 1 ? 's' : ''} sin cambios ...`));
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
  console.log(`  ${chalk.yellow.bold(`⚠  ${conflicts.length} conflicto${conflicts.length !== 1 ? 's' : ''} para resolver`)}\n`);

  for (let idx = 0; idx < conflicts.length; idx++) {
    const conflict = conflicts[idx];
    console.log(`  ${chalk.gray(`[${idx + 1}/${conflicts.length}]`)} ${chalk.bold('Archivo:')} ${chalk.cyan(conflict.relativePath)}`);
    console.log(sep + '\n');

    const localContent = await fs.readFile(conflict.localPath, 'utf8').catch(() => '');
    const remoteContent = await fs.readFile(conflict.remotePath, 'utf8').catch(() => '');

    displayFileDiff(localContent, remoteContent);
    console.log(`\n  ${chalk.red('- rojo')} = tu versión local    ${chalk.green('+ verde')} = cambios del remoto\n`);

    let choice: string;
    try {
      choice = await qbkSelect({
        message: `"${conflict.relativePath}" — ¿qué querés mantener?`,
        choices: [
          {
            name: `${chalk.yellow('↑')}  Keep mine (local)`,
            value: 'local',
            description: 'Se usa tu versión local',
          },
          {
            name: `${chalk.blue('↓')}  Keep theirs (remote)`,
            value: 'remote',
            description: 'Se usa la versión del remoto',
          },
        ],
      });
    } catch {
      return 'cancelled';
    }

    if (choice === 'local') {
      await fs.copyFile(conflict.localPath, conflict.remotePath);
      logSuccess(`"${conflict.relativePath}" → se mantuvo tu versión local.`);
    } else {
      logSuccess(`"${conflict.relativePath}" → se usa la versión del remoto.`);
    }
    console.log('');
  }

  return 'resolved';
}

// ─── Main Command ─────────────────────────────────────────────

export async function pullCommand(cwd: string): Promise<boolean> {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No hay configuración. Agregá un repositorio primero.');
    return false;
  }

  const currentRepo = getSelectedRepo(config);
  if (!currentRepo) {
    logError('No hay repositorio seleccionado.');
    return false;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Verificando cambios en el remoto...').start();

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
      logInfo('Ya estás al día. No hay nuevos cambios en el remoto.');
      return false;
    }

    spinner.stop();
    logInfo(`El remoto está adelante: ${chalk.yellow(currentRepo.currentVersion)} → ${chalk.cyan(remoteShort)}`);

    // Detect local changes (leaves temp at currentVersion, need to go back to branch HEAD after)
    const spinnerCheck = ora('Verificando cambios locales...').start();
    const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentRepo.currentVersion);
    // Return to branch HEAD so applyToWorkspace copies the latest files
    await git.checkout(currentRepo.currentBranch);
    spinnerCheck.stop();

    // ─── No local changes → pull directly ───
    if (!hasChanges) {
      const spinnerPull = ora('Aplicando cambios del remoto...').start();
      await gitManager.applyToWorkspace();
      currentRepo.currentVersion = remoteShort;
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerPull.stop();
      logSuccessBox('Pull completo', `Actualizado a la versión ${remoteShort}.`);
      return false;
    }

    // ─── Has local changes ───
    logWarning('Tenés cambios locales:');
    for (const f of files) {
      console.log(`    ${chalk.yellow('→')} ${f}`);
    }
    console.log('');

    let action: string;
    try {
      action = await qbkSelect({
        message: 'Tenés cambios locales. ¿Qué querés hacer?',
        choices: [
          {
            name: `${chalk.green('📦')}  Stash & Pull`,
            value: 'stash',
            description: 'Guarda tus cambios temporalmente, trae el remoto y los fusiona de vuelta',
          },
          {
            name: `${chalk.red('🗑')}   Descartar & Pull`,
            value: 'discard',
            description: 'Descarta tus cambios locales y aplica la versión del remoto',
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
          message: '¿Seguro que querés descartar todos tus cambios locales?',
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

      const spinnerPull = ora('Aplicando cambios del remoto...').start();
      await gitManager.applyToWorkspace();
      currentRepo.currentVersion = remoteShort;
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerPull.stop();
      logSuccessBox('Pull completo', `Actualizado a ${remoteShort}. Cambios locales descartados.`);
      return false;
    }

    // ─── Stash route ───
    const spinnerStash = ora('Guardando cambios locales en stash...').start();
    await saveStash(cwd);
    spinnerStash.succeed('Cambios locales guardados en stash.');

    const spinnerApply = ora('Aplicando cambios del remoto...').start();
    await gitManager.applyToWorkspace();
    currentRepo.currentVersion = remoteShort;
    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinnerApply.succeed('Cambios del remoto aplicados.');

    const spinnerMerge = ora('Fusionando tus cambios de vuelta...').start();
    const conflicts = await mergeStashIntoCwd(cwd);
    spinnerMerge.stop();

    // No conflicts → clean merge
    if (conflicts.length === 0) {
      await clearStash(cwd);
      logSuccessBox('Pull completo', `Actualizado a ${remoteShort}. Tus cambios se fusionaron automáticamente sin conflictos.`);
      return false;
    }

    // Has conflicts → interactive resolution UI
    const result = await resolveConflicts(conflicts);

    if (result === 'cancelled') {
      logWarning('Resolución cancelada. Restaurando tus cambios locales...');
      await restoreStash(cwd);
      currentRepo.currentVersion = originalVersion;
      await writeConfig(cwd, config);
      await clearStash(cwd);
      logInfo('Tus cambios locales fueron restaurados.');
      return true;
    }

    await clearStash(cwd);
    logSuccessBox(
      'Pull completo',
      `Actualizado a ${remoteShort}. ${conflicts.length} conflicto${conflicts.length !== 1 ? 's' : ''} resuelto${conflicts.length !== 1 ? 's' : ''}.`
    );

  } catch (err: any) {
    spinner.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
    await clearStash(cwd);
  }

  return false;
}
