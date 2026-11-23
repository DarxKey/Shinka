/**
 * La sezione Shinka Desktop delle Impostazioni (ADR 0049): quale versione dell'app il centro serve
 * agli aggiornamenti, e da quando; e la pubblicazione di una nuova, presa dalla cartella del
 * progetto Shinka Desktop in cui electron-builder l'ha costruita, con la password di Shinka.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { StatoDesktop } from "../../src/protocollo/desktop.ts";
import type { VoceProgetto } from "../../src/protocollo/progetti.ts";
import { leggiDesktop, pubblicaDesktop } from "./api.ts";
import { momentoInBreve } from "./descrivi.ts";

const CHIAVE_SCELTE = "shinka.desktop.pubblicazione";

function scelteRicordate(): { idProgetto?: string; cartella?: string } {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_SCELTE) ?? "{}") as { idProgetto?: string; cartella?: string };
  } catch {
    return {};
  }
}

export function SezioneDesktop({ progetti }: { progetti: readonly VoceProgetto[] }): ReactNode {
  const [stato, setStato] = useState<StatoDesktop>();
  const ricordate = scelteRicordate();
  const proposto = progetti.find((progetto) => progetto.id === ricordate.idProgetto) ?? progetti.find((progetto) => /desktop/i.test(progetto.nome)) ?? progetti[0];
  const [idProgetto, setIdProgetto] = useState(proposto?.id ?? "");
  const [cartella, setCartella] = useState(ricordate.cartella ?? "dist");
  const [password, setPassword] = useState("");
  const [lavoro, setLavoro] = useState(false);
  const [esito, setEsito] = useState<{ errore?: string; fatto?: string }>({});

  useEffect(() => {
    leggiDesktop()
      .then(setStato)
      .catch(() => setStato({}));
  }, []);
  useEffect(() => {
    if (idProgetto === "" && proposto !== undefined) setIdProgetto(proposto.id);
  }, [idProgetto, proposto]);

  const pubblicata = stato?.pubblicata;
  return (
    <section aria-labelledby="titolo-desktop" className="sezione-desktop">
      <h2 id="titolo-desktop">Shinka Desktop</h2>
      <p className="tenue">
        L'app per Windows si aggiorna da qui: all'avvio e ogni qualche ora chiede al centro se c'è una versione nuova, e la scarica da sola.
      </p>
      {stato !== undefined && (
        <p>
          {pubblicata === undefined ? (
            "Nessuna versione pubblicata."
          ) : (
            <>
              Pubblicata la versione <strong>{pubblicata.versione}</strong>, {momentoInBreve(pubblicata.quando)} ({pubblicata.dimensione < 1024 * 1024 ? `${Math.max(1, Math.round(pubblicata.dimensione / 1024))} KB` : `${(pubblicata.dimensione / 1024 / 1024).toFixed(1)} MB`}).
            </>
          )}
        </p>
      )}
      <form
        className="modulo-impostazioni pubblica-desktop"
        onSubmit={(evento) => {
          evento.preventDefault();
          setLavoro(true);
          setEsito({});
          localStorage.setItem(CHIAVE_SCELTE, JSON.stringify({ idProgetto, cartella }));
          pubblicaDesktop({ idProgetto, cartella, password })
            .then((nuovo) => {
              setStato(nuovo);
              setPassword("");
              setEsito({ fatto: `Pubblicata la versione ${nuovo.pubblicata?.versione ?? ""}: le app la prendono al prossimo controllo.` });
            })
            .catch((causa: unknown) => setEsito({ errore: causa instanceof Error ? causa.message : "Non si è pubblicata." }))
            .finally(() => setLavoro(false));
        }}
      >
        <p className="tenue">
          Per pubblicarne una nuova: il progetto in cui l'hai costruita e la cartella in cui electron-builder ha messo latest.yml, l'installer e il suo
          .blockmap. Il centro li prende da lì, controlla che l'installer sia quello di latest.yml e che la versione venga dopo quella pubblicata.
        </p>
        <label>
          Progetto
          <select value={idProgetto} onChange={(evento) => setIdProgetto(evento.target.value)} required disabled={lavoro}>
            {progetti.length === 0 && <option value="">Nessun progetto</option>}
            {progetti.map((progetto) => (
              <option key={progetto.id} value={progetto.id}>
                {progetto.nome} · {progetto.nomeAmbiente}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cartella nel progetto
          <input value={cartella} onChange={(evento) => setCartella(evento.target.value)} placeholder="dist" spellCheck={false} autoCapitalize="none" disabled={lavoro} />
        </label>
        <label>
          Password di Shinka
          <input type="password" value={password} onChange={(evento) => setPassword(evento.target.value)} autoComplete="current-password" required disabled={lavoro} />
        </label>
        <div className="pulsanti">
          <button type="submit" className="approva" disabled={lavoro || idProgetto === "" || password === ""}>
            {lavoro ? "Pubblico…" : "Pubblica"}
          </button>
        </div>
        {esito.fatto !== undefined && (
          <p className="tenue" role="status">
            {esito.fatto}
          </p>
        )}
        {esito.errore !== undefined && (
          <p className="errore" role="alert">
            {esito.errore}
          </p>
        )}
      </form>
    </section>
  );
}
