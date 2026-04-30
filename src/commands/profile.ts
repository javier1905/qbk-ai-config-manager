import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, getSelectedRepo } from '../config.js';
import { GitManager } from '../git.js';
import { logSuccess, logError, logInfo, logSuccessBox, logErrorBox, logWarning, qbkInput, qbkSelect, qbkConfirm } from '../utils.js';
import { handlePendingChanges } from './shared.js';

/**
 * Command 3: Switch profile (branch).
 */
export async function switchProfileCommand(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Add a repository first.');
    return;
  }

  const currentRepo = getSelectedRepo(config);
  if (!currentRepo) {
    logError('No repository selected. Add or select a repository first.');
    return;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Fetching available profiles...').start();

  const branches = await gitManager.getRemoteBranches(currentRepo.url);
  spinner.stop();

  if (branches.length < 2) {
    logInfo('Only one profile available. Create a new profile first.');
    return;
  }

  const choices = branches.map(branch => ({
    name: `${branch === currentRepo.currentBranch ? chalk.green('● ') : '  '}${branch}${branch === currentRepo.defaultBranch ? chalk.dim(' (default)') : ''}`,
    value: branch,
  }));

  let selectedBranch: string;
  try {
    selectedBranch = await qbkSelect({
      message: 'Select a profile (branch):',
      choices,
    });
  } catch {
    return; // Escape pressed
  }

  if (selectedBranch === currentRepo.currentBranch) {
    logInfo('Already on this profile.');
    return;
  }

  // Handle pending changes
  const spinnerChanges = ora('Checking for local changes...').start();
  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);
    spinnerChanges.stop();

    const result = await handlePendingChanges(gitManager, git, currentRepo.currentVersion);
    if (result === 'cancelled') {
      await gitManager.cleanTempRepo();
      return;
    }
    await gitManager.cleanTempRepo();
  } catch (err: any) {
    spinnerChanges.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
    return;
  }

  // Switch to the selected branch
  const spinnerSwitch = ora(`Switching to profile "${selectedBranch}"...`).start();
  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, selectedBranch);

    let headCommit = 'latest';
    try {
      headCommit = (await git.revparse(['HEAD'])).trim().substring(0, 7);
    } catch { /* fallback */ }

    currentRepo.currentBranch = selectedBranch;
    currentRepo.currentVersion = headCommit;

    await gitManager.applyToWorkspace();
    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinnerSwitch.stop();

    logSuccessBox('Profile Switched', `Now using profile "${selectedBranch}".`);
  } catch (err: any) {
    spinnerSwitch.fail('Failed to switch profile.');
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}

/**
 * Command 4: Add a new profile (branch).
 */
export async function addProfileCommand(cwd: string): Promise<void> {
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

  // Get existing branches to check for duplicates
  const existingBranches = await gitManager.getRemoteBranches(currentRepo.url);

  // Ask for name
  let branchName: string;
  try {
    branchName = await qbkInput({ 
      message: 'Enter the new profile name (branch):',
      validate: (value) => {
        const sanitized = value.trim().replace(/\s+/g, '-');
        if (!sanitized) return 'Profile name cannot be empty.';
        if (existingBranches.includes(sanitized)) return `A profile named "${sanitized}" already exists.`;
        return true;
      },
      transformer: (value) => {
        // Show the user how it will look (hyphenated)
        return value.replace(/\s+/g, '-');
      }
    });
    // Final sanitization just in case
    branchName = branchName.trim().replace(/\s+/g, '-');
  } catch {
    return; // Escape pressed
  }

  // Ask: blank or from existing branch?
  let createBlank: boolean;
  try {
    createBlank = await qbkConfirm({
      message: 'Create a blank profile? (No = copy from an existing profile)',
      default: true,
    });
  } catch {
    return; // Escape pressed
  }

  const spinner = ora(`Creating profile "${branchName}"...`).start();

  try {
    if (createBlank) {
      // Clone repo, create orphan branch with base structure
      const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.defaultBranch);
      await gitManager.createBranch(git, branchName, { blank: true });
      spinner.stop();
      await gitManager.cleanTempRepo();
      logSuccessBox('Profile Created', `Blank profile "${branchName}" created and pushed.`);
    } else {
      // Let user pick a base branch
      spinner.stop();
      const branches = await gitManager.getRemoteBranches(currentRepo.url);

      let baseBranch: string;
      try {
        baseBranch = await qbkSelect({
          message: 'Select the base profile to copy from:',
          choices: branches.map(b => ({ name: b, value: b })),
        });
      } catch {
        return; // Escape pressed
      }

      const spinnerCreate = ora(`Creating profile "${branchName}" from "${baseBranch}"...`).start();
      const git = await gitManager.setupTempRepo(currentRepo.url, baseBranch);
      await gitManager.createBranch(git, branchName, { fromBranch: baseBranch });
      spinnerCreate.stop();
      await gitManager.cleanTempRepo();
      logSuccessBox('Profile Created', `Profile "${branchName}" created from "${baseBranch}" and pushed.`);
    }
  } catch (err: any) {
    spinner.stop();
    logError(`Failed to create profile: ${err.message}`);
    await gitManager.cleanTempRepo();
  }
}

/**
 * Command 5: Remove a profile (branch).
 * Cannot remove the default branch (main/master).
 */
export async function removeProfileCommand(cwd: string): Promise<void> {
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
  const spinner = ora('Fetching profiles...').start();
  const branches = await gitManager.getRemoteBranches(currentRepo.url);
  spinner.stop();

  // Filter out the default branch — it cannot be deleted
  const deletableBranches = branches.filter(b => b !== currentRepo.defaultBranch);

  if (deletableBranches.length === 0) {
    logInfo('No profiles available to remove. The default branch cannot be deleted.');
    return;
  }

  let branchToDelete: string;
  try {
    branchToDelete = await qbkSelect({
      message: `Select a profile to remove ${chalk.dim('(default branch is protected)')}:`,
      choices: deletableBranches.map(b => ({
        name: `${b === currentRepo.currentBranch ? chalk.yellow('● ') : '  '}${b}`,
        value: b,
      })),
    });
  } catch {
    return; // Escape pressed
  }

  // Confirm deletion
  let confirmed: boolean;
  try {
    confirmed = await qbkConfirm({
      message: `Are you sure you want to permanently delete the profile "${branchToDelete}"?`,
      default: false,
    });
  } catch {
    return; // Escape pressed
  }

  if (!confirmed) {
    logInfo(`Profile "${branchToDelete}" was not deleted.`);
    return;
  }

  const spinnerDelete = ora(`Deleting profile "${branchToDelete}"...`).start();

  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.defaultBranch);
    await gitManager.deleteBranch(git, branchToDelete);

    // If user was on the deleted branch, switch to default
    if (currentRepo.currentBranch === branchToDelete) {
      currentRepo.currentBranch = currentRepo.defaultBranch;
      let headCommit = 'latest';
      try {
        headCommit = (await git.revparse(['HEAD'])).trim().substring(0, 7);
      } catch { /* fallback */ }
      currentRepo.currentVersion = headCommit;
      await gitManager.applyToWorkspace();
    }

    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinnerDelete.stop();

    logSuccessBox('Profile Removed', `Profile "${branchToDelete}" has been deleted from the remote repository.`);
  } catch (err: any) {
    spinnerDelete.fail('Failed to delete profile.');
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
