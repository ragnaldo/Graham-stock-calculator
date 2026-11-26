import { useEffect, useMemo, useRef, useState } from "react";
import script from "../../apps-script/Codigo.gs";
import type { Operation } from "@/core/portfolio";
import { applyRemote, currentOperations, syncOnOpen, useSyncState } from "@/web/hooks";
import qrcode from "qrcode-generator";
import { connect, disconnect, getSheetsConfig, personalLink, pushNow, takePendingLink } from "@/web/sync";
import { Button, Card, Spinner } from "./ui";

const randomKey = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18);
};
const DRAFT_KEY = "graham:sheets:draftkey";
/** Chave sugerida, guardada para não mudar se a página recarregar antes de conectar. */
function draftKey() {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) return saved;
    const k = randomKey();
    localStorage.setItem(DRAFT_KEY, k);
    return k;
  } catch {
    return randomKey();
  }
}
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const own = (ops: Operation[]) => ops.filter((o) => !o.id.startsWith("exemplo-"));

/** Copia para a área de transferência; se o navegador não deixar, seleciona o texto do elemento. */
async function copyText(text: string, el: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const sel = window.getSelection();
    if (sel && el) {
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return false;
  }
}

const withKey = (key: string) =>
  script
    .replace(" *  1. Troque a CHAVE abaixo por uma senha só sua (ela vai no app junto com o endereço).", " *  1. A CHAVE abaixo já veio preenchida pela calculadora (é a mesma do app).")
    .replace('var CHAVE = "troque-esta-chave";', `var CHAVE = "${key.replace(/["\\]/g, "")}";`);

/** QR code em SVG (desenhado aqui, sem depender de serviço externo). */
function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${path.n} ${path.n}`} width={size} height={size} role="img" aria-label="QR code do link pessoal" className="rounded-lg border border-line" shapeRendering="crispEdges">
      <rect width={path.n} height={path.n} fill="#ffffff" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}

/** Card de conexão com o Google Planilhas na tela da carteira. */
export function SheetsSync() {
  const state = useSyncState();
  const cfg = getSheetsConfig();
  const [mode, setMode] = useState<"closed" | "existing" | "new">("closed");
  const [url, setUrl] = useState("");
  const [existingKey, setExistingKey] = useState("");
  const [key, setKeyState] = useState(draftKey);
  const setKey = (k: string) => {
    setKeyState(k);
    try {
      localStorage.setItem(DRAFT_KEY, k);
    } catch {
      // sem armazenamento
    }
  };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [choice, setChoice] = useState<{ remote: Operation[]; local: Operation[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [share, setShare] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  const linkRef = useRef<HTMLParagraphElement>(null);
  const code = useMemo(() => withKey(key), [key]);

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2500);
  };

  const doConnect = async (target: { url: string; key: string }, via: "link" | "form") => {
    setBusy(true);
    setMsg(null);
    try {
      const { ops: remote, skipped } = await connect(target);
      const local = own(currentOperations());
      const note = skipped ? ` ${skipped} linhas incompletas da planilha foram ignoradas.` : "";
      const intro = via === "link" ? "Conectado pelo seu link pessoal." : "Conectado.";
      if (!remote.length) {
        if (local.length) await pushNow(local);
        else await pushNow([]); // grava o link pessoal na planilha (script versão 2)
        setMsg({ ok: true, text: local.length ? `${intro} ${local.length} ${local.length === 1 ? "operação deste navegador foi enviada" : "operações deste navegador foram enviadas"} para a planilha.${note}` : `${intro} A planilha está vazia: as próximas operações vão para lá.${note}` });
      } else if (!local.length) {
        applyRemote(remote);
        setMsg({ ok: true, text: `${intro} ${remote.length} ${remote.length === 1 ? "operação carregada" : "operações carregadas"} da planilha.${note}` });
      } else setChoice({ remote, local });
      setMode("closed");
      setShare(false);
    } catch (e) {
      setMsg({ ok: false, text: `Não conectou: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  // ao abrir a carteira: conecta pelo link pessoal, se veio por ele; senão traz a planilha (ou envia o pendente)
  useEffect(() => {
    const link = takePendingLink();
    const cur = getSheetsConfig();
    if (link && !(cur && cur.url === link.url && cur.key === link.key)) {
      void doConnect(link, "link");
      return;
    }
    syncOnOpen()
      .then((r) => r && r.skipped > 0 && setMsg({ ok: false, text: `${r.skipped} linhas da planilha foram ignoradas por estarem incompletas (papel, data, quantidade e preço são obrigatórios).` }))
      .catch(() => undefined); // o estado já mostra o erro
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncNow = async () => {
    setMsg(null);
    try {
      const r = await syncOnOpen(true);
      setMsg({ ok: true, text: r && r.skipped ? `Sincronizado. ${r.skipped} linhas incompletas foram ignoradas.` : "Sincronizado com a planilha." });
    } catch {
      // o estado mostra o erro
    }
  };

  const field = "w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm";

  if (cfg) {
    const link = personalLink(cfg);
    const oldScript = (cfg.scriptVersion ?? 1) < 2;
    const updatedCode = withKey(cfg.key);
    return (
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className={`h-2 w-2 rounded-full ${state.status === "error" ? "bg-bad" : "bg-good"}`} />
            Google Planilhas
          </span>
          <span className={`min-w-0 flex-1 ${state.status === "error" ? "text-bad" : "text-ink-2"}`} role="status">
            {(state.status === "loading" || busy) && (
              <>
                <Spinner /> Lendo a planilha…
              </>
            )}
            {state.status === "saving" && !busy && (
              <>
                <Spinner /> Salvando na planilha…
              </>
            )}
            {state.status === "ok" && !busy && `Sincronizado às ${time(state.at)}. Cada alteração é salva na planilha.`}
            {state.status === "error" && state.message}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button variant={share ? "ghost" : "primary"} onClick={() => setShare((v) => !v)}>
              {share ? "Fechar" : "Usar em outro navegador"}
            </Button>
            {cfg.sheetUrl && (
              <a href={cfg.sheetUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface-2">
                Abrir planilha
              </a>
            )}
            <Button onClick={syncNow} disabled={state.status === "loading" || state.status === "saving"}>
              Sincronizar agora
            </Button>
            {confirmOff ? (
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    disconnect();
                    setConfirmOff(false);
                    setMsg({ ok: true, text: "Desconectado neste navegador. As operações continuam na planilha; para voltar, use o seu link pessoal." });
                  }}
                >
                  Desconectar
                </Button>
                <Button variant="ghost" onClick={() => setConfirmOff(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmOff(true)}>
                Desconectar
              </Button>
            )}
          </span>
        </div>
        {choice && <Choice choice={choice} onDone={(t) => (setChoice(null), setMsg({ ok: true, text: t }))} />}
        {msg && <Msg msg={msg} />}
        {share && (
          <div className="grid grid-cols-1 gap-5 border-t border-line p-4 md:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-2">
              <QrCode text={link} />
              <span className="text-xs text-ink-3">Aponte a câmera do celular</span>
            </div>
            <div className="min-w-0 space-y-3 text-sm">
              <p className="font-medium">Seu link pessoal</p>
              <p ref={linkRef} className="num rounded-lg border border-line bg-bg px-3 py-2 text-xs break-all">
                {link}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={async () => (await copyText(link, linkRef.current)) && flash("link")}>
                  {copied === "link" ? "Link copiado" : "Copiar link"}
                </Button>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-ink-2">
                <li>Abra este link em qualquer navegador ou celular: a carteira já abre conectada, sem colar endereço nem chave.</li>
                <li>Salve nos favoritos. Com a sincronização do Chrome, Edge ou Safari ligada, ele aparece nos seus outros aparelhos.</li>
                <li>
                  {oldScript ? "Depois de atualizar o script (abaixo), o" : "O"} link também fica na aba <strong>Calculadora</strong> da sua planilha, para você achar de qualquer lugar.
                </li>
                <li className="text-warn">Quem tiver este link acessa e altera suas operações. Não compartilhe.</li>
              </ul>
              {oldScript && (
                <details className="rounded-lg border border-line p-3">
                  <summary className="cursor-pointer font-medium">Atualizar o script para guardar o link na planilha (opcional)</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
                    <li>Na planilha, abra Extensões → Apps Script, apague o código e cole este (já com a sua chave).</li>
                    <li>
                      Clique em <strong>Implantar → Gerenciar implantações</strong>, no lápis, escolha <strong>Versão: Nova versão</strong> e Implantar. O endereço continua o mesmo.
                    </li>
                  </ol>
                  <div className="mt-2 flex justify-end">
                    <Button onClick={async () => (await copyText(updatedCode, codeRef.current)) && flash("code")}>{copied === "code" ? "Copiado" : "Copiar código"}</Button>
                  </div>
                  <pre ref={codeRef} className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed">
                    {updatedCode}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Você também pode editar a aba “Operações” direto na planilha; alterações dos dois lados são juntadas.</p>
      </Card>
    );
  }

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Guardar a carteira no Google Planilhas</p>
          <p className="text-sm text-ink-2">Sem exportar e importar: cada alteração vai para uma planilha sua, e qualquer aparelho conectado lê de lá.</p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setMode((m) => (m === "existing" ? "closed" : "existing"))}>
            {mode === "existing" ? "Fechar" : "Já tenho a planilha"}
          </Button>
          <Button onClick={() => setMode((m) => (m === "new" ? "closed" : "new"))}>{mode === "new" ? "Fechar" : "Criar planilha"}</Button>
        </span>
      </div>
      {busy && (
        <p role="status" className="mx-4 mb-3 text-sm text-ink-2">
          <Spinner /> Conectando…
        </p>
      )}
      {msg && <Msg msg={msg} />}

      {mode === "existing" && (
        <div className="grid grid-cols-1 gap-5 border-t border-line p-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2 text-sm">
            <p className="font-medium">O jeito mais fácil: abra o seu link pessoal</p>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>
                No navegador onde a carteira já está conectada: <strong>Minha carteira → Usar em outro navegador</strong>. Copie o link ou leia o QR code com o celular.
              </li>
              <li>
                Ou abra a sua planilha no Google e clique no link da aba <strong>Calculadora</strong> (aparece depois que o script é atualizado para a versão 2).
              </li>
              <li>Se salvou o link nos favoritos, é só abrir.</li>
            </ul>
            <p className="text-xs text-ink-3">Não é preciso criar outra planilha nem colar o código de novo.</p>
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium">Ou informe o endereço e a chave</p>
            <label className="block text-xs text-ink-2">
              Endereço do app da Web
              <input id="sheets-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className={`${field} mt-1`} autoComplete="off" />
            </label>
            <label className="block text-xs text-ink-2">
              Chave
              <input id="sheets-key" value={existingKey} onChange={(e) => setExistingKey(e.target.value)} placeholder='o texto entre aspas em var CHAVE = "…"' className={`${field} num mt-1`} autoComplete="off" />
            </label>
            <p className="text-xs text-ink-3">
              A chave está na linha <code>var CHAVE</code> do código no Apps Script. O endereço fica em Implantar → Gerenciar implantações.
            </p>
            <Button variant="primary" onClick={() => doConnect({ url, key: existingKey }, "form")} disabled={busy || !url || !existingKey}>
              Conectar
            </Button>
          </div>
        </div>
      )}

      {mode === "new" && (
        <div className="grid grid-cols-1 gap-5 border-t border-line p-4 lg:grid-cols-2">
          <ol className="min-w-0 list-decimal space-y-3 pl-5 text-sm">
            <li>
              Crie uma planilha nova no Google:{" "}
              <a className="text-accent underline" href="https://sheets.new" target="_blank" rel="noreferrer">
                sheets.new
              </a>
              .
            </li>
            <li>
              Na planilha, abra <strong>Extensões → Apps Script</strong>. Apague o que estiver no editor e cole o código ao lado. Ele já vem com a sua chave.
            </li>
            <li>
              Clique em <strong>Implantar → Nova implantação</strong>, escolha o tipo <strong>App da Web</strong>, deixe <strong>Executar como: Eu</strong> e{" "}
              <strong>Quem pode acessar: Qualquer pessoa</strong>. Clique em Implantar e autorize o acesso à sua planilha (o Google avisa que o app não é verificado: clique em
              Avançado e prossiga, o código é o que você colou).
            </li>
            <li>Copie o endereço do <strong>App da Web</strong> (termina em /exec) e cole abaixo.</li>
            <li className="list-none">
              <div className="grid gap-2">
                <label className="text-xs text-ink-2">
                  Endereço do app da Web
                  <input id="sheets-new-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className={`${field} mt-1`} autoComplete="off" />
                </label>
                <label className="text-xs text-ink-2">
                  Chave (a mesma do código)
                  <input id="sheets-new-key" value={key} onChange={(e) => setKey(e.target.value)} className={`${field} num mt-1`} autoComplete="off" />
                </label>
                <div>
                  <Button variant="primary" onClick={() => doConnect({ url, key }, "form")} disabled={busy || !url}>
                    {busy && <Spinner />}
                    Conectar e testar
                  </Button>
                </div>
                <p className="text-xs text-ink-3">Depois disso, nos outros navegadores use o link pessoal: não precisa repetir estes passos.</p>
              </div>
            </li>
          </ol>
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Código para o Apps Script</span>
              <Button onClick={async () => (await copyText(code, codeRef.current)) && flash("code")}>{copied === "code" ? "Copiado" : "Copiar código"}</Button>
            </div>
            <pre ref={codeRef} className="max-h-80 overflow-auto rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed">
              {code}
            </pre>
            <p className="mt-2 text-xs text-ink-3">
              A chave impede que outra pessoa com o endereço leia ou altere a planilha. Se trocar a chave aqui, copie o código de novo. Quem tiver o endereço e a chave juntos consegue
              mexer na aba “Operações”: não divulgue os dois.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Msg({ msg }: { msg: { ok: boolean; text: string } }) {
  return (
    <p role="status" className={`mx-4 mb-3 rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-good/40 bg-good-soft text-good" : "border-warn/40 bg-warn-soft text-warn"}`}>
      {msg.text}
    </p>
  );
}

/** Planilha e navegador com operações diferentes: o usuário escolhe qual vale. */
function Choice({ choice, onDone }: { choice: { remote: Operation[]; local: Operation[] }; onDone: (text: string) => void }) {
  return (
    <div className="mx-4 mb-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-3 text-sm">
      <p className="mb-2">
        A planilha já tem {choice.remote.length} operações e este navegador tem {choice.local.length}. Qual lista vale?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            applyRemote(choice.remote);
            onDone(`Usando as ${choice.remote.length} operações da planilha.`);
          }}
        >
          Usar as da planilha
        </Button>
        <Button
          onClick={async () => {
            await pushNow(choice.local).catch(() => undefined);
            onDone(`As ${choice.local.length} operações deste navegador foram para a planilha.`);
          }}
        >
          Enviar as deste navegador
        </Button>
        <Button
          onClick={async () => {
            const ids = new Set(choice.remote.map((o) => o.id));
            const merged = [...choice.remote, ...choice.local.filter((o) => !ids.has(o.id))];
            applyRemote(merged);
            await pushNow(merged).catch(() => undefined);
            onDone(`Listas somadas: ${merged.length} operações na planilha.`);
          }}
        >
          Juntar as duas
        </Button>
      </div>
    </div>
  );
}
