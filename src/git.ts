import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { TEMP_DIR, AI_FILES, checkFileExists } from './utils.js';

export class GitManager {
  private cwd: string;
  private tempDir: string;
  private rootGit: SimpleGit;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.tempDir = path.join(cwd, TEMP_DIR);
    this.rootGit = simpleGit(cwd);
  }

  async verifyConnection(repoUrl: string): Promise<boolean> {
    try {
      // Just listing remotes requires no cloning and verifies we can access it
      await simpleGit().listRemote([repoUrl]);
      return true;
    } catch (e) {
      return false;
    }
  }

  async setupTempRepo(repoUrl: string, branch?: string): Promise<SimpleGit> {
    const tempGitDir = path.join(this.tempDir, '.git');
    const isGitRepo = await checkFileExists(tempGitDir);
    const options = branch ? ['-b', branch] : [];
    
    if (!isGitRepo) {
      await fs.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(this.tempDir, { recursive: true });
      const git = simpleGit(this.tempDir);
      await git.clone(repoUrl, '.', options);
      return git;
    } else {
      const git = simpleGit(this.tempDir);
      try {
        await git.fetch();
        if (branch) {
          await git.checkout(branch);
        }
        await git.pull();
      } catch (err) {
        // If it fails, recreate it
        await fs.rm(this.tempDir, { recursive: true, force: true });
        await fs.mkdir(this.tempDir, { recursive: true });
        const newGit = simpleGit(this.tempDir);
        await newGit.clone(repoUrl, '.', options);
        return newGit;
      }
      return git;
    }
  }

  async cleanTempRepo(): Promise<void> {
    if (await checkFileExists(this.tempDir)) {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    }
  }

  async hasLocalChangesInRoot(): Promise<boolean> {
    const status = await this.rootGit.status();
    // Check if any modified file starts with our managed paths
    return status.files.some(file => {
      return AI_FILES.some(managedFile => file.path === managedFile || file.path.startsWith(`${managedFile}/`));
    });
  }
  
  async getLocalGitInfo(): Promise<{ hasChanges: boolean; commit: string }> {
    const hasChanges = await this.hasLocalChangesInRoot();
    let commit = '';
    try {
        commit = await this.rootGit.revparse(['HEAD']);
    } catch {
        commit = 'none';
    }
    return { hasChanges, commit };
  }

  async commitAndPushTemp(message: string): Promise<void> {
    const git = simpleGit(this.tempDir);
    await git.add('.');
    await git.commit(message);
    await git.push();
  }

  async getVersions(git: SimpleGit): Promise<{ tags: string[], commits: any[] }> {
    let tags: string[] = [];
    try {
      const tagsData = await git.tags();
      tags = tagsData.all.reverse();
    } catch (e) {
      // no tags
    }

    let commits: any[] = [];
    try {
      const log = await git.log({ maxCount: 10 });
      commits = log.all as any[];
    } catch (e) {
      // no commits
    }

    return { tags, commits };
  }
}
