import fs from "fs"
import path from "path"

const STATE_DIR = path.join(
  process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "/tmp", ".local", "share"),
  "spawnbot",
)

const PORT_FILE = path.join(STATE_DIR, "daemon.port")

export function writePortFile(port: number) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(PORT_FILE, String(port), "utf-8")
}

export function readPortFile(): number | undefined {
  try {
    const content = fs.readFileSync(PORT_FILE, "utf-8").trim()
    const port = parseInt(content, 10)
    return isNaN(port) ? undefined : port
  } catch {
    return undefined
  }
}

export function removePortFile() {
  try {
    fs.unlinkSync(PORT_FILE)
  } catch {
    // Already gone
  }
}
