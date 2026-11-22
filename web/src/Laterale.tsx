import { useState, type ReactNode } from "react";
import type { VoceProgetto } from "../../src/protocollo/progetti.ts";
import { eliminaProgetto, fissaProgetto, rinominaProgetto } from "./api.ts";
import { leggiModoGruppi, raggruppaProgetti, scriviModoGruppi, type ModoGruppi } from "./barra.ts";
import { PulsanteAmbienti } from "./Ambienti.tsx";
import { MenuAspetto } from "./Aspetto.tsx";
import { condizioneInParole, filtraArgomenti, giornoInBreve, vaultInBreve } from "./descrivi.ts";
import type { Quadro } from "./Quadro.tsx";
import { frammentoDi, type Vista } from "./vista.ts";

export interface ProprietaLaterale {
  vista: Vista;
  quadro: Quadro;
  /** Quante skill sono nate o cambiate da quando il proprietario ha guardato la loro pagina. */
  skillNuove: number;
  /** Sugli schermi stretti la barra sta fuori dallo schermo finché non viene aperta. */
  aperta: boolean;
  /** Il proprietario ha scelto una voce: sugli schermi stretti la barra si richiude. */
  allaScelta: () => void;
  pannelloAmbientiAperto: boolean;
  alClicAmbienti: () => void;
  /** Apre la palette dei comandi. */
  alVaiA: () => void;
  allUscita: () => void;
}

/** Da quanti argomenti archiviati in su compare il campo per cercarli. */
const ARGOMENTI_PER_CERCARE = 6;

/**
 * La barra laterale: la Home in cima con i suoi argomenti archiviati,
 * poi i progetti con il loro ambiente e la loro condizione, e in fondo memoria, skill, estensioni e vault.
 */
export function Laterale(proprieta: ProprietaLaterale): ReactNode {
  const { vista, quadro, aperta, allaScelta } = proprieta;
  const progetti = quadro.progetti?.progetti;
  const archiviati = quadro.argomenti?.archiviati ?? [];
  const [cercato, setCercato] = useState("");
  const [argomentiAperti, setArgomentiAperti] = useState(false);
  const trovati = filtraArgomenti(archiviati, cercato);
  // Chi sta rileggendo un argomento archiviato lo vede nell'elenco, anche se lo aveva richiuso.
  const elencoAperto = argomentiAperti || vista.tipo === "argomento";
  const voci = quadro.memoria?.voci.length;
  const skill = quadro.skill?.skill.length;
  const estensioni = quadro.estensioni?.estensioni.length;
  const vault = vaultInBreve(quadro.vault);
  const condizioneHome = quadro.home?.condizione ?? "fermo";
  const [modo, setModo] = useState<ModoGruppi>(leggiModoGruppi);
  const gruppi = progetti === undefined ? [] : raggruppaProgetti(progetti, modo);

  return (
    <nav className={aperta ? "laterale aperta" : "laterale"} aria-label="Home e progetti">
      <div className="marchio">
        Shinka
        <button type="button" className="discreto mini vai-a" title="Vai a un progetto, un argomento o una pagina (Ctrl+K)" onClick={proprieta.alVaiA}>
          Vai a… <kbd>Ctrl K</kbd>
        </button>
      </div>

      <a
        className={`voce ${condizioneHome}${vista.tipo === "home" ? " attuale" : ""}`}
        href={frammentoDi({ tipo: "home" })}
        aria-current={vista.tipo === "home" ? "page" : undefined}
        onClick={allaScelta}
      >
        <span className="nome">Home</span>
        {/* Come per i progetti: si vede da qui se la Home lavora o se aspetta una risposta. */}
        {condizioneHome !== "fermo" && (
          <span className="dettaglio">
            <span className="condizione">{condizioneInParole(condizioneHome)}</span>
          </span>
        )}
      </a>

      {archiviati.length > 0 && (
        <details
          className="argomenti"
          open={elencoAperto}
          onToggle={(evento) => setArgomentiAperti(evento.currentTarget.open)}
        >
          <summary>Argomenti archiviati ({archiviati.length})</summary>
          {archiviati.length >= ARGOMENTI_PER_CERCARE && (
            <input
              type="search"
              aria-label="Cerca tra gli argomenti archiviati"
              placeholder="Cerca…"
              value={cercato}
              onChange={(evento) => setCercato(evento.target.value)}
            />
          )}
          <div className="elenco-argomenti">
            {trovati.length === 0 && <p className="tenue">Nessun argomento corrisponde.</p>}
            {trovati.map((argomento) => {
              const attuale = vista.tipo === "argomento" && vista.id === argomento.id;
              return (
                <a
                  key={argomento.id}
                  className={attuale ? "voce attuale" : "voce"}
                  href={frammentoDi({ tipo: "argomento", id: argomento.id })}
                  aria-current={attuale ? "page" : undefined}
                  title={argomento.riassunto === "" ? undefined : argomento.riassunto}
                  onClick={allaScelta}
                >
                  <span className="nome">{argomento.titolo}</span>
                  <span className="dettaglio">{giornoInBreve(argomento.archiviatoIl)}</span>
                </a>
              );
            })}
          </div>
        </details>
      )}

      <div className="testa-progetti">
        <h2>Progetti</h2>
        <a
          className={vista.tipo === "nuovo-progetto" ? "nuovo-progetto attuale" : "nuovo-progetto"}
          href={frammentoDi({ tipo: "nuovo-progetto" })}
          aria-label="Nuovo progetto"
          title="Nuovo progetto"
          onClick={allaScelta}
        >
          +
        </a>
        {(progetti?.length ?? 0) > 1 && (
          <select
            aria-label="Raggruppa i progetti"
            title="Raggruppa i progetti"
            value={modo}
            onChange={(evento) => {
              const scelto = evento.target.value as ModoGruppi;
              setModo(scelto);
              scriviModoGruppi(scelto);
            }}
          >
            <option value="nessuno">Tutti insieme</option>
            <option value="ambiente">Per ambiente</option>
            <option value="stato">Per stato</option>
          </select>
        )}
      </div>
      <div className="elenco-progetti">
        {progetti === undefined && <p className="tenue">Carico…</p>}
        {progetti?.length === 0 && (
          <p className="tenue">Ancora nessuno. Chiedi un lavoro lungo alla Home: ti proporrà un progetto. Oppure creane uno da te, con il «+» qui sopra.</p>
        )}
        {gruppi.map((gruppo, posizione) => (
          <div key={gruppo.titolo ?? posizione} className="gruppo-progetti" role="group" aria-label={gruppo.titolo ?? "Progetti"}>
            {gruppo.titolo !== undefined && <h3 className="titolo-gruppo">{gruppo.titolo}</h3>}
            {gruppo.progetti.map((progetto) => (
              <VoceProgettoLaterale
                key={progetto.id}
                progetto={progetto}
                attuale={vista.tipo === "progetto" && vista.id === progetto.id}
                allaScelta={allaScelta}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="sapere">
        <a
          className={vista.tipo === "cerca" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "cerca" })}
          aria-current={vista.tipo === "cerca" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Cerca</span>
        </a>
        <a
          className={vista.tipo === "programmati" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "programmati" })}
          aria-current={vista.tipo === "programmati" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Programmati</span>
        </a>
        <a
          className={vista.tipo === "uso" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "uso" })}
          aria-current={vista.tipo === "uso" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Uso</span>
        </a>
        <a
          className={vista.tipo === "archiviazione" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "archiviazione" })}
          aria-current={vista.tipo === "archiviazione" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Archiviazione</span>
        </a>
        <a
          className={vista.tipo === "elaborati" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "elaborati" })}
          aria-current={vista.tipo === "elaborati" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Elaborati</span>
        </a>
        <a
          className={vista.tipo === "memoria" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "memoria" })}
          aria-current={vista.tipo === "memoria" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Memoria</span>
          {voci !== undefined && <span className="quanti">{voci}</span>}
        </a>
        <a
          className={vista.tipo === "skill" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "skill" })}
          aria-current={vista.tipo === "skill" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Skill</span>
          {proprieta.skillNuove > 0 ? (
            <span className="novita" aria-label={`${proprieta.skillNuove} nuove o cambiate`}>
              {proprieta.skillNuove === 1 ? "1 novità" : `${proprieta.skillNuove} novità`}
            </span>
          ) : (
            skill !== undefined && <span className="quanti">{skill}</span>
          )}
        </a>
        <a
          className={vista.tipo === "estensioni" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "estensioni" })}
          aria-current={vista.tipo === "estensioni" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Estensioni</span>
          {estensioni !== undefined && <span className="quanti">{estensioni}</span>}
        </a>
        <a
          className={vista.tipo === "vault" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "vault" })}
          aria-current={vista.tipo === "vault" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Vault</span>
          {vault !== undefined && <span className="quanti">{vault}</span>}
        </a>
        <a
          className={vista.tipo === "impostazioni" ? "voce attuale" : "voce"}
          href={frammentoDi({ tipo: "impostazioni" })}
          aria-current={vista.tipo === "impostazioni" ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">Impostazioni</span>
        </a>
      </div>

      <MenuAspetto />
      <div className="piede">
        <PulsanteAmbienti
          stato={quadro.ambienti}
          aperto={proprieta.pannelloAmbientiAperto}
          alClic={proprieta.alClicAmbienti}
        />
        <button type="button" className="discreto" onClick={proprieta.allUscita}>
          Esci
        </button>
      </div>
    </nav>
  );
}

/** Un progetto nella barra: il collegamento, e il menu per fissarlo, rinominarlo o eliminarlo. */
function VoceProgettoLaterale({ progetto, attuale, allaScelta }: { progetto: VoceProgetto; attuale: boolean; allaScelta: () => void }): ReactNode {
  const [inRinomina, setInRinomina] = useState<string>();
  const [elimina, setElimina] = useState(false);
  const [errore, setErrore] = useState<string>();
  const [lavoro, setLavoro] = useState(false);
  const chiudiMenu = (evento: { currentTarget: HTMLElement }): void => evento.currentTarget.closest("details")?.removeAttribute("open");
  const fai = async (azione: () => Promise<void>): Promise<boolean> => {
    setLavoro(true);
    setErrore(undefined);
    try {
      await azione();
      return true;
    } catch (causa) {
      setErrore(causa instanceof Error ? causa.message : "Non è riuscito.");
      return false;
    } finally {
      setLavoro(false);
    }
  };
  return (
    <div className="riga-progetto">
      {inRinomina === undefined ? (
        <a
          className={`voce ${progetto.condizione}${attuale ? " attuale" : ""}`}
          href={frammentoDi({ tipo: "progetto", id: progetto.id })}
          aria-current={attuale ? "page" : undefined}
          onClick={allaScelta}
        >
          <span className="nome">
            {progetto.nome}
            {progetto.diShinka === true && <span className="etichetta-shinka">questa Shinka</span>}
          </span>
          <span className="dettaglio">
            <span className="ambiente">{progetto.nomeAmbiente}</span>
            <span className="condizione">{condizioneInParole(progetto.condizione)}</span>
          </span>
        </a>
      ) : (
        <form
          className="rinomina-progetto"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (inRinomina.trim() === "") return;
            void fai(() => rinominaProgetto(progetto.id, inRinomina)).then((riuscito) => riuscito && setInRinomina(undefined));
          }}
        >
          <input
            aria-label={`Nuovo nome di ${progetto.nome}`}
            value={inRinomina}
            maxLength={60}
            autoFocus
            disabled={lavoro}
            onChange={(evento) => setInRinomina(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Escape") setInRinomina(undefined);
            }}
          />
          <button type="submit" className="mini approva" disabled={lavoro || inRinomina.trim() === ""}>
            Salva
          </button>
        </form>
      )}
      {inRinomina === undefined && (
        <details className="menu-progetto">
          <summary aria-label={`Altro su ${progetto.nome}`} title="Fissa, rinomina, elimina">
            ⋯
          </summary>
          <div className="voci-esporta">
            <button
              type="button"
              onClick={(evento) => {
                chiudiMenu(evento);
                void fai(() => fissaProgetto(progetto.id, progetto.fissato !== true));
              }}
            >
              {progetto.fissato === true ? "Togli dalla cima" : "Fissa in cima"}
            </button>
            <button
              type="button"
              onClick={(evento) => {
                chiudiMenu(evento);
                setInRinomina(progetto.nome);
              }}
            >
              Rinomina
            </button>
            {progetto.diShinka !== true && (
              <button
                type="button"
                className="pericolo"
                onClick={(evento) => {
                  chiudiMenu(evento);
                  setElimina(true);
                }}
              >
                Elimina…
              </button>
            )}
          </div>
        </details>
      )}
      {elimina && (
        <div className="conferma-annulla" role="alertdialog" aria-label={`Eliminare ${progetto.nome}`}>
          <p>
            «{progetto.nome}» sparisce da Shinka con la sua conversazione. La cartella con i suoi file resta in {progetto.nomeAmbiente}. Non si torna indietro.
          </p>
          <div className="pulsanti">
            <button
              type="button"
              className="mini pericolo"
              disabled={lavoro}
              onClick={() =>
                void fai(() => eliminaProgetto(progetto.id)).then((riuscito) => {
                  if (!riuscito) return;
                  setElimina(false);
                  if (attuale) window.location.hash = frammentoDi({ tipo: "home" });
                })
              }
            >
              Elimina
            </button>
            <button type="button" className="mini discreto" disabled={lavoro} onClick={() => setElimina(false)}>
              No
            </button>
          </div>
        </div>
      )}
      {errore !== undefined && <p className="errore">{errore}</p>}
    </div>
  );
}
