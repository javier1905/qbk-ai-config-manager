import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, getSelectedRepo } from '../config.js';
import { GitManager } from '../git.js';
import { logSuccess, logError, logInfo, logSuccessBox } from '../utils.js';
import { handlePendingChanges } from './shared.js';

/**
 * Command 6: Switch version (commit).
 */
export async function switchVersionCommand(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Add a repository first.');
    return;
  }

  const currentRepo = getSelectedRepo(config);
  if (!currentRepo) {
    logError('No repository selected.');
    return;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Fetching version history...').start();

  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);
    const commits = await gitManager.getCommits(git, 30);
    spinner.stop();

    if (commits.length === 0) {
      logInfo('No versions (commits) found for this profile.');
      await gitManager.cleanTempRepo();
      return;
    }

    const choices = commits.map(commit => ({
      name: `${commit.hash.substring(0, 7) === currentRepo.currentVersion ? chalk.green('● ') : '  '}${chalk.cyan(commit.hash.substring(0, 7))} ${chalk.white(commit.message)} ${chalk.dim(`(${new Date(commit.date).toLocaleDateString()})`)}`,
      value: commit.hash,
    }));

    let selectedCommit: string;
    try {
      selectedCommit = await select({
        message: `Versions for profile "${currentRepo.currentBranch}":`,
        choices,
        pageSize: 15,
      });
    } catch {
      await gitManager.cleanTempRepo();
      return; // Escape pressed
    }

    const shortHash = selectedCommit.substring(0, 7);

    if (shortHash === currentRepo.currentVersion) {
      logInfo('Already on this version.');
      await gitManager.cleanTempRepo();
      return;
    }

    // Handle pending changes (compare against the version user is actually on)
    const result = await handlePendingChanges(gitManager, git, currentRepo.currentVersion);
    if (result === 'cancelled') {
      await gitManager.cleanTempRepo();
      return;
    }

    // Checkout the selected commit
    const spinnerSwitch = ora(`Switching to version ${shortHash}...`).start();
    await gitManager.checkoutCommit(git, selectedCommit);

    currentRepo.currentVersion = shortHash;

    await gitManager.applyToWorkspace();
    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinnerSwitch.stop();

    const selectedMsg = commits.find(c => c.hash === selectedCommit)?.message || '';
    logSuccessBox('Version Switched', `Now on version ${shortHash}: "${selectedMsg}"`);
  } catch (err: any) {
    spinner.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
