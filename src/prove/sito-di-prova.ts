/**
 * Un sito di prova, in ascolto solo su questa macchina: ha una pagina di accesso con nome utente
 * e password, e le pagine che servono a vedere che cosa il browser del gateway lascia passare.
 * Serve ai test del gateway e alla prova in locale.
 *
 * Ricorda ciò che gli è stato inviato: così un test controlla che la password sia arrivata al
 * sito giusto, e a nessun altro.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface OpzioniSitoDiProva {
  utente: string;
  password: string;
  /** La porta su cui ascoltare; se manca, una libera. */
  porta?: number;
  /** L'origine di un altro sito, la cui pagina di accesso viene mostrata in una cornice in `/cornice`. */
  altroSito?: string;
  /** Il nome che il sito mostra di sé. */
  nome?: string;
}

export interface SitoDiProva {
  porta: number;
  /** L'origine del sito, per esempio `http://127.0.0.1:8123`. */
  origine: string;
  /** Ciò che è stato inviato alla pagina di accesso, nell'ordine. */
  tentativi: { utente: string; password: string }[];
  /** I percorsi dei moduli inviati, diversi dall'accesso: per vedere che un divieto ha tenuto. */
  inviati: string[];
  chiudi(): Promise<void>;
}

function pagina(titolo: string, corpo: string): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${titolo}</title>
<style>body{font-family:sans-serif;max-width:40rem;margin:2rem auto}label{display:block;margin:.6rem 0}</style></head>
<body>${corpo}</body></html>`;
}

const MODULO_DI_ACCESSO = (azione: string, metodo: string): string => `
<form method="${metodo}" action="${azione}">
<label>Nome utente <input name="utente" autocomplete="username"></label>
<label>Password <input name="password" type="password" id="password" autocomplete="current-password"></label>
<label><input type="checkbox" onchange="document.getElementById('password').type = this.checked ? 'text' : 'password'"> Mostra password</label>
<button>Entra</button>
</form>`;

function leggiCorpo(richiesta: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((risolvi) => {
    const pezzi: Buffer[] = [];
    richiesta.on("data", (pezzo: Buffer) => pezzi.push(pezzo));
    richiesta.on("end", () => risolvi(new URLSearchParams(Buffer.concat(pezzi).toString("utf8"))));
  });
}

export function avviaSitoDiProva(opzioni: OpzioniSitoDiProva): Promise<SitoDiProva> {
  const nome = opzioni.nome ?? "Sito di prova";
  const sessioni = new Set<string>();
  const sito: SitoDiProva = { porta: 0, origine: "", tentativi: [], inviati: [], chiudi: () => Promise.resolve() };

  const dentro = (richiesta: IncomingMessage): boolean => {
    const cookie = /(?:^|;\s*)sessione=([^;]+)/.exec(richiesta.headers.cookie ?? "")?.[1];
    return cookie !== undefined && sessioni.has(cookie);
  };

  const rispondi = async (richiesta: IncomingMessage, risposta: ServerResponse): Promise<void> => {
    const indirizzo = new URL(richiesta.url ?? "/", "http://sito");
    const html = (titolo: string, corpo: string): void => {
      risposta.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      risposta.end(pagina(titolo, corpo));
    };
    const vai = (dove: string, intestazioni: Record<string, string> = {}): void => {
      risposta.writeHead(303, { location: dove, ...intestazioni });
      risposta.end();
    };

    switch (indirizzo.pathname) {
      case "/":
        return html(`${nome}: accesso`, `<h1>${nome}</h1><p>Entra con il tuo nome utente e la tua password.</p>${MODULO_DI_ACCESSO("/entra", "post")}`);

      case "/entra": {
        const campi = richiesta.method === "POST" ? await leggiCorpo(richiesta) : indirizzo.searchParams;
        const tentativo = { utente: campi.get("utente") ?? "", password: campi.get("password") ?? "" };
        sito.tentativi.push(tentativo);
        if (tentativo.utente !== opzioni.utente || tentativo.password !== opzioni.password) {
          return html(`${nome}: accesso`, `<h1>${nome}</h1><p role="alert">Nome utente o password sbagliati.</p>${MODULO_DI_ACCESSO("/entra", "post")}`);
        }
        const sessione = randomBytes(18).toString("base64url");
        sessioni.add(sessione);
        return vai("/dentro", { "set-cookie": `sessione=${sessione}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax` });
      }

      case "/dentro":
        if (!dentro(richiesta)) return vai("/");
        return html(
          `${nome}: area riservata`,
          `<h1>Benvenuto, ${opzioni.utente}</h1>
<p>Sei nell'area riservata di ${nome}. Il tuo saldo punti è 1234.</p>
<p><a href="/esci">Esci</a> · <a href="/nuova-password">Cambia password</a> · <a href="/elimina">Elimina account</a></p>
<h2>Ordine in corso</h2>
<form method="post" action="/paga">
<label>Numero della carta <input name="cardnumber" autocomplete="cc-number"></label>
<label>Note per la consegna <input name="note"></label>
<button>Paga ora</button>
</form>
<form method="post" action="/cerca"><label>Cerca nel sito <input name="cerca"></label><button>Cerca</button></form>`,
        );

      case "/esci":
        return vai("/", { "set-cookie": "sessione=; Path=/; Max-Age=0" });

      case "/paga":
      case "/elimina":
      case "/cambia":
      case "/cerca":
        sito.inviati.push(indirizzo.pathname);
        return html(`${nome}: fatto`, `<h1>Fatto</h1><p>Richiesta ricevuta: ${indirizzo.pathname}</p>`);

      // Una pagina che copia in chiaro ciò che si scrive nel campo password.
      case "/specchio":
        return html(
          `${nome}: accesso`,
          `<h1>${nome}</h1>${MODULO_DI_ACCESSO("/entra", "post")}
<p>Stai scrivendo: <span id="specchio"></span></p>
<script>
const campo = document.getElementById("password");
const mostra = () => { document.getElementById("specchio").textContent = campo.value; };
campo.addEventListener("input", mostra); campo.addEventListener("change", mostra);
</script>`,
        );

      // Un modulo che manda la password nell'indirizzo.
      case "/nell-indirizzo":
        return html(`${nome}: accesso`, `<h1>${nome}</h1>${MODULO_DI_ACCESSO("/ricevuto", "get")}`);

      case "/ricevuto":
        return html(`${nome}: ricevuto`, `<h1>Ricevuto</h1><p>Hai chiesto: ${richiesta.url ?? ""}</p>`);

      // Registrazione o cambio password: due campi password, di cui uno nuovo.
      case "/nuova-password":
        return html(
          `${nome}: cambia password`,
          `<h1>Cambia password</h1><form method="post" action="/cambia">
<label>Password attuale <input name="attuale" type="password" autocomplete="current-password"></label>
<label>Password nuova <input name="nuova" type="password" autocomplete="new-password"></label>
<button>Cambia password</button></form>`,
        );

      // Accesso in due passi: prima il nome utente, poi la password.
      case "/due-passi":
        return html(
          `${nome}: accesso`,
          `<h1>${nome}</h1><form method="get" action="/due-passi/password"><label>Indirizzo email <input name="utente" type="email" autocomplete="username"></label><button>Avanti</button></form>`,
        );

      case "/due-passi/password":
        return html(
          `${nome}: accesso`,
          `<h1>${nome}</h1><form method="post" action="/entra"><input type="hidden" name="utente" value="${(indirizzo.searchParams.get("utente") ?? "").replace(/[^\w.@+-]/g, "")}">
<label>Password <input name="password" type="password" autocomplete="current-password"></label><button>Entra</button></form>`,
        );

      // La pagina di accesso di un altro sito, dentro una cornice di questo.
      case "/cornice":
        return html(
          `${nome}: con una cornice`,
          `<h1>${nome}</h1><p>Qui sotto c'è la pagina di un altro sito.</p><iframe src="${opzioni.altroSito ?? ""}/" title="Altro sito" width="600" height="300"></iframe>`,
        );

      case "/avviso":
        return html(`${nome}: avviso`, `<h1>${nome}</h1><button onclick="document.title = confirm('Sei sicuro?') ? 'accettato' : 'annullato'">Chiedi conferma</button>`);

      default:
        risposta.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        risposta.end("Questa pagina non c'è.");
    }
  };

  const server = createServer((richiesta, risposta) => {
    void rispondi(richiesta, risposta).catch(() => {
      if (!risposta.headersSent) risposta.writeHead(500);
      risposta.end();
    });
  });
  sito.chiudi = () =>
    new Promise((risolvi) => {
      server.closeAllConnections();
      server.close(() => risolvi());
    });

  return new Promise((risolvi, rifiuta) => {
    server.once("error", rifiuta);
    server.listen(opzioni.porta ?? 0, "127.0.0.1", () => {
      sito.porta = (server.address() as AddressInfo).port;
      sito.origine = `http://127.0.0.1:${sito.porta}`;
      risolvi(sito);
    });
  });
}
