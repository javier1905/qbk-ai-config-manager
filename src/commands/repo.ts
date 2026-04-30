import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, repoNameFromUrl, getSelectedRepo } from '../config.js';
import type { AiConfig, RepoEntry } from '../config.js';
import { GitManager } from '../git.js';
import { logSuccess, logError, logInfo, logSuccessBox, logErrorBox, ensureGitignore } from '../utils.js';
import { handlePendingChanges } from './shared.js';

/**
 * Command 1: Add a new repository.
 */
export async function addRepoCommand(cwd: string): Promise<void> {
  let repoUrl: string;
  try {
    repoUrl = await input({ message: 'Enter the Git repository URL:' });
  } catch {
    return; // Escape pressed
  }

  if (!repoUrl.trim()) {
    logError('Repository URL cannot be empty.');
    return;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Verifying connection to repository...').start();

  // 1. Verify connection
  const connected = await gitManager.verifyConnection(repoUrl);
  if (!connected) {
    spinner.fail('Connection failed.');
    logErrorBox('Cannot connect', 'Could not connect to the provided Git repository.');
    return;
  }
  spinner.succeed('Connection successful.');

  // 2. Check if repo already exists in config
  let config = await readConfig(cwd);
  if (!config) {
    config = { repositories: [], selectedRepoIndex: -1 };
  }

  const alreadyExists = config.repositories.some(r => r.url === repoUrl);
  if (alreadyExists) {
    logError('This repository is already configured.');
    return;
  }

  // 3. Check if repo is empty
  const spinnerCheck = ora('Checking repository...').start();
  const isEmpty = await gitManager.isRepoEmpty(repoUrl);

  if (isEmpty) {
    // Empty repo: seed it with base structure
    spinnerCheck.text = 'Initializing empty repository...';
    try {
      const git = await gitManager.setupTempRepo(repoUrl);
      await gitManager.seedBaseStructure();
      const tempGit = gitManager.getTempGit();
      await tempGit.add('.');
      await tempGit.commit('feat: initialize AI config structure');

      // Detect if we should use main or master (new repos default to main usually)
      let defaultBranch = 'main';
      try {
        defaultBranch = (await tempGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
      } catch { /* fallback */ }

      await tempGit.push(['-u', 'origin', defaultBranch]);
      spinnerCheck.succeed('Repository initialized with base structure.');

      const newRepo: RepoEntry = {
        url: repoUrl,
        name: repoNameFromUrl(repoUrl),
        defaultBranch,
        currentBranch: defaultBranch,
        currentVersion: 'latest',
      };

      config.repositories.push(newRepo);

      // If first repo, auto-select it
      if (config.repositories.length === 1) {
        config.selectedRepoIndex = 0;
        // Apply files to workspace
        await gitManager.applyToWorkspace();
      }

      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      await ensureGitignore(cwd);
      logSuccessBox('Repository Added', `"${newRepo.name}" has been initialized and added.`);
    } catch (err: any) {
      spinnerCheck.fail('Failed to initialize repository.');
      logError(err.message);
      await gitManager.cleanTempRepo();
    }
    return;
  }

  // 4. Non-empty repo: clone (without specifying branch) and detect default branch
  spinnerCheck.text = 'Cloning repository...';

  try {
    // Clone without -b flag so git uses the repo's own default branch
    const git = await gitManager.setupTempRepo(repoUrl);

    // Detect which branch we landed on
    let defaultBranch = 'main';
    try {
      defaultBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    } catch { /* fallback */ }

    spinnerCheck.text = `Validating structure on branch "${defaultBranch}"...`;
    const isValid = await gitManager.validateStructure();

    if (!isValid) {
      spinnerCheck.fail('Invalid structure.');
      logErrorBox(
        'Cannot add repository',
        `The "${defaultBranch}" branch does not have the required AI config structure (.agents, .claude, AGENTS.md, CLAUDE.md).`
      );
      await gitManager.cleanTempRepo();
      return;
    }

    // Get current HEAD commit
    let headCommit = 'latest';
    try {
      headCommit = (await git.revparse(['HEAD'])).trim().substring(0, 7);
    } catch { /* fallback */ }

    spinnerCheck.succeed(`Structure valid on branch "${defaultBranch}".`);

    const newRepo: RepoEntry = {
      url: repoUrl,
      name: repoNameFromUrl(repoUrl),
      defaultBranch,
      currentBranch: defaultBranch,
      currentVersion: headCommit,
    };

    config.repositories.push(newRepo);

    // If first repo, auto-select and apply
    if (config.repositories.length === 1) {
      config.selectedRepoIndex = 0;
      await gitManager.applyToWorkspace();
    }

    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    await ensureGitignore(cwd);
    logSuccessBox('Repository Added', `"${newRepo.name}" has been added successfully.`);
  } catch (err: any) {
    spinnerCheck.fail('Failed to validate repository.');
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}

/**
 * Command 2: Switch repository.
 */
export async function switchRepoCommand(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config || config.repositories.length < 2) {
    logInfo('You need at least 2 repositories to switch.');
    return;
  }

  const currentRepo = getSelectedRepo(config);

  const choices = config.repositories.map((repo, index) => ({
    name: `${index === config.selectedRepoIndex ? chalk.green('● ') : '  '}${repo.name} ${chalk.dim(`(${repo.currentBranch})`)}`,
    value: index,
    description: repo.url,
  }));

  let selectedIndex: number;
  try {
    selectedIndex = await select({
      message: 'Select a repository:',
      choices,
    });
  } catch {
    return; // Escape pressed
  }

  if (selectedIndex === config.selectedRepoIndex) {
    logInfo('Already on this repository.');
    return;
  }

  const gitManager = new GitManager(cwd);
  const targetRepo = config.repositories[selectedIndex];

  // Handle pending changes on current repo
  if (currentRepo) {
    const spinner = ora('Checking for local changes...').start();
    try {
      const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);
      spinner.stop();

      const result = await handlePendingChanges(gitManager, git, currentRepo.currentVersion);
      if (result === 'cancelled') {
        await gitManager.cleanTempRepo();
        return;
      }
      await gitManager.cleanTempRepo();
    } catch (err: any) {
      spinner.stop();
      logError(err.message);
      await gitManager.cleanTempRepo();
      return;
    }
  }

  // Switch to new repo on its default branch
  const spinner = ora(`Switching to "${targetRepo.name}"...`).start();
  try {
    const git = await gitManager.setupTempRepo(targetRepo.url, targetRepo.defaultBranch);

    // Update version
    let headCommit = 'latest';
    try {
      headCommit = (await git.revparse(['HEAD'])).trim().substring(0, 7);
    } catch { /* fallback */ }

    config.selectedRepoIndex = selectedIndex;
    config.repositories[selectedIndex].currentBranch = targetRepo.defaultBranch;
    config.repositories[selectedIndex].currentVersion = headCommit;

    await gitManager.applyToWorkspace();
    await writeConfig(cwd, config);
    await gitManager.cleanTempRepo();
    spinner.stop();

    logSuccessBox(
      'Repository Switched',
      `Now using "${targetRepo.name}" on branch "${targetRepo.defaultBranch}".`
    );
  } catch (err: any) {
    spinner.fail('Failed to switch repository.');
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
