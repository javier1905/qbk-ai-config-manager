import chalk from 'chalk';
import ora from 'ora';
import { readConfig, writeConfig, getSelectedRepo } from '../config.js';
import { GitManager } from '../git.js';
import { logSuccess, logError, logInfo, logSuccessBox, logWarning, logSkull, qbkInput, qbkSelect, qbkConfirm } from '../utils.js';

/**
 * Command 6: Switch version (commit).
 *
 * Flow:
 * 1. Show commits, user selects one.
 * 2. If NOT on latest commit → warn that local changes will be discarded → yes/no.
 * 3. If ON latest commit → check for local changes:
 *    - No changes → switch directly.
 *    - Has changes → ask save or discard:
 *      - Discard → switch.
 *      - Save → commit & push, then switch.
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

    // Check if user is on the latest commit
    const latestHash = commits[0].hash;
    const isOnLatest = currentRepo.currentVersion === 'latest' ||
      latestHash.startsWith(currentRepo.currentVersion);

    // ─── Commit selection loop (Escape goes back to main menu) ───
    let selectedCommit: string | null = null;

    while (selectedCommit === null) {
      const choices = commits.map(commit => {
        const short = commit.hash.substring(0, 7);
        const isCurrent = short === currentRepo.currentVersion || commit.hash.startsWith(currentRepo.currentVersion);
        return {
          name: `${isCurrent ? chalk.green('● ') : '  '}${chalk.cyan(short)} ${chalk.white(commit.message)} ${chalk.dim(`(${new Date(commit.date).toLocaleDateString()})`)}`,
          value: commit.hash,
        };
      });

      try {
        selectedCommit = await qbkSelect({
          message: `Versions for profile "${currentRepo.currentBranch}":`,
          choices,
          pageSize: 15,
        });
      } catch {
        // Escape pressed → back to main menu
        await gitManager.cleanTempRepo();
        return;
      }

      if (selectedCommit === null) {
        await gitManager.cleanTempRepo();
        return;
      }

      const shortHash = selectedCommit.substring(0, 7);

      // Already on this version
      if (shortHash === currentRepo.currentVersion || selectedCommit.startsWith(currentRepo.currentVersion)) {
        logInfo('Already on this version.');
        await gitManager.cleanTempRepo();
        return;
      }

      // ─── Case A: NOT on the latest commit ───
      if (!isOnLatest) {
        logSkull();
        logWarning('You are not on the latest commit of this branch.');
        logInfo('Any local changes you may have will be discarded because you cannot push from an old version.');

        let shouldContinue: boolean;
        try {
          shouldContinue = await qbkConfirm({
            message: 'Do you want to discard local changes and switch version?',
            default: false,
          });
        } catch {
          await gitManager.cleanTempRepo();
          return; // Escape
        }

        if (!shouldContinue) {
          // Go back to commit list
          selectedCommit = null;
          continue;
        }

        // Discard and switch
        const spinnerSwitch = ora(`Switching to version ${shortHash}...`).start();
        await gitManager.checkoutCommit(git, selectedCommit);
        currentRepo.currentVersion = shortHash;
        await gitManager.applyToWorkspace();
        await writeConfig(cwd, config);
        await gitManager.cleanTempRepo();
        spinnerSwitch.stop();

        const selectedMsg = commits.find(c => c.hash === selectedCommit)?.message || '';
        logSuccessBox('Version Switched', `Now on version ${shortHash}: "${selectedMsg}"`);
        return;
      }

      // ─── Case B: ON the latest commit ───
      // Detect local changes against the current version
      const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentRepo.currentVersion);

      if (!hasChanges) {
        // No changes → switch directly
        const spinnerSwitch = ora(`Switching to version ${shortHash}...`).start();
        await gitManager.checkoutCommit(git, selectedCommit);
        currentRepo.currentVersion = shortHash;
        await gitManager.applyToWorkspace();
        await writeConfig(cwd, config);
        await gitManager.cleanTempRepo();
        spinnerSwitch.stop();

        const selectedMsg = commits.find(c => c.hash === selectedCommit)?.message || '';
        logSuccessBox('Version Switched', `Now on version ${shortHash}: "${selectedMsg}"`);
        return;
      }

      // Has changes → ask save or discard
      logSkull();
      logWarning('You have local changes that differ from the current version:');
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
        return; // Escape
      }

      if (action === 'discard') {
        // Discard and switch
        const spinnerSwitch = ora(`Switching to version ${shortHash}...`).start();
        // Reset temp to clean state before checkout
        await git.checkout(['.']);
        await git.clean('f', ['-d']);
        await gitManager.checkoutCommit(git, selectedCommit);
        currentRepo.currentVersion = shortHash;
        await gitManager.applyToWorkspace();
        await writeConfig(cwd, config);
        await gitManager.cleanTempRepo();
        spinnerSwitch.stop();

        const selectedMsg = commits.find(c => c.hash === selectedCommit)?.message || '';
        logSuccessBox('Version Switched', `Changes discarded. Now on version ${shortHash}: "${selectedMsg}"`);
        return;
      }

      // Save changes: commit & push first, then switch
      let commitMessage: string;
      try {
        commitMessage = await qbkInput({
          message: 'Enter a commit message:',
          default: 'chore: save local AI config changes',
        });
      } catch {
        await gitManager.cleanTempRepo();
        return; // Escape
      }

      let success = false;
      while (!success) {
        const spinnerSave = ora('Saving changes...').start();
        try {
          await gitManager.commitAndPush(git, commitMessage);
          spinnerSave.succeed('Changes saved and pushed.');
          success = true;
        } catch (err: any) {
          spinnerSave.fail('Failed to push changes.');
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
          // If resolved, the loop continues and tries to commit/push again
          // Note: commitAndPush will re-add files and try a new commit/push
        }
      }

      // Now switch to the selected commit
      const spinnerSwitch = ora(`Switching to version ${shortHash}...`).start();
      await gitManager.checkoutCommit(git, selectedCommit);
      currentRepo.currentVersion = shortHash;
      await gitManager.applyToWorkspace();
      await writeConfig(cwd, config);
      await gitManager.cleanTempRepo();
      spinnerSwitch.stop();

      const selectedMsg = commits.find(c => c.hash === selectedCommit)?.message || '';
      logSuccessBox('Version Switched', `Changes saved. Now on version ${shortHash}: "${selectedMsg}"`);
      return;
    }
  } catch (err: any) {
    spinner.stop();
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
