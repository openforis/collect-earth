const fs = require("node:fs");
const path = require("node:path");
if (!process.env.EE_KEY) {
  const file = path.join(__dirname, "..", "..", ".secret.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).trim();
    }
  }
}
