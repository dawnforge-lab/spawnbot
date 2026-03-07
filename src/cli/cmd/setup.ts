import { cmd } from "./cmd"

export const SetupCommand = cmd({
  command: "setup",
  describe: "set up your spawnbot agent (launches TUI with /setup)",
  handler: async () => {
    const { TuiThreadCommand } = await import("./tui/thread")
    return TuiThreadCommand.handler!({ prompt: "/setup" } as any)
  },
})
