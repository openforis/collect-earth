// The local bundle's stand-in for src/ai/gemini.ts (no `@google/genai`): see notInLocalBuild.ts.
import type * as real from '../ai/gemini.js';

/** No AI client: the assistant is off in the local mode. */
export const createGeminiClient: typeof real.createGeminiClient = () => undefined;
