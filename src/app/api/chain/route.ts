import { NextResponse } from "next/server";
import { verifyStoredChain } from "@/lib/queries";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await verifyStoredChain());
}
