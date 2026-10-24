import { env } from "cloudflare:workers";

// Pages render live data by calling the same /api/* routes the browser client
// uses, forwarding cookies so the Durable Object sees the Control session.
export async function controlApi(request, path) {
  const response = await env.AUTOMATION.getByName("primary").fetch(new Request(new URL(path, request.url), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  }));
  return response.ok ? await response.json() : null;
}
