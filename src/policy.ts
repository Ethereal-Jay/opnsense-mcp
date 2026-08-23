import type { ApiRequest, RiskAssessment } from "./types.js";

const READ_PREFIXES = [
  "get",
  "search",
  "list",
  "status",
  "info",
  "show",
  "fetch",
  "download",
  "export",
  "diff",
  "provider",
  "backup",
  "version",
  "running",
  "health",
  "audit",
  "changelog",
  "detail",
  "license",
  "tree",
  "counter",
  "table",
  "configtest",
  "query",
  "overview",
] as const;

const CATASTROPHIC_COMMANDS = new Set([
  "factory_defaults",
  "factorydefaults",
  "revert_backup",
  "activate",
]);

const CATASTROPHIC_TERMS = ["factory", "wipe", "erase", "restore_default"] as const;
const DISRUPTIVE_TERMS = [
  "reboot",
  "halt",
  "poweroff",
  "upgrade",
  "update",
  "install",
  "remove",
  "restart",
  "start",
  "stop",
  "kill",
  "disconnect",
  "flush",
  "reset",
  "renew",
  "revoke",
  "sign",
] as const;
const ACTIVATE_TERMS = ["apply", "reconfigure", "reload", "sync"] as const;
const WRITE_PREFIXES = [
  "add",
  "set",
  "del",
  "delete",
  "toggle",
  "move",
  "upload",
  "import",
  "save",
  "lock",
  "unlock",
  "create",
  "issue",
  "generate",
  "dismiss",
  "abort",
] as const;

function includesAny(command: string, terms: readonly string[]): string | undefined {
  return terms.find((term) => command.includes(term));
}

export function assessRisk(request: ApiRequest): RiskAssessment {
  const command = request.command.toLowerCase();
  const route = `${request.module}/${request.controller}/${command}`.toLowerCase();

  if (
    CATASTROPHIC_COMMANDS.has(command) ||
    includesAny(command, CATASTROPHIC_TERMS) ||
    route === "core/defaults/reset"
  ) {
    return { level: "catastrophic", reason: "The endpoint can replace, restore, or reset system configuration." };
  }

  const disruptive = includesAny(command, DISRUPTIVE_TERMS);
  if (disruptive) {
    return { level: "disruptive", reason: `The command contains '${disruptive}' and may interrupt services or the firewall.` };
  }

  const activation = includesAny(command, ACTIVATE_TERMS);
  if (activation) {
    return { level: "activate", reason: `The command contains '${activation}' and may activate staged configuration.` };
  }

  const write = WRITE_PREFIXES.find((prefix) => command.startsWith(prefix));
  if (write) {
    return { level: "write", reason: `The command begins with '${write}' and is expected to modify configuration or state.` };
  }

  const read = READ_PREFIXES.find((prefix) => command.startsWith(prefix));
  if (read) {
    return { level: "read", reason: `The command begins with the recognized read prefix '${read}'.` };
  }

  return {
    level: "unknown",
    reason: "The command is not recognized. Unknown endpoints are treated as mutations, regardless of HTTP method.",
  };
}
