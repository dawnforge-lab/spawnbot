import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { InputQueue } from "@/input/queue"
import { CronScheduler } from "@/autonomy/cron"
import { PollerManager } from "@/autonomy/poller"
import { IdleLoop } from "@/autonomy/idle"
import { Memory } from "@/memory"
import { Installation } from "@/installation"
import { Tunnel } from "@/tunnel"

const startedAt = Date.now()

export function StatusRoutes() {
  return new Hono().get(
    "/",
    describeRoute({
      summary: "Agent status",
      description: "Get agent health: uptime, queue depth, cron jobs, pollers, memory stats",
      operationId: "status.get",
      responses: {
        200: {
          description: "Agent status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  version: z.string(),
                  uptime: z.number(),
                  queue: z.object({
                    depth: z.number(),
                    sizes: z.record(z.string(), z.number()),
                  }),
                  cron: z.object({
                    running: z.boolean(),
                    jobs: z.array(
                      z.object({
                        name: z.string(),
                        schedule: z.string(),
                        nextRun: z.string().nullable(),
                      }),
                    ),
                  }),
                  pollers: z.array(
                    z.object({
                      name: z.string(),
                      interval: z.number(),
                    }),
                  ),
                  idle: z.object({
                    running: z.boolean(),
                  }),
                  tunnel: z.object({
                    running: z.boolean(),
                    url: z.string().nullable(),
                  }),
                  memory: z.object({
                    total: z.number(),
                    byCategory: z.record(z.string(), z.number()),
                    avgImportance: z.number(),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const token = process.env.STATUS_API_TOKEN
      if (token) {
        const auth = c.req.header("Authorization")
        if (auth !== `Bearer ${token}`) {
          return c.json({ error: "Unauthorized" }, 401)
        }
      }

      const memStats = Memory.stats()
      const queueSizes = InputQueue.sizes()

      return c.json({
        version: Installation.VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        queue: {
          depth: Object.values(queueSizes).reduce((a, b) => a + b, 0),
          sizes: queueSizes,
        },
        cron: {
          running: CronScheduler.isRunning(),
          jobs: CronScheduler.list(),
        },
        pollers: PollerManager.list(),
        idle: {
          running: IdleLoop.isRunning(),
        },
        tunnel: {
          running: Tunnel.isRunning(),
          url: Tunnel.url() ?? null,
        },
        memory: memStats,
      })
    },
  )
}
