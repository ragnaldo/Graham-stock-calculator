import type { NextRequest } from "next/server";
import { getStockDetail } from "@/server/stocks";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/stocks/[ticker]">) {
  const { ticker } = await ctx.params;
  try {
    const detail = await getStockDetail(ticker, req.nextUrl.searchParams.get("refresh") === "1");
    if (!detail) return Response.json({ error: `Papel ${ticker.toUpperCase()} não encontrado` }, { status: 404 });
    return Response.json(detail);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
