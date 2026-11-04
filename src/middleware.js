import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

function secureHeaders(response) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const onRequest = defineMiddleware(async ({ request, url, redirect, locals }, next) => {
  // Prerendering at build time has no runtime bindings; the login page defers
  // its runtime state (configured/authenticated) to a client-side check.
  // Its static response carries the same headers via the assets _headers file.
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
  if (!publicPage && !session.authenticated) return secureHeaders(redirect("/login", 302));
  if (publicPage && session.authenticated) return secureHeaders(redirect("/", 302));
  return secureHeaders(await next());
});
