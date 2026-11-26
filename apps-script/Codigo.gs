/**
 * Calculadora Graham B3 — guarda as operações da carteira nesta planilha.
 *
 * Como instalar (uma vez):
 *  1. Troque a CHAVE abaixo por uma senha só sua (ela vai no app junto com o endereço).
 *  2. Salve e clique em Implantar > Nova implantação > tipo "App da Web".
 *     Executar como: Eu. Quem pode acessar: Qualquer pessoa.
 *  3. Autorize o acesso à planilha e copie o endereço do app da Web (termina em /exec).
 *
 * Depois de conectar, a aba "Calculadora" desta planilha guarda o seu link pessoal: abra-o em qualquer
 * navegador ou celular para usar a carteira sem colar endereço nem chave.
 *
 * Quem tiver o endereço e a chave (ou o link pessoal) consegue ler e alterar a aba "Operações". Não divulgue.
 */
var CHAVE = "troque-esta-chave";

var VERSAO = 2;
var ABA = "Operações";
var ABA_LINK = "Calculadora";
var COLUNAS = ["id", "Data", "Papel", "Operação", "Quantidade", "Preço", "Taxas"];

/** Lê as operações. */
function doGet(e) {
  return responder(function () {
    verificar(e && e.parameter ? e.parameter.chave : "");
    return { ok: true, versao: VERSAO, operacoes: ler(), planilha: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
  });
}

/** Grava a lista completa de operações (substitui a aba). */
function doPost(e) {
  return responder(function () {
    var corpo = JSON.parse(e.postData.contents);
    verificar(corpo.chave);
    if (!Array.isArray(corpo.operacoes)) throw new Error("lista de operações ausente");
    var trava = LockService.getScriptLock();
    trava.waitLock(10000);
    try {
      gravar(corpo.operacoes);
      if (corpo.link) gravarLink(String(corpo.link));
    } finally {
      trava.releaseLock();
    }
    return { ok: true, versao: VERSAO, total: corpo.operacoes.length };
  });
}

function responder(fn) {
  var saida;
  try {
    saida = fn();
  } catch (err) {
    saida = { ok: false, erro: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

function verificar(chave) {
  if (CHAVE === "troque-esta-chave") throw new Error("defina a CHAVE no código do Apps Script");
  if (String(chave || "") !== CHAVE) throw new Error("chave incorreta");
}

function aba() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var a = planilha.getSheetByName(ABA);
  if (!a) {
    a = planilha.insertSheet(ABA);
    a.appendRow(COLUNAS);
    a.setFrozenRows(1);
  }
  return a;
}

function ler() {
  var a = aba();
  var total = a.getLastRow();
  if (total < 2) return [];
  var fuso = Session.getScriptTimeZone();
  var linhas = a.getRange(2, 1, total - 1, COLUNAS.length).getValues();
  var saida = [];
  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i];
    if (!l[2]) continue; // linha sem papel
    var id = String(l[0] || "");
    if (!id) {
      // linha digitada direto na planilha: ganha um id
      id = Utilities.getUuid();
      a.getRange(i + 2, 1).setValue(id);
    }
    saida.push({
      id: id,
      date: data(l[1], fuso),
      ticker: String(l[2]).trim().toUpperCase(),
      type: /^v/i.test(String(l[3])) ? "V" : "C",
      qty: numero(l[4]),
      price: numero(l[5]),
      fees: numero(l[6]) || undefined,
    });
  }
  return saida;
}

function gravar(ops) {
  var a = aba();
  var total = a.getLastRow();
  if (total > 1) a.getRange(2, 1, total - 1, COLUNAS.length).clearContent();
  if (!ops.length) return;
  var linhas = ops.map(function (o) {
    return [String(o.id), paraData(o.date), String(o.ticker), o.type === "V" ? "Venda" : "Compra", Number(o.qty), Number(o.price), o.fees ? Number(o.fees) : ""];
  });
  a.getRange(2, 1, linhas.length, COLUNAS.length).setValues(linhas);
  a.getRange(2, 2, linhas.length, 1).setNumberFormat("dd/mm/yyyy");
}

/** Aba "Calculadora" com o link pessoal, para abrir a carteira conectada em qualquer aparelho. */
function gravarLink(link) {
  if (!/^https:\/\/[^\s"]+#conectar=[A-Za-z0-9_\-]+$/.test(link)) return;
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var a = planilha.getSheetByName(ABA_LINK);
  if (!a) a = planilha.insertSheet(ABA_LINK);
  var formula = '=HYPERLINK("' + link + '";"Abrir a Calculadora Graham conectada")';
  if (a.getRange(3, 1).getFormula() === formula) return;
  a.getRange(1, 1).setValue("Calculadora Graham B3");
  a.getRange(3, 1).setFormula(formula);
  a.getRange(5, 1).setValue("Clique no link em qualquer navegador ou celular: a carteira abre já conectada a esta planilha.");
  a.getRange(6, 1).setValue("Não compartilhe este link: ele dá acesso às suas operações. Para trocar, mude a CHAVE no Apps Script e conecte de novo.");
}

/** Data da planilha (Date, "dd/mm/aaaa" ou "aaaa-mm-dd") para "aaaa-mm-dd". */
function data(v, fuso) {
  if (Object.prototype.toString.call(v) === "[object Date]") return Utilities.formatDate(v, fuso, "yyyy-MM-dd");
  var s = String(v || "").trim();
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return s;
}

/** Meio-dia evita que o fuso horário troque o dia. */
function paraData(iso) {
  var p = String(iso).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
}

/** Número da planilha ("1.234,56", "1234.56" ou número) para número. */
function numero(v) {
  if (typeof v === "number") return v;
  var s = String(v || "").trim();
  if (!s) return 0;
  // formato brasileiro: "1.234,56" ou milhar sem decimais "1.000"
  if (s.indexOf(",") >= 0 || /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s);
}
