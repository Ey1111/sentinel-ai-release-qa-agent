const PREFIX = "SENTINEL_SECRET_";

export type RunSecrets = { refs: string[]; resolve: (ref: string) => Promise<string> };

/**
 * Test credentials come from SENTINEL_SECRET_<NAME>. Only the names reach the model.
 * They are offered only when every origin of the run is listed in SENTINEL_SECRET_ALLOWED_ORIGINS,
 * so one target's account can never be typed into another site.
 */
export function secretsForRun(env: NodeJS.ProcessEnv, allowedOrigins: string[]): RunSecrets {
  const approved = new Set((env.SENTINEL_SECRET_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const inScope = allowedOrigins.length > 0 && allowedOrigins.every((origin) => approved.has(origin));
  const values = new Map<string, string>();
  if (inScope) {
    for (const [key, value] of Object.entries(env)) {
      if (key.startsWith(PREFIX) && key !== "SENTINEL_SECRET_ALLOWED_ORIGINS" && value) values.set(key.slice(PREFIX.length), value);
    }
  }
  return {
    refs: [...values.keys()].sort(),
    resolve: async (ref) => {
      const value = values.get(ref);
      if (value === undefined) throw new Error("Unknown secret reference");
      return value;
    },
  };
}
