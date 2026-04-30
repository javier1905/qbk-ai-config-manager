import { readConfig } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logInfo, logSuccess, logWarning, TEMP_DIR } from '../utils.js';
import ora from 'ora';
import path from 'path';
import simpleGit from 'simple-git';

export async function statusCommand(cwd: string) {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Run "qbk-ia init" first.');
    return;
  }

  const spinner = ora('Checking status...').start();
  const gitManager = new GitManager(cwd);

  try {
    const git = await gitManager.setupTempRepo(config.repo, config.branch);
    
    // Check if there are local modifications in the root directory for managed files
    const { hasChanges } = await gitManager.getLocalGitInfo();
    
    // Compare remote vs current branch if we had a way to know what was synced
    // Since we just copy files, we don't track the exact commit in root, 
    // but we can check if there are differences between the temp repo and our root files.
    
    // A simplified approach for now:
    spinner.stop();
    
    if (hasChanges) {
      logWarning('You have uncommitted local changes to your AI configuration files.');
    } else {
      logSuccess('Working tree for AI config files is clean.');
    }

    // TODO: Advanced diffing between root files and tempRepo's HEAD to indicate "X commits behind" or "out of sync"
    // Since we copied files over, we can use `git diff` with `--no-index` or manually compare, but simpler is
    // checking if we stored the last synced commit. For now, this is a basic status.
    
    await gitManager.cleanTempRepo();
  } catch (err: any) {
    spinner.fail('Failed to check status');
    logError(err.message);
  }
}
