import { readConfig } from '../config.js';
import { GitManager } from '../git.js';
import { logError, logSuccess, TEMP_DIR } from '../utils.js';
import ora from 'ora';

export async function versionsCommand(cwd: string) {
  const config = await readConfig(cwd);
  if (!config) {
    logError('No configuration found. Run "qbk-ia init" first.');
    return;
  }

  const spinner = ora('Fetching versions...').start();
  const gitManager = new GitManager(cwd);

  try {
    const git = await gitManager.setupTempRepo(config.repo, config.branch);
    const { tags, commits } = await gitManager.getVersions(git);
    
    spinner.stop();
    
    console.log('\nAvailable Versions:');
    
    if (tags.length > 0) {
      tags.forEach(tag => console.log(`  🏷️  ${tag}`));
    }
    
    if (commits.length > 0) {
      console.log('\nRecent Commits:');
      commits.forEach(c => console.log(`  commit: ${c.hash.substring(0, 7)} - ${c.message}`));
    }
    
    await gitManager.cleanTempRepo();
  } catch (err: any) {
    spinner.fail('Failed to fetch versions');
    logError(err.message);
  }
}
