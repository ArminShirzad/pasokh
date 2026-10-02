import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/automations", "/logs", "/settings"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token") ||
    request.cookies.has("next-auth.session-token") ||
    request.cookies.has("__Secure-next-auth.session-token")
  );
}

// The proxy only sees whether a session cookie exists, not whether it is
// valid. That is enough to send a signed-out visitor to /login early, but it
// must never send /login onwards to the dashboard: a cookie the server cannot
// decrypt (a reinstall with a new NEXTAUTH_SECRET, a restored backup, another
// app on localhost) made /login redirect to /dashboard and the dashboard back
// to /login, forever. The login page checks the session itself instead.
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !hasSessionCookie(request)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/automations/:path*", "/logs/:path*", "/settings/:path*"],
};
