import { useEffect, useMemo, useRef, useState } from "react";

declare const __REPO__: string;
declare const __BRANCH__: string;
import script from "../../apps-script/Codigo.gs";
import type { Operation } from "@/core/portfolio";
import { applyRemote, currentOperations, syncOnOpen, useSyncState } from "@/web/hooks";
import { lockAccess, unlockAccess } from "@/core/vault";
import { getAccessVault } from "@/web/data";
import { connect, disconnect, getSheetsConfig, pushNow, takePendingLink } from "@/web/sync";
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
  const [vaultOpen, setVaultOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [others, setOthers] = useState(false);
  const vault = getAccessVault();
  const codeRef = useRef<HTMLPreElement>(null);
  const code = useMemo(() => withKey(key), [key]);

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2500);
  };

  const doConnect = async (target: { url: string; key: string }, via: "link" | "form" | "password") => {
    setBusy(true);
    setMsg(null);
    try {
      const { ops: remote, skipped } = await connect(target);
      const local = own(currentOperations());
      const note = skipped ? ` ${skipped} linhas incompletas da planilha foram ignoradas.` : "";
      const intro = via === "link" ? "Conectado pelo seu link pessoal." : via === "password" ? "Senha aceita, carteira conectada." : "Conectado.";
      if (!remote.length) {
        if (local.length) await pushNow(local);
        else await pushNow([]); // grava o link pessoal na planilha (script versão 2)
        setMsg({ ok: true, text: local.length ? `${intro} ${local.length} ${local.length === 1 ? "operação deste navegador foi enviada" : "operações deste navegador foram enviadas"} para a planilha.${note}` : `${intro} A planilha está vazia: as próximas operações vão para lá.${note}` });
      } else if (!local.length) {
        applyRemote(remote);
        setMsg({ ok: true, text: `${intro} ${remote.length} ${remote.length === 1 ? "operação carregada" : "operações carregadas"} da planilha.${note}` });
      } else setChoice({ remote, local });
      setMode("closed");
      setVaultOpen(false);
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

  const enter = async () => {
    if (!vault) return;
    setBusy(true);
    setMsg(null);
    let access;
    try {
      access = await unlockAccess(vault, password);
    } catch (e) {
      setBusy(false);
      setMsg({ ok: false, text: (e as Error).message === "senha incorreta" ? "Senha incorreta." : `Não foi possível abrir o acesso: ${(e as Error).message}` });
      return;
    }
    setPassword("");
    await doConnect(access, "password");
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

  if (cfg) {
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
            <Button variant={vaultOpen ? "ghost" : "primary"} onClick={() => setVaultOpen((v) => !v)}>
              {vaultOpen ? "Fechar" : "Senha de acesso"}
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
                    setMsg({ ok: true, text: vault ? "Você saiu deste navegador. As operações continuam na planilha; para voltar, digite a senha." : "Desconectado neste navegador. As operações continuam na planilha." });
                  }}
                >
                  Sair deste navegador
                </Button>
                <Button variant="ghost" onClick={() => setConfirmOff(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmOff(true)}>
                Sair
              </Button>
            )}
          </span>
        </div>
        {choice && <Choice choice={choice} onDone={(t) => (setChoice(null), setMsg({ ok: true, text: t }))} />}
        {msg && <Msg msg={msg} />}
        {vaultOpen && <VaultPanel access={{ url: cfg.url, key: cfg.key }} hasVault={!!vault} />}
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Você também pode editar a aba “Operações” direto na planilha; alterações dos dois lados são juntadas.</p>
      </Card>
    );
  }

  if (vault && !others)
    return (
      <Card className="mb-5">
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void enter();
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-sm font-medium">Sua carteira está no Google Planilhas</p>
            <p className="text-sm text-ink-2">Digite a senha para abrir. Este navegador fica conectado até você sair.</p>
          </div>
          <label className="text-xs text-ink-2">
            Senha
            <input id="vault-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} mt-1 w-56`} />
          </label>
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy && <Spinner />}
            Entrar
          </Button>
        </form>
        {msg && <Msg msg={msg} />}
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          <button type="button" className="underline" onClick={() => setOthers(true)}>
            Outras formas de conectar
          </button>{" "}
          (endereço e chave, ou criar outra planilha)
        </p>
      </Card>
    );

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

/** Gera o acesso criptografado com a senha escolhida e mostra como salvá-lo no site. */
function VaultPanel({ access, hasVault }: { access: { url: string; key: string }; hasVault: boolean }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const field = "w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm";
  const weak = pw.length > 0 && (pw.length < 10 || !/[^a-z0-9]/i.test(pw) || /^[a-z]+\d+$/i.test(pw));

  const generate = async () => {
    setError(null);
    if (pw !== pw2) return setError("As duas senhas não conferem.");
    setBusy(true);
    try {
      const v = await lockAccess(access, pw);
      await unlockAccess(v, pw); // confere antes de mostrar
      setCode(JSON.stringify(v, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const file = "data/acesso.json";
  const github = code
    ? hasVault
      ? `https://github.com/${__REPO__}/edit/${__BRANCH__}/${file}`
      : `https://github.com/${__REPO__}/new/${__BRANCH__}?filename=${encodeURIComponent(file)}&value=${encodeURIComponent(code)}`
    : "";

  return (
    <div className="grid grid-cols-1 gap-5 border-t border-line p-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3 text-sm">
        <p className="font-medium">{hasVault ? "Trocar a senha de acesso" : "Guardar o acesso no site, com senha"}</p>
        <p className="text-ink-2">
          {hasVault
            ? "O site já guarda o acesso à sua planilha. Para trocar a senha, gere um código novo e substitua o arquivo no GitHub."
            : "Nos outros navegadores e no celular, basta digitar a senha: o endereço da planilha e a chave ficam guardados no site, criptografados com ela."}
        </p>
        <label className="block text-xs text-ink-2">
          Senha
          <input id="vault-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-ink-2">
          Repita a senha
          <input id="vault-new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={`${field} mt-1`} />
        </label>
        {weak && <p className="text-xs text-warn">Senha fraca: o código fica público no site e uma senha curta ou previsível pode ser descoberta. Prefira 12+ caracteres com símbolos.</p>}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <Button variant="primary" onClick={generate} disabled={busy || !pw || !pw2}>
          {busy && <Spinner />}
          Gerar acesso
        </Button>
        <p className="text-xs text-ink-3">A senha não fica guardada em lugar nenhum. Se esquecer, gere de novo aqui, num navegador conectado.</p>
      </div>
      <div className="min-w-0 space-y-3 text-sm">
        {code ? (
          <>
            <p className="font-medium">Salve no site (uma vez)</p>
            <ol className="list-decimal space-y-1 pl-5 text-ink-2">
              {hasVault ? (
                <>
                  <li>Copie o código abaixo.</li>
                  <li>
                    Abra o arquivo no GitHub, apague o conteúdo, cole o código e clique em <strong>Commit changes</strong>.
                  </li>
                </>
              ) : (
                <li>
                  Abra o GitHub pelo botão abaixo (o arquivo já vem preenchido) e clique em <strong>Commit changes</strong>.
                </li>
              )}
              <li>Em uns 5 minutos o site se atualiza sozinho. Daí em diante, qualquer navegador abre a carteira com a senha.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <a href={github} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90">
                {hasVault ? "Abrir o arquivo no GitHub" : "Salvar no GitHub"}
              </a>
              <Button
                onClick={async () => {
                  if (await copyText(code, ref.current)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }
                }}
              >
                {copied ? "Copiado" : "Copiar código"}
              </Button>
            </div>
            <pre ref={ref} className="max-h-48 overflow-auto rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed">
              {code}
            </pre>
            <p className="text-xs text-ink-3">Este código pode ficar público: sem a senha ele não abre. Se preferir, mande-o para quem cuida do site salvar.</p>
          </>
        ) : (
          <p className="text-ink-3">Depois de gerar, aparece aqui o código e o botão para salvar no GitHub.</p>
        )}
      </div>
    </div>
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
