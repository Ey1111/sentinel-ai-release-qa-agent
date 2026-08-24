const patterns: Array<[RegExp, string]> = [
  [/(password\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(token\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(secret\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]"],
];

export function redactSecrets(value: string, exactSecrets: string[] = []): string {
  const patternRedacted = patterns.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
  return normalizedSecrets(exactSecrets).reduce((current, secret) => current.replaceAll(secret, "[REDACTED]"), patternRedacted);
}

export function containsExactSecret(value: string, exactSecrets: string[]): boolean {
  return normalizedSecrets(exactSecrets).some((secret) => value.includes(secret));
}

function normalizedSecrets(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => right.length - left.length);
}
