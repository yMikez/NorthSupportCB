import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/admin/:path*"],
};

export function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  if (req.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("admin_auth")?.value;
  if (cookie === secret) return NextResponse.next();

  const queryKey = req.nextUrl.searchParams.get("key");
  if (queryKey && queryKey === secret) {
    const res = NextResponse.redirect(new URL("/admin", req.url));
    res.cookies.set("admin_auth", secret, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return res;
  }

  return NextResponse.redirect(new URL("/admin/login", req.url));
}
