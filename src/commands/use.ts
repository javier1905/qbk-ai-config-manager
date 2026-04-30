import { readConfig, writeConfig } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logSuccess, copyAiFiles, TEMP_DIR, validateStructure } from '../utils.js';
import ora from 'ora';
import path from 'path';
import { select } from '@inquirer/prompts';
import simpleGit from 'simple-git';

export async function useCommand(cwd: string, targetVersion?: string) {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Run "qbk-ia init" first.');
    return;
  }

  const gitManager = new GitManager(cwd);
  let spinner = ora('Fetching repository...').start();
  
  try {
    const git = await gitManager.setupTempRepo(config.repo, config.branch);
    
    if (!targetVersion) {
      spinner.stop();
      const { tags, commits } = await gitManager.getVersions(git);
      
      const choices = [];
      for (const t of tags) choices.push({ name: `Tag: ${t}`, value: t });
      for (const c of commits) choices.push({ name: `Commit: ${c.hash.substring(0, 7)} - ${c.message}`, value: c.hash });
      
      if (choices.length === 0) {
        logError('No versions found.');
        await gitManager.cleanTempRepo();
        return;
      }
      
      targetVersion = await select({
        message: 'Select a version to use:',
        choices
      });
      spinner = ora('Applying version...').start();
    }

    await git.checkout(targetVersion as string);
    const tempPath = path.join(cwd, TEMP_DIR);
    
    spinner.text = 'Validating structure...';
    await validateStructure(tempPath);
    
    // Copy the specific files
    await copyAiFiles(tempPath, cwd);
    
    // Update config
    config.version = targetVersion as string;
    await writeConfig(cwd, config);
    
    spinner.text = 'Cleaning up...';
    await gitManager.cleanTempRepo();
    
    spinner.succeed(`Successfully applied version: ${targetVersion}`);
  } catch (err: any) {
    if (spinner.isSpinning) spinner.fail('Failed to use version');
    logError(err.message);
  }
}
