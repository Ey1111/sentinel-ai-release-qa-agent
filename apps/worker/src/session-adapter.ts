import type { QaBrowserTool } from "@sentinel/agent-core";
import { InteractiveBrowserSession } from "@sentinel/browser-runtime";

export class SessionQaBrowserTool implements QaBrowserTool {
  constructor(private readonly session: InteractiveBrowserSession) {}

  observe(input: Parameters<QaBrowserTool["observe"]>[0]) {
    return this.session.observe(input);
  }

  execute(input: Parameters<QaBrowserTool["execute"]>[0]) {
    return this.session.execute(input);
  }
}
