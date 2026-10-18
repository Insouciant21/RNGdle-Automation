import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

export const onRequest = defineMiddleware(async ({ request, url, redirect, locals }, next) => {
  const response = await env.AUTOMATION.getByName("primary").fetch(new Request(new URL("/api/auth/session", url), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  }));
  const session = await response.json();
  locals.session = session;
  const publicPage = url.pathname === "/login" || url.pathname === "/setup";
  if (!publicPage && !session.authenticated) return redirect(session.configured ? "/login" : "/setup", 302);
  if (publicPage && session.authenticated) return redirect("/", 302);
  if (url.pathname === "/setup" && session.configured) return redirect("/login", 302);
  if (url.pathname === "/login" && !session.configured) return redirect("/setup", 302);
  const result = await next();
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "SAMEORIGIN");
  return result;
});
