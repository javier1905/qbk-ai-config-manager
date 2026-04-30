import { input } from '@inquirer/prompts';
import fs from 'fs/promises';
import path from 'path';
import { readConfig, writeConfig } from '../config.js';
import { checkFileExists, AI_FILES, logSuccess, logInfo, logError, validateStructure, TEMP_DIR } from '../utils.js';
import { GitManager } from '../git.js';
import ora from 'ora';

export async function initCommand(cwd: string) {
  let config = await readConfig(cwd);
  
  if (config) {
    logInfo('Configuration .ai-config.json already exists.');
  } else {
    const repoUrl = await input({ message: 'Enter the Git repository URL for the AI configurations:' });
    
    const spinner = ora('Verifying connection to repository...').start();
    const gitManager = new GitManager(cwd);
    const connected = await gitManager.verifyConnection(repoUrl);
    
    if (!connected) {
      spinner.fail('Connection failed');
      logError('Could not connect to the provided Git repository. Initialization aborted.');
      return;
    }
    
    spinner.succeed('Connection successful');
    
    spinner.start('Validating repository structure...');
    const tempPath = path.join(cwd, TEMP_DIR);
    let defaultBranch = 'main';

    try {
      const tempGit = await gitManager.setupTempRepo(repoUrl);
      
      try {
        defaultBranch = await tempGit.revparse(['--abbrev-ref', 'HEAD']);
      } catch (e) {
        // fallback to main
      }

      try {
        await validateStructure(tempPath);
        spinner.succeed(`Repository structure is valid (branch: ${defaultBranch})`);
      } catch (err: any) {
        spinner.warn('Missing AI configuration files. Creating them automatically...');
        
        const initSpinner = ora('Creating files and pushing to repository...').start();
        // Create files and directories in tempPath
        await fs.mkdir(path.join(tempPath, '.agents'), { recursive: true });
        await fs.writeFile(path.join(tempPath, '.agents', '.gitkeep'), '', 'utf8');
        await fs.mkdir(path.join(tempPath, '.claude'), { recursive: true });
        await fs.writeFile(path.join(tempPath, '.claude', '.gitkeep'), '', 'utf8');
        await fs.writeFile(path.join(tempPath, 'AGENTS.md'), '# AI Agents Configuration\n', 'utf8');
        await fs.writeFile(path.join(tempPath, 'CLAUDE.md'), '# Claude Configuration\n', 'utf8');
        
        await gitManager.commitAndPushTemp('feat: initialize AI config structure');
        initSpinner.succeed('Files created and pushed to remote repository');
      }
    } catch (err: any) {
      spinner.fail('Failed to process remote repository');
      logError(err.message);
      await gitManager.cleanTempRepo();
      return;
    }

    await gitManager.cleanTempRepo();
    
    config = {
      repo: repoUrl,
      branch: defaultBranch,
      version: 'latest'
    };
    
    await writeConfig(cwd, config);
    logSuccess('Created .ai-config.json');
  }

  // Add to .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  let gitignoreContent = '';
  if (await checkFileExists(gitignorePath)) {
    gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
  }

  let appended = false;
  for (const file of AI_FILES) {
    if (!gitignoreContent.includes(file)) {
      gitignoreContent += `\n${file}`;
      appended = true;
    }
  }

  if (appended) {
    await fs.writeFile(gitignorePath, gitignoreContent, 'utf8');
    logSuccess('Updated .gitignore to ignore AI configuration files.');
  } else {
    logInfo('.gitignore already contains AI files.');
  }
}
