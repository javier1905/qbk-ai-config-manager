import { readConfig } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logSuccess, logInfo, copyAiFiles, TEMP_DIR, validateStructure } from '../utils.js';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import ora from 'ora';

export async function syncCommand(cwd: string) {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Run "qbk-ia init" first.');
    return;
  }

  const spinner = ora('Fetching remote configuration...').start();
  const gitManager = new GitManager(cwd);
  
  try {
    const git = await gitManager.setupTempRepo(config.repo, config.branch);
    const tempPath = path.join(cwd, TEMP_DIR);

    spinner.text = 'Validating structure...';
    await validateStructure(tempPath);

    // To check for local changes, we can copy current local files to temp and see if git detects changes
    // But we don't want to mess up the temp git state before we are sure.
    // Instead, we check if copying from temp to local would overwrite anything different.
    
    // A simpler way: we always clone the temp repo.
    // We can use git status in the temp repo by copying local files INTO it (without committing).
    
    // 1. Save temp state (checkout HEAD)
    await git.checkout(['.']); 
    
    // 2. Temporarily copy LOCAL files into TEMP repo to see differences
    await copyAiFiles(cwd, tempPath);
    
    const status = await git.status();
    const hasLocalDifferences = status.files.length > 0;

    spinner.stop();

    if (hasLocalDifferences) {
      logInfo('Your local AI configuration files differ from the remote repository.');
      const shouldOverwrite = await confirm({ message: 'Do you want to overwrite your local changes with the remote version?' });
      if (!shouldOverwrite) {
        logInfo('Sync aborted.');
        await gitManager.cleanTempRepo();
        return;
      }
    }

    spinner.start('Applying remote configuration...');
    
    // Reset temp repo to clean state (remote state)
    await git.checkout(['.']);
    await git.clean('f', ['-d']);
    
    // Copy from TEMP to LOCAL
    await copyAiFiles(tempPath, cwd);
    
    spinner.text = 'Cleaning up...';
    await gitManager.cleanTempRepo();
    
    spinner.succeed('Configuration synchronized successfully.');
  } catch (error: any) {
    if (spinner.isSpinning) spinner.fail('Failed to synchronize configuration.');
    logError(error.message);
    await gitManager.cleanTempRepo();
  }
}
