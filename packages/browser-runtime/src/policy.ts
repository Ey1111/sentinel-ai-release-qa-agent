export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

type DomainPolicyOptions = { allowedOrigins: string[]; allowLocalhost?: boolean };

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class DomainPolicy {
  readonly allowedOrigins: Set<string>;
  readonly allowLocalhost: boolean;

  constructor(options: DomainPolicyOptions) {
    if (options.allowedOrigins.length === 0) throw new PolicyViolationError("At least one allowed origin is required");
    this.allowedOrigins = new Set(options.allowedOrigins.map((value) => normalizeOrigin(value)));
    this.allowLocalhost = options.allowLocalhost ?? false;
  }

  assertAllowed(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new PolicyViolationError("URL must be absolute"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new PolicyViolationError("Only HTTP(S) navigation is allowed");
    if (url.username || url.password) throw new PolicyViolationError("URL credentials are not allowed");
    if (localHosts.has(url.hostname) && !this.allowLocalhost) throw new PolicyViolationError("Local network targets require development mode");
    if (!this.allowedOrigins.has(url.origin)) throw new PolicyViolationError(`Origin is not allowlisted: ${url.origin}`);
    return url;
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) throw new PolicyViolationError("Allowed domains must be origins without path, query, or fragment");
  return url.origin;
}
