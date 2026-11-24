import { useEffect, useState } from "react";
import { Nav, type View } from "@/components/Nav";
import { Opportunities } from "@/components/Opportunities";
import { Portfolio } from "@/components/Portfolio";
import { Screener } from "@/components/Screener";
import { StockDetail } from "@/components/StockDetail";

const TICKER = /^[A-Z0-9]{4}\d{1,2}$/;

/** Rotas por hash: "#" ações, "#carteira", "#oportunidades", "#PETR4" página do papel. */
function route(): { view: View; ticker: string | null } {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "carteira") return { view: "carteira", ticker: null };
  if (h === "oportunidades") return { view: "oportunidades", ticker: null };
  const t = h.toUpperCase();
  return TICKER.test(t) ? { view: "papel", ticker: t } : { view: "acoes", ticker: null };
}

const TITLES: Record<View, string> = { acoes: "Ações", carteira: "Minha carteira", oportunidades: "Oportunidades", papel: "" };

export function App() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const onHash = () => {
      setR(route());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = `${r.ticker ?? TITLES[r.view]} · Calculadora Graham`;
  }, [r]);
  return (
    <>
      <Nav view={r.view} />
      {/* a lista fica montada por baixo para manter filtros e rolagem ao voltar */}
      <div hidden={r.view !== "acoes"}>
        <Screener />
      </div>
      {r.view === "carteira" && <Portfolio />}
      {r.view === "oportunidades" && <Opportunities />}
      {r.ticker && <StockDetail key={r.ticker} ticker={r.ticker} />}
    </>
  );
}
