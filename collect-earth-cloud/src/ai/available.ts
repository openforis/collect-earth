import type { Config } from '../config.js';
import type { ServerSettings } from '../types.js';

/**
 * The AI assistant can be used on this server: it can reach Vertex AI (AI_VERTEX_*)
 * and the server owner switched it on. Each project still has its own switch.
 */
export function aiAvailable(config: Config, settings: ServerSettings): boolean {
  return config.aiConfigured === true && settings.aiEnabled;
}
