import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, repoNameFromUrl, getSelectedRepo } from '../config.js';
import type { AiConfig, RepoEntry } from '../config.js';
import { GitManager } from '../git.js';
import { logSuccess, logError, logInfo, logSuccessBox, logErrorBox, ensureGitignore, logWarning, logSkull, qbkInput, qbkSelect, qbkConfirm } from '../utils.js';
import { handlePendingChanges } from './shared.js';

/**
 * Command 1: Add a new repository.
 */
export async function addRepoCommand(cwd: string): Promise<boolean> {
  let repoUrl: string;
  try {
    repoUrl = await qbkInput({ 
      message: 'Enter the Git repository URL:',
      validate: (value) => value.trim() ? true : 'Repository URL cannot be empty.'
    });
  } catch {
    return true; // Escape pressed
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Verifying connection to repository...').start();

  // 1. Verify connection
  const connected = await gitManager.verifyConnection(repoUrl);
  if (!connected) {
    spinner.fail('Connection failed.');
    logErrorBox('Cannot connect', 'Could not connect to the provided Git repository.');
    return false;
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
    return false;
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
    return false;
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
      return false;
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
  return false;
}

/**
 * Command 2: Switch repository.
 */
export async function switchRepoCommand(cwd: string): Promise<boolean> {
  const config = await readConfig(cwd);
  if (!config || config.repositories.length < 2) {
    logInfo('You need at least 2 repositories to switch.');
    return false;
  }

  const currentRepo = getSelectedRepo(config);

  let selectedIndex: number | null = null;

  while (selectedIndex === null) {
    const choices = config.repositories.map((repo, index) => ({
      name: `${index === config.selectedRepoIndex ? chalk.green('● ') : '  '}${repo.name} ${chalk.dim(`(${repo.currentBranch})`)}`,
      value: index,
      description: repo.url,
    }));

    try {
      selectedIndex = await qbkSelect({
        message: 'Select a repository:',
        choices,
      });
    } catch {
      return true; // Escape pressed
    }

    if (selectedIndex === null) return true;

    if (selectedIndex === config.selectedRepoIndex) {
      logInfo('Already on this repository.');
      return false;
    }

    const gitManager = new GitManager(cwd);
    const targetRepo = config.repositories[selectedIndex];

    // ─── Safety Check on Current Repo ───
    if (currentRepo) {
      const spinnerStatus = ora('Checking current repository status...').start();
      try {
        const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);
        const isOnLatest = await gitManager.isOnLatestCommit(currentRepo.url, currentRepo.currentBranch, currentRepo.currentVersion);
        spinnerStatus.stop();

        // CASE A: Not on latest commit
        if (!isOnLatest) {
          logSkull();
          logWarning('You are not on the latest commit of the current repository.');
          logInfo('Any local changes you may have will be discarded.');

          let shouldContinue: boolean;
          try {
            shouldContinue = await qbkConfirm({
              message: 'Do you want to discard changes and switch repository?',
              default: false,
            });
          } catch {
            await gitManager.cleanTempRepo();
            selectedIndex = null;
            continue;
          }

          if (!shouldContinue) {
            selectedIndex = null;
            await gitManager.cleanTempRepo();
            continue;
          }
          // Discard is implicit as we don't save. We'll proceed to switch.
        } 
        else {
          // CASE B: On latest commit → check for changes
          const spinnerDetect = ora('Checking for local changes...').start();
          const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentRepo.currentVersion);
          spinnerDetect.stop();
          
          if (hasChanges) {
            logSkull();
            logWarning('You have local changes in the current repository:');
            for (const f of files) {
              console.log(`    ${chalk.yellow('→')} ${f}`);
            }

            let action: string;
            try {
              action = await qbkSelect({
                message: 'What do you want to do with your local changes?',
                choices: [
                  { name: `${chalk.green('💾')}  Save changes (commit & push)`, value: 'save' },
                  { name: `${chalk.red('🗑')}   Discard changes`, value: 'discard' },
                ],
              });
            } catch {
              await gitManager.cleanTempRepo();
              selectedIndex = null;
              continue;
            }

            if (action === 'save') {
              const commitMessage = await qbkInput({
                message: 'Enter a commit message:',
                default: 'chore: save local AI config changes before switching repo',
              });

              let pushSuccess = false;
              while (!pushSuccess) {
                const spinnerSave = ora('Saving changes...').start();
                try {
                  await gitManager.commitAndPush(git, commitMessage);
                  spinnerSave.succeed('Changes saved and pushed.');
                  pushSuccess = true;
                } catch (err: any) {
                  spinnerSave.fail('Failed to push changes.');
                  logError(err.message);
                  logWarning('There may be conflicts with the remote repository.');
                  
                  let resolved: boolean;
                  try {
                    resolved = await qbkConfirm({
                      message: 'Have you resolved the conflicts manually? Confirm to try again.',
                      default: true,
                    });
                  } catch {
                    await gitManager.cleanTempRepo();
                    selectedIndex = null;
                    continue;
                  }

                  if (!resolved) {
                    logInfo('Operation cancelled.');
                    await gitManager.cleanTempRepo();
                    selectedIndex = null;
                    continue;
                  }
                }
              }
            } else {
              logInfo('Local changes discarded.');
            }
          }
        }
        await gitManager.cleanTempRepo();
      } catch (err: any) {
        spinnerStatus.stop();
        logError(err.message);
        await gitManager.cleanTempRepo();
        return false;
      }
    }

    // ─── Perform Switch ───
    const spinnerSwitch = ora(`Switching to "${targetRepo.name}"...`).start();
    try {
      const git = await gitManager.setupTempRepo(targetRepo.url, targetRepo.defaultBranch);

      // Update version to latest of target repo
      let headCommit = 'latest';
      try {
        headCommit = (await git.revparse(['HEAD'])).trim().substring(0, 7);
      } catch { /* fallback */ }

      if (selectedIndex !== null) {
        config.selectedRepoIndex = selectedIndex;
        // We reset branch and version to default/latest of the target repo when switching
        config.repositories[selectedIndex].currentBranch = targetRepo.defaultBranch;
        config.repositories[selectedIndex].currentVersion = headCommit;
      }

      await gitManager.applyToWorkspace();
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerSwitch.stop();

      logSuccessBox(
        'Repository Switched',
        `Now using "${targetRepo.name}" on branch "${targetRepo.defaultBranch}" (${headCommit}).`
      );
    } catch (err: any) {
      spinnerSwitch.fail('Failed to switch repository.');
      logError(err.message);
      await gitManager.cleanTempRepo();
    }
  }
  return false;
}
