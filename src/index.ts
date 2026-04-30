#!/usr/bin/env node

import { Command } from 'commander';
import { select } from '@inquirer/prompts';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { statusCommand } from './commands/status.js';
import { versionsCommand } from './commands/versions.js';
import { useCommand } from './commands/use.js';
import { profileCreateCommand, profileUseCommand } from './commands/profiles.js';
import { publishCommand } from './commands/publish.js';
import { readConfig } from './config.js';

const program = new Command();
const cwd = process.cwd();

program
  .name('qbk-ia')
  .description('AI Config Manager')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize AI configuration')
  .action(() => initCommand(cwd));

program
  .command('sync')
  .description('Synchronize AI configuration from remote')
  .action(() => syncCommand(cwd));

program
  .command('status')
  .description('Check status of local AI configuration')
  .action(() => statusCommand(cwd));

program
  .command('versions')
  .description('List available versions/tags/commits')
  .action(() => versionsCommand(cwd));

program
  .command('use')
  .description('Use a specific version')
  .argument('[version]', 'Version to use')
  .action((version) => useCommand(cwd, version));

const profileCmd = program
  .command('profile')
  .description('Manage profiles');

profileCmd
  .command('create')
  .description('Create a new profile')
  .action(() => profileCreateCommand(cwd));

profileCmd
  .command('use')
  .description('Use an existing profile')
  .argument('[name]', 'Profile name to use')
  .action((name) => profileUseCommand(cwd, name));

program
  .command('publish')
  .description('Publish local changes to the AI repository')
  .action(() => publishCommand(cwd));

// Interactive Menu
async function showMenu() {
  while (true) {
    const config = await readConfig(cwd);
    const isConfigured = config !== null;
    
    const choices = [
      { name: '1. Init', value: 'init' },
      { name: '2. Sync', value: 'sync', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '3. Status', value: 'status', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '4. Switch Version', value: 'use', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '5. Versions List', value: 'versions', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '6. Profiles', value: 'profiles', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '7. Publish', value: 'publish', disabled: !isConfigured ? 'Requires Init' : false },
      { name: '8. Exit', value: 'exit' },
    ];

    const action = await select({
      message: 'Select an action:',
      choices
    });

    switch (action) {
      case 'init':
        await initCommand(cwd);
        break;
      case 'sync':
        await syncCommand(cwd);
        break;
      case 'status':
        await statusCommand(cwd);
        break;
      case 'use':
        await useCommand(cwd);
        break;
      case 'versions':
        await versionsCommand(cwd);
        break;
      case 'profiles':
        const profileAction = await select({
          message: 'Profile actions:',
          choices: [
            { name: 'Create', value: 'create' },
            { name: 'Use', value: 'use' },
            { name: 'Back', value: 'back' }
          ]
        });
        if (profileAction === 'create') await profileCreateCommand(cwd);
        if (profileAction === 'use') await profileUseCommand(cwd);
        break;
      case 'publish':
        await publishCommand(cwd);
        break;
      case 'exit':
        process.exit(0);
    }
    console.log(''); // Empty line for readability
  }
}

// Parse args or show menu if none
if (process.argv.length > 2) {
  program.parse(process.argv);
} else {
  showMenu().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
