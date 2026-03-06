/**
 * Step 5: Cron jobs — select scheduled tasks.
 */

import { confirm, checkbox, input, select } from '@inquirer/prompts';
import { section, c } from '../util.js';

const DEFAULT_CRONS = [
  {
    name: 'morning_checkin',
    label: 'Morning check-in (08:00 daily)',
    schedule: '0 8 * * *',
    prompt: 'Morning check-in. Check your active tasks and goals. Complete any tasks you can do right now without user input. Plan what needs doing today. Report: what you completed, what\'s planned, and anything that needs the user\'s decision.',
    priority: 'normal',
  },
  {
    name: 'health_check',
    label: 'Health check (every 6 hours)',
    schedule: '0 */6 * * *',
    prompt: 'System health check. Verify all services are running and review errors or warnings. If you find issues you can fix, fix them. Report only problems found and actions taken.',
    priority: 'low',
  },
  {
    name: 'evening_summary',
    label: 'Evening summary (22:00 daily)',
    schedule: '0 22 * * *',
    prompt: 'End of day. Review what was accomplished today. Complete any quick remaining tasks. Report: what got done, what\'s carrying over to tomorrow, and any decisions needed.',
    priority: 'normal',
  },
];

const FREQUENCY_CHOICES = [
  { name: 'Every hour',            value: '0 * * * *' },
  { name: 'Every 2 hours',         value: '0 */2 * * *' },
  { name: 'Every 4 hours',         value: '0 */4 * * *' },
  { name: 'Every 6 hours',         value: '0 */6 * * *' },
  { name: 'Every 12 hours',        value: '0 */12 * * *' },
  { name: 'Once a day (09:00)',     value: '0 9 * * *' },
  { name: 'Once a day (12:00)',     value: '0 12 * * *' },
  { name: 'Once a day (18:00)',     value: '0 18 * * *' },
  { name: 'Once a day (22:00)',     value: '0 22 * * *' },
  { name: 'Weekdays only (09:00)', value: '0 9 * * 1-5' },
  { name: 'Once a week (Monday 09:00)', value: '0 9 * * 1' },
  { name: 'Custom (enter cron expression)', value: '__custom__' },
];

export async function setupCrons() {
  section('Scheduled Jobs');

  const setupJobs = await confirm({
    message: 'Set up scheduled jobs?',
    default: true,
  });

  if (!setupJobs) return { jobs: {} };

  console.log();

  const selected = await checkbox({
    message: 'Select jobs to enable:',
    choices: DEFAULT_CRONS.map(cron => ({
      name: cron.label,
      value: cron.name,
      checked: cron.name !== 'evening_summary',
    })),
  });

  const jobs = {};
  for (const cronName of selected) {
    const cron = DEFAULT_CRONS.find(c => c.name === cronName);
    if (cron) {
      jobs[cron.name] = {
        schedule: cron.schedule,
        prompt: cron.prompt,
        priority: cron.priority,
        enabled: true,
      };
    }
  }

  // Custom cron
  let addMore = await confirm({
    message: 'Add a custom scheduled job?',
    default: false,
  });

  while (addMore) {
    const name = await input({ message: 'Job name:' });

    const schedule = await select({
      message: 'How often?',
      choices: FREQUENCY_CHOICES,
    });

    let finalSchedule = schedule;
    if (schedule === '__custom__') {
      finalSchedule = await input({ message: 'Cron expression (e.g., 0 */3 * * *):' });
    }

    const prompt = await input({ message: 'What should the agent do?:' });

    if (name && finalSchedule && prompt) {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      jobs[key] = { schedule: finalSchedule, prompt, priority: 'normal', enabled: true };
      console.log(c.success(`  Added: ${name}`));
    }

    addMore = await confirm({
      message: 'Add another job?',
      default: false,
    });
  }

  console.log();
  return { jobs };
}
