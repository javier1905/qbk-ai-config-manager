import fs from 'fs/promises';
import path from 'path';
import { CONFIG_FILE, PROFILES_FILE, checkFileExists } from './utils.js';

export interface AiConfig {
  repo: string;
  branch: string;
  version: string;
}

export interface Profile {
  name: string;
  version: string;
}

export async function readConfig(cwd: string): Promise<AiConfig | null> {
  const configPath = path.join(cwd, CONFIG_FILE);
  if (!(await checkFileExists(configPath))) {
    return null;
  }
  
  const content = await fs.readFile(configPath, 'utf8');
  return JSON.parse(content);
}

export async function writeConfig(cwd: string, config: AiConfig): Promise<void> {
  const configPath = path.join(cwd, CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function readProfiles(cwd: string): Promise<Profile[]> {
  const profilesPath = path.join(cwd, PROFILES_FILE);
  if (!(await checkFileExists(profilesPath))) {
    return [];
  }
  
  const content = await fs.readFile(profilesPath, 'utf8');
  return JSON.parse(content);
}

export async function writeProfiles(cwd: string, profiles: Profile[]): Promise<void> {
  const profilesPath = path.join(cwd, PROFILES_FILE);
  await fs.writeFile(profilesPath, JSON.stringify(profiles, null, 2), 'utf8');
}
