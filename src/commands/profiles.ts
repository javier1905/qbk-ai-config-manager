import { readProfiles, writeProfiles } from '../config.js';
import { logError, logSuccess, logInfo } from '../utils.js';
import { input } from '@inquirer/prompts';
import { useCommand } from './use.js';

export async function profileCreateCommand(cwd: string) {
  const profiles = await readProfiles(cwd);
  
  const name = await input({ message: 'Enter profile name:' });
  if (profiles.some(p => p.name === name)) {
    logError(`Profile '${name}' already exists.`);
    return;
  }
  
  const version = await input({ message: 'Enter version/tag/commit for this profile:' });
  
  profiles.push({ name, version });
  await writeProfiles(cwd, profiles);
  logSuccess(`Profile '${name}' created pointing to version '${version}'.`);
}

export async function profileUseCommand(cwd: string, name?: string) {
  const profiles = await readProfiles(cwd);
  if (profiles.length === 0) {
    logError('No profiles found.');
    return;
  }

  if (!name) {
    name = await input({ message: 'Enter profile name to use:' });
  }

  const profile = profiles.find(p => p.name === name);
  if (!profile) {
    logError(`Profile '${name}' not found.`);
    return;
  }

  logInfo(`Applying profile '${name}' (version: ${profile.version})...`);
  await useCommand(cwd, profile.version);
}
