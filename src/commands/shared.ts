import chalk from 'chalk';
import ora from 'ora';
import type { SimpleGit } from 'simple-git';
import { GitManager } from '../git.js';
import { logInfo, logSuccess, logError, logWarning, logSkull, qbkInput, qbkSelect } from '../utils.js';

/**
 * Handles the "Save or Discard" flow that is shared across
 * switching repos, profiles (branches), and versions (commits).
 *
 * Returns 'saved' | 'discarded' | 'cancelled'
 */
export async function handlePendingChanges(
  gitManager: GitManager,
  git: SimpleGit,
  currentVersion?: string,
): Promise<'saved' | 'discarded' | 'cancelled'> {
  const spinnerDetect = ora('Checking for local changes...').start();
  const { hasChanges, files } = await gitManager.detectLocalChanges(git, currentVersion);
  spinnerDetect.stop();

  if (!hasChanges) {
    return 'saved'; // Nothing to handle
  }

  logSkull();
  logWarning('You have local changes that differ from the current version:');
  for (const f of files) {
    console.log(`    ${chalk.yellow('→')} ${f}`);
  }

  try {
    const action = await qbkSelect({
      message: 'What do you want to do with your local changes?',
      choices: [
        { name: `${chalk.green('💾')}  Save changes (commit & push)`, value: 'save' },
        { name: `${chalk.red('🗑')}   Discard changes`, value: 'discard' },
      ],
    });

    if (action === 'save') {
      const message = await qbkInput({
        message: 'Enter a commit message:',
        default: 'chore: save local AI config changes',
      });

      const spinner = ora('Saving changes...').start();
      try {
        await gitManager.commitAndPush(git, message);
        spinner.succeed('Changes saved and pushed.');
        return 'saved';
      } catch (err: any) {
        spinner.fail('Failed to push changes.');
        logError(err.message);
        logWarning('There may be conflicts with the remote. Please resolve them manually.');
        return 'cancelled';
      }
    } else {
      logInfo('Local changes discarded.');
      return 'discarded';
    }
  } catch {
    // User pressed Escape
    return 'cancelled';
  }
}
