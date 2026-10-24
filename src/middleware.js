import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

export const onRequest = defineMiddleware(async ({ request, url, redirect, locals }, next) => {
  // Prerendering at build time has no runtime bindings; the login page defers
  // its runtime state (configured/authenticated) to a client-side check.
  if (!env.AUTOMATION) {
    locals.session = null;
    return next();
  }
  const response = await env.AUTOMATION.getByName("primary").fetch(new Request(new URL("/api/auth/session", url), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  }));
  const session = await response.json();
  locals.session = session;
  const publicPage = url.pathname === "/login";
  if (!publicPage && !session.authenticated) return redirect("/login", 302);
  if (publicPage && session.authenticated) return redirect("/", 302);
  const result = await next();
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "SAMEORIGIN");
  return result;
});
