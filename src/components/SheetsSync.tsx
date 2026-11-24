import { useEffect, useMemo, useRef, useState } from "react";
import script from "../../apps-script/Codigo.gs";
import type { Operation } from "@/core/portfolio";
import { applyRemote, currentOperations, syncOnOpen, useSyncState } from "@/web/hooks";
import { connect, disconnect, getSheetsConfig, pushNow } from "@/web/sync";
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

/** Card de conexão com o Google Planilhas na tela da carteira. */
export function SheetsSync() {
  const state = useSyncState();
  const cfg = getSheetsConfig();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
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
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);
  const code = useMemo(
    () =>
      script
        .replace(" *  1. Troque a CHAVE abaixo por uma senha só sua (ela vai no app junto com o endereço).", " *  1. A CHAVE abaixo já veio preenchida pela calculadora (é a mesma do app).")
        .replace('var CHAVE = "troque-esta-chave";', `var CHAVE = "${key.replace(/["\\]/g, "")}";`),
    [key],
  );

  // ao abrir a carteira, traz a planilha (ou envia alterações pendentes)
  useEffect(() => {
    syncOnOpen()
      .then((r) => r && r.skipped > 0 && setMsg({ ok: false, text: `${r.skipped} linhas da planilha foram ignoradas por estarem incompletas (papel, data, quantidade e preço são obrigatórios).` }))
      .catch(() => undefined); // o estado já mostra o erro
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // sem acesso à área de transferência: seleciona o texto para copiar à mão
      const sel = window.getSelection();
      if (sel && codeRef.current) {
        const r = document.createRange();
        r.selectNodeContents(codeRef.current);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  };

  const doConnect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { ops: remote, skipped } = await connect({ url, key });
      const local = own(currentOperations());
      const note = skipped ? ` ${skipped} linhas incompletas da planilha foram ignoradas.` : "";
      if (!remote.length) {
        if (local.length) await pushNow(local);
        setMsg({ ok: true, text: local.length ? `Conectado. ${local.length} ${local.length === 1 ? "operação deste navegador foi enviada" : "operações deste navegador foram enviadas"} para a planilha.${note}` : `Conectado. A planilha está vazia: as próximas operações vão para lá.${note}` });
      } else if (!local.length) {
        applyRemote(remote);
        setMsg({ ok: true, text: `Conectado. ${remote.length} ${remote.length === 1 ? "operação carregada" : "operações carregadas"} da planilha.${note}` });
      } else setChoice({ remote, local });
      setOpen(false);
    } catch (e) {
      setMsg({ ok: false, text: `Não conectou: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

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

  if (cfg)
    return (
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className={`h-2 w-2 rounded-full ${state.status === "error" ? "bg-bad" : "bg-good"}`} />
            Google Planilhas
          </span>
          <span className={`min-w-0 flex-1 ${state.status === "error" ? "text-bad" : "text-ink-2"}`} role="status">
            {state.status === "loading" && (
              <>
                <Spinner /> Lendo a planilha…
              </>
            )}
            {state.status === "saving" && (
              <>
                <Spinner /> Salvando na planilha…
              </>
            )}
            {state.status === "ok" && `Sincronizado às ${time(state.at)}. Cada alteração é salva na planilha.`}
            {state.status === "error" && state.message}
          </span>
          <span className="flex flex-wrap gap-2">
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
                    setMsg({ ok: true, text: "Desconectado. As operações continuam na planilha e neste navegador." });
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
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Para usar em outro aparelho, conecte com o mesmo endereço e a mesma chave. Você também pode editar a aba “Operações” direto na planilha.</p>
      </Card>
    );

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Guardar a carteira no Google Planilhas</p>
          <p className="text-sm text-ink-2">Sem exportar e importar: cada alteração vai para uma planilha sua, e qualquer aparelho conectado lê de lá.</p>
        </div>
        <Button variant={open ? "ghost" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Fechar" : "Conectar planilha"}
        </Button>
      </div>
      {msg && <Msg msg={msg} />}
      {open && (
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
                  <input id="sheets-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" className={`${field} mt-1`} autoComplete="off" />
                </label>
                <label className="text-xs text-ink-2">
                  Chave (a mesma do código)
                  <input id="sheets-key" value={key} onChange={(e) => setKey(e.target.value)} className={`${field} num mt-1`} autoComplete="off" />
                </label>
                <div>
                  <Button variant="primary" onClick={doConnect} disabled={busy || !url}>
                    {busy && <Spinner />}
                    Conectar e testar
                  </Button>
                </div>
              </div>
            </li>
          </ol>
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Código para o Apps Script</span>
              <Button onClick={copy}>{copied ? "Copiado" : "Copiar código"}</Button>
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
