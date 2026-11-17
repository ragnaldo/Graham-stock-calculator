import { useEffect, useState } from "react";
import { Screener } from "@/components/Screener";
import { StockDetail } from "@/components/StockDetail";

const TICKER = /^[A-Z0-9]{4}\d{1,2}$/;
const route = () => {
  const h = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  return TICKER.test(h) ? h : null;
};

/** Rotas por hash: "#" = lista, "#PETR4" = página do papel. */
export function App() {
  const [ticker, setTicker] = useState(route);
  useEffect(() => {
    const onHash = () => {
      setTicker(route());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = ticker ? `${ticker} · Calculadora Graham` : "Calculadora Graham B3";
  }, [ticker]);
  // a lista fica montada por baixo para manter filtros e rolagem ao voltar
  return (
    <>
      <div hidden={!!ticker}>
        <Screener />
      </div>
      {ticker && <StockDetail key={ticker} ticker={ticker} />}
    </>
  );
}
