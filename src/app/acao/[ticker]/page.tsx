import { Suspense } from "react";
import { StockDetail } from "@/components/StockDetail";

async function Detail({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <StockDetail ticker={decodeURIComponent(ticker).toUpperCase()} />;
}

export default function Page({ params }: PageProps<"/acao/[ticker]">) {
  return (
    <Suspense fallback={<p className="px-4 py-16 text-center text-sm text-ink-2">Carregando…</p>}>
      <Detail params={params} />
    </Suspense>
  );
}
