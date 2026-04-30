#!/usr/bin/env node

import { Command } from "commander";
import { select, Separator, input } from "@inquirer/prompts";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { versionsCommand } from "./commands/versions.js";
import { useCommand } from "./commands/use.js";
import {
  profileCreateCommand,
  profileUseCommand,
} from "./commands/profiles.js";
import { publishCommand } from "./commands/publish.js";
import { readConfig } from "./config.js";
import chalk from "chalk";
import readline from "readline";

const program = new Command();
const cwd = process.cwd();

// Setup global keypress listener for Escape
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (str, key) => {
    if (key.name === "escape") {
      console.clear();
      console.log(chalk.gray("\n  Goodbye! 👋\n"));
      process.exit(0);
    }
    // Handle Ctrl+C manually since raw mode is on
    if (key.ctrl && key.name === "c") {
      console.clear();
      process.exit(0);
    }
  });
}

program.name("qbk-ia").description("AI Config Manager").version("1.1.0");

// Header UI (Big Banner Style)
function printHeader(config: any) {
  console.clear();

  const bigLogo = `
  ${chalk.white.bold(" ██████   ██    ██  ██████   ██  ██   ██")}
  ${chalk.white.bold("██    ██  ██    ██  ██   ██  ██  ██  ██")}
  ${chalk.white.bold("██    ██  ██    ██  ██████   ██  █████")}
  ${chalk.white.bold("██ ▄▄ ██  ██    ██  ██   ██  ██  ██  ██")}
  ${chalk.white.bold(" ██████    ██████   ██████   ██  ██   ██")}
  ${chalk.white.bold("    ▀▀")}
  ${chalk.hex("#FF8C00").bold("       A I   C O N F I G   M A N A G E R")}
  `;

  const infoLines = [
    `${chalk.green.bold("Project:")}  ${chalk.white("qbk-ia AI Config Manager")}`,
    `${chalk.green.bold("Repo:")}     ${config ? chalk.blue(config.repo) : chalk.dim("None")}`,
    `${chalk.green.bold("Branch:")}   ${config ? chalk.yellow(config.branch || "master") : chalk.dim("N/A")}`,
    `${chalk.green.bold("Status:")}   ${config ? chalk.green("Linked") : chalk.red("Not Initialized")}`,
    `${chalk.green.bold("CLI Ver:")}  ${chalk.white("1.1.0")}`,
  ];

  console.log(bigLogo);
  console.log(
    `  ${chalk.bgBlack("  ")}${chalk.bgRed("  ")}${chalk.bgGreen("  ")}${chalk.bgYellow("  ")}${chalk.bgBlue("  ")}${chalk.bgMagenta("  ")}${chalk.bgCyan("  ")}${chalk.bgWhite("  ")}`,
  );
  console.log(
    `\n${chalk.gray("──────────────────────────────────────────────────────")}`,
  );

  infoLines.forEach((line) => console.log(`  ${line}`));

  console.log(
    `${chalk.gray("──────────────────────────────────────────────────────")}\n`,
  );
}

program
  .command("init")
  .description("Initialize AI configuration")
  .action(() => initCommand(cwd));

program
  .command("sync")
  .description("Synchronize AI configuration from remote")
  .action(() => syncCommand(cwd));

program
  .command("status")
  .description("Check status of local AI configuration")
  .action(() => statusCommand(cwd));

program
  .command("versions")
  .description("List available versions/tags/commits")
  .action(() => versionsCommand(cwd));

program
  .command("use")
  .description("Use a specific version")
  .argument("[version]", "Version to use")
  .action((version) => useCommand(cwd, version));

const profileCmd = program.command("profile").description("Manage profiles");

profileCmd
  .command("create")
  .description("Create a new profile")
  .action(() => profileCreateCommand(cwd));

profileCmd
  .command("use")
  .description("Use an existing profile")
  .argument("[name]", "Profile name to use")
  .action((name) => profileUseCommand(cwd, name));

program
  .command("publish")
  .description("Publish local changes to the AI repository")
  .action(() => publishCommand(cwd));

// Interactive Menu
async function showMenu() {
  while (true) {
    const config = await readConfig(cwd);
    const isConfigured = config !== null;

    printHeader(config);

    const choices = [
      {
        name: `${chalk.bold.cyan("➜")}  Initialize Project`,
        value: "init",
        description: "Connect to a Git repository and setup structure",
      },
      new Separator(),
      {
        name: `${chalk.bold.green("↻")}  Sync Configuration`,
        value: "sync",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "Pull latest AI files from remote",
      },
      {
        name: `${chalk.bold.blue("ℹ")}  System Status`,
        value: "status",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "Check for local changes and current version",
      },
      {
        name: `${chalk.bold.magenta("⇋")}  Switch Version`,
        value: "use",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "Switch between commits, tags or branches",
      },
      {
        name: `${chalk.bold.yellow("☰")}  View History`,
        value: "versions",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "List all available versions in the repo",
      },
      {
        name: `${chalk.bold.white("👤")}  Manage Profiles`,
        value: "profiles",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "Create or switch between project profiles",
      },
      {
        name: `${chalk.bold.red("🚀")}  Publish Changes`,
        value: "publish",
        disabled: !isConfigured ? chalk.dim("(Requires Init)") : false,
        description: "Commit and push your local AI changes",
      },
      new Separator(),
      { name: `   Exit`, value: "exit" },
    ];

    try {
      const action = await select({
        message: "What would you like to do?",
        choices,
        pageSize: 12,
      });

      switch (action) {
        case "init":
          await initCommand(cwd);
          break;
        case "sync":
          await syncCommand(cwd);
          break;
        case "status":
          await statusCommand(cwd);
          break;
        case "use":
          await useCommand(cwd);
          break;
        case "versions":
          await versionsCommand(cwd);
          break;
        case "profiles":
          const profileAction = await select({
            message: "Profile actions:",
            choices: [
              { name: "Create New Profile", value: "create" },
              { name: "Switch Profile", value: "use" },
              { name: "Back to Main Menu", value: "back" },
            ],
          });
          if (profileAction === "create") await profileCreateCommand(cwd);
          if (profileAction === "use") await profileUseCommand(cwd);
          break;
        case "publish":
          await publishCommand(cwd);
          break;
        case "exit":
          console.clear();
          console.log(chalk.gray("\n  Goodbye! 👋\n"));
          process.exit(0);
      }

      if (action !== "exit") {
        await input({ message: chalk.dim("\nPress Enter to continue...") });
      }
    } catch (err: any) {
      // If user cancelled or pressed escape
      console.clear();
      console.log(chalk.gray("\n  Goodbye! 👋\n"));
      process.exit(0);
    }
  }
}

// Parse args or show menu if none
if (process.argv.length > 2) {
  program.parse(process.argv);
} else {
  showMenu().catch((err) => {
    if (err.message && err.message.includes("User force closed")) {
      process.exit(0);
    }
    console.error(err);
    process.exit(1);
  });
}
