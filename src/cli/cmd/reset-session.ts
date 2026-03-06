import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Daemon } from "../../daemon"

export const ResetSessionCommand = cmd({
  command: "reset-session",
  describe: "clear the daemon session so the next start creates a fresh conversation",
  builder: (yargs) => yargs,
  handler: async () => {
    prompts.intro(UI.logo())
    Daemon.resetSession()
    prompts.log.success("Daemon session cleared. Next start will create a fresh conversation.")
    prompts.outro("Done")
  },
})
