import { cmd } from "./cmd"
import { UI } from "../ui"

// The actual setup logic is handled by the bash wrapper (bin/spawnbot)
// which launches the TUI with --prompt "/setup".
// This command exists as a fallback for direct CLI invocation.
export const SetupCommand = cmd({
  command: "setup",
  describe: "set up your spawnbot agent (launches TUI with /setup)",
  handler: async () => {
    UI.error(
      "Run 'spawnbot setup' from the shell wrapper, or launch spawnbot and type /setup.\n",
    )
    process.exitCode = 1
  },
})
