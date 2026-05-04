import { select } from '@inquirer/prompts';
import readline from 'readline';

async function main() {
  const controller = new AbortController();
  
  const handleKeypress = (str, key) => {
    if (key && key.name === 'escape') {
      console.log('\nEscape pressed! Aborting...');
      controller.abort();
    }
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', handleKeypress);

  try {
    const answer = await select({
      message: 'Press Escape to cancel',
      choices: [
        { name: 'Option 1', value: '1' },
        { name: 'Option 2', value: '2' },
      ],
    }, { signal: controller.signal });
    console.log('Answer:', answer);
  } catch (err: any) {
    console.log('Caught error name:', err.name);
    console.log('Caught error message:', err.message);
  } finally {
    process.stdin.removeListener('keypress', handleKeypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause(); // Stop listening
  }
}

main();
