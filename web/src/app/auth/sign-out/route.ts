import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/cloud/server";

export async function POST(req: NextRequest) {
  await (await userClient()).auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/sign-in", req.nextUrl.origin), { status: 303 });
}
