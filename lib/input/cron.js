/**
 * Cron Scheduler — loads CRONS.yaml, schedules jobs via node-cron,
 * pushes prompts to InputQueue at scheduled times.
 */

import cron from 'node-cron';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { loadFlowSkill } from '../flow/loader.js';
import { createLogger } from '../logger.js';

const log = createLogger('CRON');

export class CronScheduler {
  constructor({ queue, projectRoot }) {
    this.queue = queue;
    this.projectRoot = projectRoot || process.cwd();
    this.tasks = new Map(); // name → cron.ScheduledTask
    this.config = {};
  }

  /**
   * Load CRONS.yaml and start all enabled cron jobs.
   */
  start() {
    const configPath = resolve(this.projectRoot, 'config', 'CRONS.yaml');

    if (!existsSync(configPath)) {
      log.info('No CRONS.yaml found, skipping');
      return;
    }

    this.config = parse(readFileSync(configPath, 'utf8'));
    const crons = this.config.crons || {};

    for (const [name, job] of Object.entries(crons)) {
      if (job.enabled === false) {
        log.info(`Skipping disabled job: ${name}`);
        continue;
      }

      if (!job.prompt) {
        log.warn(`No prompt for job: ${name} — will ask agent to define one`);
        const task = cron.schedule(job.schedule, () => {
          log.info(`Firing (no prompt): ${name}`);
          this.queue.enqueue({
            source: 'cron',
            sender: name,
            senderName: `cron:${name}`,
            content: `[SYSTEM]: The cron job "${name}" (schedule: ${job.schedule}) fired but has no prompt defined. ` +
              `Read config/CRONS.yaml, decide what this job should do based on its name, and add a "prompt:" field to it. ` +
              `Then confirm what you set it to.`,
            priority: job.priority || 'normal',
            metadata: { cronName: name, schedule: job.schedule, needsPrompt: true },
          });
        });
        this.tasks.set(name, task);
        continue;
      }

      if (!cron.validate(job.schedule)) {
        log.error(`Invalid schedule for ${name}: ${job.schedule}`);
        continue;
      }

      const task = cron.schedule(job.schedule, () => {
        log.info(`Firing: ${name}`);
        this._enqueueJob(name, job);
      });

      this.tasks.set(name, task);
      log.info(`Scheduled: ${name} (${job.schedule})`);
    }

    log.info(`Started ${this.tasks.size} jobs`);
  }

  /**
   * Stop all cron jobs.
   */
  stop() {
    for (const [name, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    log.info('All jobs stopped');
  }

  /**
   * Reload — stop all jobs and re-read CRONS.yaml.
   */
  reload() {
    log.info('Reloading schedules...');
    this.stop();
    this.start();
  }

  /**
   * Get status of all cron jobs.
   */
  getStatus() {
    const status = {};
    const crons = this.config.crons || {};

    for (const [name, job] of Object.entries(crons)) {
      status[name] = {
        schedule: job.schedule,
        enabled: job.enabled !== false,
        running: this.tasks.has(name),
        priority: job.priority || 'normal',
      };
    }

    return status;
  }

  /**
   * Manually fire a cron job by name.
   */
  fire(name) {
    const crons = this.config.crons || {};
    const job = crons[name];

    if (!job) {
      throw new Error(`Unknown cron job: ${name}`);
    }

    this._enqueueJob(name, job, { manual: true });
    return { fired: true, name };
  }

  /**
   * Enqueue a cron job prompt. Handles flow: prefix and workspace: true.
   * @param {string} name - Job name
   * @param {object} job - Job config from CRONS.yaml
   * @param {object} [extra] - Extra metadata fields
   */
  _enqueueJob(name, job, extra = {}) {
    // Detect flow: prefix — enqueue as flow item
    if (job.prompt.startsWith('flow:')) {
      const flowName = job.prompt.slice(5);
      const skill = loadFlowSkill(resolve(this.projectRoot, 'skills', flowName, 'SKILL.md'));
      if (skill) {
        this.queue.enqueue({
          source: 'flow',
          senderName: `cron:${name}`,
          content: `Executing flow: ${flowName}`,
          priority: job.priority || 'normal',
          metadata: { flow: skill.flow, flowName, cronName: name, ...extra },
        });
        return;
      }
      log.warn(`Flow skill "${flowName}" not found, falling back to prompt`);
    }

    // Workspace job — wrap prompt with branch instructions
    if (job.workspace) {
      const date = new Date().toISOString().slice(0, 10);
      const branchName = `job/${name}-${date}`;
      const projectDir = job.project ? resolve(job.project.replace(/^~/, process.env.HOME || '~')) : null;

      const instructions = [];
      instructions.push(`[WORKSPACE JOB — Branch: ${branchName}]`);
      if (projectDir) {
        instructions.push(`First: \`cd ${projectDir}\``);
      }
      instructions.push(`Run \`git checkout -b ${branchName}\``);
      instructions.push(`Do the work described below.`);
      instructions.push(`When done: commit all changes, run \`gh pr create --title "Job: ${name}" --body "<summary of what you did>"\`, then \`git checkout main\`.`);
      if (projectDir) {
        instructions.push(`Then return to your agent directory: \`cd ${this.projectRoot}\``);
      }
      instructions.push('', job.prompt);

      const wrappedPrompt = instructions.join('\n');

      this.queue.enqueue({
        source: 'cron',
        sender: name,
        senderName: `cron:${name}`,
        content: wrappedPrompt,
        priority: job.priority || 'normal',
        metadata: { cronName: name, schedule: job.schedule, workspace: true, branch: branchName, project: projectDir || this.projectRoot, ...extra },
      });
      return;
    }

    this.queue.enqueue({
      source: 'cron',
      sender: name,
      senderName: `cron:${name}`,
      content: job.prompt,
      priority: job.priority || 'normal',
      metadata: { cronName: name, schedule: job.schedule, ...extra },
    });
  }
}
