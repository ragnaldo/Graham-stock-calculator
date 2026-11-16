import { describe, expect, it } from "vitest";
import { parseBR, parseDetails, parseDividends, parseList } from "./fundamentus";

describe("parseBR", () => {
  it("lê números e percentuais no formato brasileiro", () => {
    expect(parseBR("1.234,56")).toBeCloseTo(1234.56);
    expect(parseBR("8,0%")).toBeCloseTo(0.08);
    expect(parseBR("-28,31")).toBeCloseTo(-28.31);
    expect(parseBR("2.672.120.000")).toBe(2672120000);
    expect(parseBR("-")).toBeNull();
    expect(parseBR("")).toBeNull();
  });
});

describe("parseList", () => {
  const cols = ["Papel", "Cotação", "P/L", "P/VP", "PSR", "Div.Yield", "P/Ativo", "P/Cap.Giro", "P/EBIT", "P/Ativ Circ.Liq", "EV/EBIT", "EV/EBITDA", "Mrg Bruta", "Mrg Ebit", "Mrg. Líq.", "Liq. Corr.", "ROIC", "ROE", "Liq.2meses", "Patrim. Líq", "Dív.Brut/ Patrim.", "Cresc. Rec.5a"];
  const row = (ticker: string, cells: string[]) => `<tr><td><span class="tips" title="X"><a href="detalhes.php?papel=${ticker}">${ticker}</a></span></td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
  const cells = ["45,30", "4,16", "1,16", "0,990", "8,00%", "0,440", "-28,31", "2,22", "-0,91", "3,37", "2,52", "52,10%", "44,50%", "23,80%", "0,90", "21,40%", "27,80%", "2.672.120.000,00", "504.698.000.000,00", "0,72", "-1,80%"];
  const filler = Array.from({ length: 60 }, (_, i) => row(`AB${String(i).padStart(2, "0")}3`, cells)).join("");
  const html = `<table><thead><tr>${cols.map((c) => `<th><a>${c}</a></th>`).join("")}</tr></thead><tbody>${row("PETR4", cells)}${row("ZERO3", ["0,00", ...cells.slice(1)])}${filler}</tbody></table>`;

  it("mapeia as colunas pelo cabeçalho e descarta papéis sem cotação", () => {
    const list = parseList(html);
    expect(list.some((s) => s.ticker === "ZERO3")).toBe(false);
    const p = list.find((s) => s.ticker === "PETR4")!;
    expect(p.price).toBeCloseTo(45.3);
    expect(p.pl).toBeCloseTo(4.16);
    expect(p.dy).toBeCloseTo(0.08);
    expect(p.pAcl).toBeCloseTo(-0.91);
    expect(p.roe).toBeCloseTo(0.278);
    expect(p.liq2m).toBe(2672120000);
    expect(p.divPatrim).toBeCloseTo(0.72);
    expect(p.cresRec5a).toBeCloseTo(-0.018);
  });

  it("falha em vez de devolver lista vazia quando o formato muda", () => {
    expect(() => parseList("<html><body>manutenção</body></html>")).toThrow();
  });
});

describe("parseDetails e parseDividends", () => {
  it("lê pares rótulo/valor e diferencia rótulos repetidos", () => {
    const pair = (l: string, v: string) => `<td class="label w15"><span class="help tips" title="t">?</span><span class="txt">${l}</span></td>\n<td class="data w35"><span class="txt">${v}</span></td>`;
    const d = parseDetails(`<table><tr>${pair("Papel", "PETR4")}${pair("Últ balanço processado", "30/09/2026")}</tr><tr>${pair("Lucro Líquido", "140.421.000.000")}${pair("Lucro Líquido", "39.750.000.000")}</tr></table>`);
    expect(d.fields.get("papel")).toBe("PETR4");
    expect(d.fields.get("ultbalancoprocessado")).toBe("30/09/2026");
    expect(d.fields.get("lucroliquido")).toBe("140.421.000.000");
    expect(d.fields.get("lucroliquido#2")).toBe("39.750.000.000");
  });

  it("converte proventos para valor por ação", () => {
    const html = `<table id="resultado"><thead><tr><th>Data</th><th>Valor</th><th>Tipo</th><th>Data de Pagamento</th><th>Por quantas ações</th></tr></thead><tbody>
      <tr><td>21/08/2026</td><td>0,6741</td><td>JRS CAP PROPRIO</td><td>23/11/2026 </td><td>1</td></tr>
      <tr><td>02/01/2001</td><td>15,00</td><td>DIVIDENDO</td><td>-</td><td>1000</td></tr></tbody></table>`;
    expect(parseDividends(html)).toEqual([
      { date: "2026-08-21", type: "JRS CAP PROPRIO", value: 0.6741, payDate: "2026-11-23" },
      { date: "2001-01-02", type: "DIVIDENDO", value: 0.015, payDate: null },
    ]);
  });
});
