<p align="center">
  <img src="logo.png" alt="QUBIK Logo" width="300">
</p>

# QBK-AI — AI Config Manager 🤖📦

**By Javier Alejandro Sosa**

**QBK-AI** is a Command Line Interface (CLI) tool designed to manage AI agent configurations in a centralized, versioned, and flexible way. It allows you to decouple your agent's rules and "identity" from the main code repository by using dedicated Git repositories as storage backends.

---

## 🚀 What is it for?

When developing with AI agents (such as Claude, Cursor, or GitHub Copilot), behavior rules (`CLAUDE.md`, `.agents/rules/`, etc.) often change frequently. QBK-AI allows you to:

- **Profiles:** Use different Git branches to have different "personalities" or configurations for the same project (e.g., a profile for Senior Dev, another for QA, another for documentation).
- **Versions:** Go back in time to a specific configuration using Git commits.
- **Multi-Project Sync:** Share the same rules across different projects or teams by simply connecting the same repository.
- **Security and Order:** Avoid cluttering your main project's git history with constant changes to agent rules.

---

## 📋 Requirements

Before installing, make sure you have:

- **Node.js** (v18 or higher recommended).
- **Git** installed and globally configured.
- A **Git repository URL** (empty or with the basic structure) to use as storage.

---

## 🛠 Installation and Initial Configuration

You have three ways to use QBK-AI:

### A. Quick Use (Recommended)

No need to install anything permanently. Run the command directly using `npx`:

```bash
npx qbk-ai
```

### B. Local Development Installation

If you want to contribute to the code or test local changes:

1. Clone this repository.
2. Run `npm install` for dependencies.
3. Run `npm run build` to compile.
4. Run `npm link` to register the `qbk-ai` command locally.

### C. Permanent Global Installation

If you want to have the `qbk-ai` command always available in your terminal to use in any project:

```bash
# Inside the cloned project folder
npm install -g .
```

Once installed (via option B or C), simply run:

```bash
qbk-ai
```

---

## 📂 File Structure

QBK-AI manages and synchronizes the following files and folders at the root of your project:

- `CLAUDE.md`: Main instruction file for the agent.
- `AGENTS.md`: General definitions of agents.
- `.agents/`: Folder for specific rules, skills, and tools.
- `.claude/`: Environment-specific configurations.

**Important:** QBK-AI will automatically add these paths to your local `.gitignore` so they don't mix with your project's code.

---

## 🎮 Commands and Workflow

The interface is fully interactive and divided into key sections:

### 1. Change Management (Sync)

- **🚀 Push Changes:** When you modify your AI files locally, use this command to upload your changes to the remote. It will ask for a commit message to maintain history.
- **⬇ Pull Changes:** Fetch the latest version from the remote repository.
  - **Conflict Handling:** If you changed a file locally and it also changed in the remote, QBK-AI will show you an **interactive Diff** so you can choose which version to keep (local or remote).
  - **Automatic Stash:** You can choose to save your local changes temporarily (`Stash`) while fetching the new ones and then merge them back.

### 2. Navigation and Profiles

- **⇋ Switch Profile:** Switch between different branches of your configuration repository. Ideal for testing different agent strategies.
- **📋 Switch Version:** Explore the commit history and instantly activate a previous version of your rules.
- **🔄 Switch Repository:** If you manage multiple configuration repositories (e.g., one Global and one Specific), you can jump between them.

---

## 💡 Implementation Guide (Step by Step)

If you want to implement QBK-AI in a project from scratch, follow these steps:

1. **Create the storage:** Go to GitHub and create a repo called `my-ai-rules` (it can be private). Do not add a README or .gitignore when creating it.
2. **Connect the project:** In your terminal, inside your main project, run `npx qbk-ai`.
3. **Configure the repo:**
   - Select `Add Repository`.
   - Paste the URL: `https://github.com/user/my-ai-rules.git`.
   - QBK-AI will detect that it is empty and create the base files (`CLAUDE.md`, etc.).
4. **Ignore the files:** QBK-AI will update your `.gitignore`. Verify that `.agents`, `CLAUDE.md`, etc., appear.
5. **Customize:** Open `CLAUDE.md` and start writing your rules.
6. **Save:** Go back to the CLI and select `Push Changes` to save your first version.

---

## ⚠️ Things to Keep in Mind

- **Do not delete `.ai-config.json`:** This file stores which repository and version you are using locally. It is vital for the tool to work.
- **Escape to exit:** In any interactive menu, you can press `ESC` to go back or cancel an operation.
- **Git Dependency:** QBK-AI uses Git internally. Make sure you have `git` installed and configured in your terminal.
- **Conflicts:** The conflict resolution system is per complete file. In future versions, a deeper line-by-line merge integration is planned.

---

## 🎨 Visual Customization

QBK-AI uses an enriched console interface with colors and animations to make configuration management a premium and clear experience.

- **Green (●):** Indicates the active repository or profile.
- **Cyan:** Used for versions and commit hashes.
- **Yellow:** Critical alerts and confirmations.

---

---

Made with ❤️ by **Javier Alejandro Sosa**
