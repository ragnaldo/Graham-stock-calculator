import { refreshStocks } from "@/server/stocks";

/** Botão "Atualizar": recarrega cotações e fundamentos da fonte. */
export async function POST() {
  try {
    return Response.json(await refreshStocks());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
