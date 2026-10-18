import { handle } from "@astrojs/cloudflare/handler";
import { AutomationService } from "./cloud/service.js";

export class Automation {
  constructor(ctx, env) { this.service = new AutomationService(ctx.storage, env); }
  fetch(request) { return this.service.fetch(request); }
  alarm() { return this.service.tick(); }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/") || pathname.startsWith("/preview/") || pathname.startsWith("/__migration/")) {
      if (request.body) {
        const maximum = pathname === "/__migration/import" ? 2 * 1024 * 1024 : 32768;
        const chunks = [];
        let size = 0;
        for await (const chunk of request.body) {
          size += chunk.byteLength;
          if (size > maximum) return Response.json({ message: "Request body is too large" }, { status: 413 });
          chunks.push(Buffer.from(chunk));
        }
        // Consume the incoming upload before the object can reject it. This also
        // avoids workerd reading a forwarded stream after an early 401/403.
        request = new Request(request, { body: Buffer.concat(chunks) });
      }
      return env.AUTOMATION.getByName("primary").fetch(request);
    }
    return handle(request, env, ctx);
  },
};
