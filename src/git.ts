import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { TEMP_DIR, AI_FILES, checkFileExists } from './utils.js';

export class GitManager {
  private cwd: string;
  private tempDir: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.tempDir = path.join(cwd, TEMP_DIR);
  }

  // ─── Connection ──────────────────────────────────────────────

  /**
   * Verify that a remote URL is reachable.
   */
  async verifyConnection(repoUrl: string): Promise<boolean> {
    try {
      await simpleGit().listRemote([repoUrl]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a remote repository is empty (has no refs).
   */
  async isRepoEmpty(repoUrl: string): Promise<boolean> {
    try {
      const result = await simpleGit().listRemote([repoUrl]);
      return result.trim().length === 0;
    } catch {
      return true;
    }
  }

  // ─── Temp Repo Management ───────────────────────────────────

  /**
   * Clone or reuse a temp repo for the given URL and optional branch.
   */
  async setupTempRepo(repoUrl: string, branch?: string): Promise<SimpleGit> {
    await fs.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(this.tempDir, { recursive: true });
    const git = simpleGit(this.tempDir);
    const options = branch ? ['-b', branch] : [];
    await git.clone(repoUrl, '.', options);
    return git;
  }

  /**
   * Get the SimpleGit instance for the existing temp repo.
   */
  getTempGit(): SimpleGit {
    return simpleGit(this.tempDir);
  }

  /**
   * Clean up the temp repo directory.
   */
  async cleanTempRepo(): Promise<void> {
    if (await checkFileExists(this.tempDir)) {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    }
  }

  get tempPath(): string {
    return this.tempDir;
  }

  // ─── Branch (Profile) Operations ────────────────────────────

  /**
   * Detect the default branch of a remote repo (main or master).
   */
  async detectDefaultBranch(repoUrl: string): Promise<string> {
    try {
      const refs = await simpleGit().listRemote(['--symref', 'HEAD', repoUrl]);
      if (refs.includes('refs/heads/main')) return 'main';
      if (refs.includes('refs/heads/master')) return 'master';
      // Fallback: try to parse from the ref list
      const allRefs = await simpleGit().listRemote(['--heads', repoUrl]);
      if (allRefs.includes('refs/heads/main')) return 'main';
      if (allRefs.includes('refs/heads/master')) return 'master';
      return 'main';
    } catch {
      return 'main';
    }
  }

  /**
   * Get all remote branches (profiles) for a repo.
   */
  async getRemoteBranches(repoUrl: string): Promise<string[]> {
    try {
      const refs = await simpleGit().listRemote(['--heads', repoUrl]);
      const branches: string[] = [];
      for (const line of refs.split('\n')) {
        const match = line.match(/refs\/heads\/(.+)$/);
        if (match) {
          branches.push(match[1]);
        }
      }
      return branches;
    } catch {
      return [];
    }
  }

  /**
   * Create a new branch in the temp repo and push it to remote.
   * If fromBranch is provided, the new branch is created from that branch.
   * If blank is true, an orphan branch is created with the base structure.
   */
  async createBranch(
    git: SimpleGit,
    branchName: string,
    options: { blank?: boolean; fromBranch?: string }
  ): Promise<void> {
    if (options.blank) {
      // Create orphan branch
      await git.checkout(['--orphan', branchName]);
      await git.rm(['-rf', '.']);
      // Create base structure
      await this.seedBaseStructure();
      await git.add('.');
      await git.commit('feat: initialize AI config structure');
      await git.push(['-u', 'origin', branchName]);
    } else if (options.fromBranch) {
      await git.checkout(['-b', branchName, `origin/${options.fromBranch}`]);
      await git.push(['-u', 'origin', branchName]);
    }
  }

  /**
   * Delete a branch both locally (temp) and on the remote.
   */
  async deleteBranch(git: SimpleGit, branchName: string): Promise<void> {
    // Delete remote branch
    await git.push(['origin', '--delete', branchName]);
  }

  // ─── Commit (Version) Operations ────────────────────────────

  /**
   * Get commit history for the current branch in the temp repo.
   */
  async getCommits(git: SimpleGit, maxCount: number = 20): Promise<Array<{ hash: string; date: string; message: string; author: string }>> {
    try {
      const log = await git.log({ maxCount });
      return log.all.map((c: any) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author: c.author_name || c.author_email || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Checkout a specific commit in the temp repo.
   */
  async checkoutCommit(git: SimpleGit, commitHash: string): Promise<void> {
    await git.checkout(commitHash);
  }

  /**
   * Check if the given short hash matches the latest commit (HEAD) of the branch.
   */
  async isOnLatestCommit(repoUrl: string, branch: string, currentVersion: string): Promise<boolean> {
    if (currentVersion === 'latest') return true;
    try {
      const refs = await simpleGit().listRemote(['--heads', repoUrl]);
      for (const line of refs.split('\n')) {
        if (line.includes(`refs/heads/${branch}`)) {
          const remoteHash = line.split('\t')[0].trim();
          return remoteHash.startsWith(currentVersion);
        }
      }
      return true; // fallback
    } catch {
      return true;
    }
  }

  // ─── Change Detection ───────────────────────────────────────

  /**
   * Check if local AI files differ from what's in the temp repo.
   * If commitHash is provided, compares against that specific commit.
   * Copies local files into temp, runs git status, then restores temp.
   */
  async detectLocalChanges(git: SimpleGit, commitHash?: string, branch?: string): Promise<{ hasChanges: boolean; files: string[] }> {
    // Checkout the specific commit the user is on (if provided)
    if (commitHash && commitHash !== 'latest') {
      try {
        await git.checkout(commitHash);
      } catch {
        // If short hash, try matching
        try {
          const log = await git.log({ maxCount: 50 });
          const match = log.all.find((c: any) => c.hash.startsWith(commitHash));
          if (match) {
            await git.checkout(match.hash);
          }
        } catch { /* fallback to current HEAD */ }
      }
    }

    // Save clean state
    await git.checkout(['.']);
    await git.clean('f', ['-d']);

    // Copy local AI files into temp
    await this.copyAiFilesTo(this.cwd, this.tempDir);

    const status = await git.status();
    const changedFiles = status.files.map(f => f.path);

    // Restore clean state
    await git.checkout(['.']);
    await git.clean('f', ['-d']);

    // Restore branch to avoid leaving git in detached HEAD state
    if (commitHash && commitHash !== 'latest' && branch) {
      await git.checkout(branch);
    }

    return { hasChanges: changedFiles.length > 0, files: changedFiles };
  }

  /**
   * Commit local changes to the temp repo and push.
   */
  async commitAndPush(git: SimpleGit, message: string): Promise<void> {
    // Copy local AI files into temp
    await this.copyAiFilesTo(this.cwd, this.tempDir);
    await git.add('.');
    await git.commit(message);
    await git.push();
  }

  /**
   * Apply AI files from the temp repo to the local workspace.
   */
  async applyToWorkspace(): Promise<void> {
    await this.copyAiFilesTo(this.tempDir, this.cwd);
  }

  // ─── Structure ──────────────────────────────────────────────

  /**
   * Validate that a directory contains the required AI file structure.
   */
  async validateStructure(dir?: string): Promise<boolean> {
    const targetDir = dir || this.tempDir;
    for (const item of AI_FILES) {
      const itemPath = path.join(targetDir, item);
      if (!(await checkFileExists(itemPath))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create the base AI file structure in the temp directory.
   */
  async seedBaseStructure(dir?: string): Promise<void> {
    const targetDir = dir || this.tempDir;
    await fs.mkdir(path.join(targetDir, '.agents'), { recursive: true });
    await fs.writeFile(path.join(targetDir, '.agents', '.gitkeep'), '', 'utf8');
    await fs.mkdir(path.join(targetDir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(targetDir, '.claude', '.gitkeep'), '', 'utf8');
    await fs.writeFile(path.join(targetDir, 'AGENTS.md'), '# AI Agents Configuration\n', 'utf8');
    await fs.writeFile(path.join(targetDir, 'CLAUDE.md'), '# Claude Configuration\n', 'utf8');
  }

  // ─── Internal Helpers ───────────────────────────────────────

  private async copyAiFilesTo(srcDir: string, destDir: string): Promise<void> {
    const { existsSync } = await import('fs');
    for (const item of AI_FILES) {
      const srcPath = path.join(srcDir, item);
      const destPath = path.join(destDir, item);
      if (existsSync(srcPath)) {
        await fs.rm(destPath, { recursive: true, force: true }).catch(() => {});
        await fs.cp(srcPath, destPath, { recursive: true, force: true, dereference: false });
      }
    }
  }
}
