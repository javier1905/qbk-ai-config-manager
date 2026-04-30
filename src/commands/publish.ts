import { readConfig } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logSuccess, copyAiFiles, TEMP_DIR } from '../utils.js';
import ora from 'ora';
import path from 'path';
import { input } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';

export async function publishCommand(cwd: string) {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Run "qbk-ia init" first.');
    return;
  }

  const gitManager = new GitManager(cwd);
  const spinner = ora('Checking for changes...').start();
  
  try {
    const git = await gitManager.setupTempRepo(config.repo, config.branch);
    const tempPath = path.join(cwd, TEMP_DIR);
    
    // Copy the specific files from ROOT to TEMP
    await copyAiFiles(cwd, tempPath);
    
    // Detect changes in the temp repo
    const status = await git.status();
    const hasChanges = status.files.length > 0;

    spinner.stop();

    if (!hasChanges) {
      logError('No local changes detected in AI files compared to the remote repository.');
      await gitManager.cleanTempRepo();
      return;
    }

    const message = await input({ message: 'Enter commit message for the new version:' });
    spinner.start('Publishing changes...');
    
    spinner.text = 'Committing and pushing...';
    await gitManager.commitAndPushTemp(message);
    
    spinner.text = 'Cleaning up...';
    await gitManager.cleanTempRepo();
    
    spinner.succeed('Changes published successfully to remote repository.');
  } catch (err: any) {
    if (spinner.isSpinning) spinner.fail('Failed to publish changes');
    logError(err.message);
    await gitManager.cleanTempRepo();
  }
}
