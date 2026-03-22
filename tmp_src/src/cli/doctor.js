import chalk from 'chalk';
import { EnvDetector } from '../env/detector.js';

// Labels shown in the left column
const LABELS = {
  node:          'Node.js',
  python:        'Python',
  comfyui:       'ComfyUI (install)',
  comfyuiServer: 'ComfyUI (server)',
  docker:        'Docker',
  gpu:           'GPU',
  mcpConfig:     'MCP config',
};

// Which checks are hard failures (MISSING = exit 1) vs soft warnings
const CRITICAL = new Set(['node', 'python', 'comfyui']);

export async function runDoctor() {
  console.log(chalk.bold('\nInter-Forge Health Check\n'));

  const report = await EnvDetector.checkAll();
  let hasFailure = false;

  for (const [key, data] of Object.entries(report)) {
    const label = (LABELS[key] ?? key).padEnd(20);
    const isCritical = CRITICAL.has(key);

    let icon, statusText;
    if (data.status === 'OK') {
      icon = chalk.green('✓');
      statusText = chalk.green('OK');
    } else if (data.status === 'WARN') {
      icon = chalk.yellow('!');
      statusText = chalk.yellow('WARN');
    } else {
      icon = chalk.red('✗');
      statusText = chalk.red('MISSING');
      if (isCritical) hasFailure = true;
    }

    console.log(`  ${icon} ${label} ${statusText}`);

    if (data.code && data.status !== 'OK') {
      console.log(`      [${data.code}]`);
    }
    if (data.version) console.log(`      Version: ${data.version}`);
    if (data.type && key === 'python') console.log(`      Source:  ${data.type}`);
    if (data.type && key === 'gpu')    console.log(`      Type:    ${data.type}`);
    if (data.path && key !== 'mcpConfig') console.log(`      Path:    ${data.path}`);
    if (data.detail) console.log(`      Detail:  ${data.detail}`);
    if (data.fix)    console.log(`      Fix:     ${chalk.cyan(data.fix)}`);
  }

  console.log('');

  if (hasFailure) {
    console.log(chalk.red('  Some critical checks failed. Run the Fix commands above before generating assets.'));
    process.exit(1);
  } else {
    const warnCount = Object.values(report).filter(d => d.status === 'WARN').length;
    if (warnCount > 0) {
      console.log(chalk.yellow(`  ${warnCount} warning(s) — core pipeline is ready, some features may be limited.`));
    } else {
      console.log(chalk.green('  All checks passed. Inter-Forge is ready.'));
    }
  }
}
