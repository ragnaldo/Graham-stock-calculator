import { getStocks } from "@/server/stocks";

export async function GET() {
  try {
    return Response.json(await getStocks());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
