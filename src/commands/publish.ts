import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, getSelectedRepo } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logInfo, logSuccessBox, logWarning, qbkInput, qbkConfirm } from '../utils.js';

/**
 * Command 7: Push local changes to the remote repository.
 * Only available when on the latest commit of the current branch.
 */
export async function publishCommand(cwd: string): Promise<void> {
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
  const spinner = ora('Checking for local changes...').start();

  try {
    const git = await gitManager.setupTempRepo(currentRepo.url, currentRepo.currentBranch);

    // Detect local changes against the current version (HEAD)
    const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentRepo.currentVersion);

    spinner.stop();

    if (!hasChanges) {
      logInfo('No changes detected. Your workspace is up to date with the remote.');
      await gitManager.cleanTempRepo();
      return;
    }

    // Show changed files
    logWarning('Changes detected in your workspace:');
    for (const f of files) {
      console.log(`    ${chalk.yellow('→')} ${f}`);
    }
    console.log('');

    // Ask for commit message
    let message: string;
    try {
      message = await qbkInput({
        message: 'Enter a commit message:',
        default: 'chore: update AI configuration',
      });
    } catch {
      await gitManager.cleanTempRepo();
      return; // Escape pressed
    }

    let success = false;
    while (!success) {
      const spinnerPush = ora('Pushing changes to remote...').start();
      try {
        await gitManager.commitAndPush(git, message);

        // Update the current version to the new HEAD
        let newHead = 'latest';
        try {
          newHead = (await git.revparse(['HEAD'])).trim().substring(0, 7);
        } catch { /* fallback */ }

        currentRepo.currentVersion = newHead;
        await writeConfig(cwd, config);
        await gitManager.cleanTempRepo();
        spinnerPush.stop();

        logSuccessBox('Changes Published', `Your changes have been pushed to "${currentRepo.currentBranch}" (${newHead}).`);
        success = true;
      } catch (err: any) {
        spinnerPush.fail('Failed to push changes.');
        logError(err.message);
        logWarning('There may be conflicts with the remote repository.');
        
        let resolved: boolean;
        try {
          resolved = await qbkConfirm({
            message: 'Have you resolved the conflicts manually in your files? Confirm to try pushing again.',
            default: true,
          });
        } catch {
          await gitManager.cleanTempRepo();
          return; // Escape
        }

        if (!resolved) {
          logInfo('Operation cancelled.');
          await gitManager.cleanTempRepo();
          return;
        }
      }
    }
  } catch (err: any) {
    spinner.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
