/**
 * La scheda Processi del pannello di un progetto: i processi che Shinka vi ha acceso (la conversazione
 * con i suoi comandi e i server delle estensioni, come CodeGraph, i terminali, l'applicazione) e
 * quelli dell'ambiente che sta usando, come il server di un modello locale. Processore e memoria si
 * aggiornano ogni pochi secondi finché la scheda è in vista; uno bloccato si termina, con ciò che ha
 * avviato.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { ProcessoDiShinka } from "../../src/protocollo/risorse.ts";
import { leggiRisorseAmbiente } from "./api.ts";
import { grandezzaInBreve as pesoInBreve } from "./descrivi.ts";
import { percento, RigheProcessi } from "./ElencoProcessi.tsx";
import { processiDelProgetto, progettiCheLoUsano } from "./processi.ts";
import { useQuadroCorrente } from "./Quadro.tsx";
import { frammentoDi } from "./vista.ts";

/** Ogni quanto si rileggono i processi, e quanta storia tiene la linea del processore. */
const OGNI_MS = 3_000;
const PUNTI = 60;

export function PannelloProcessi({ idProgetto, inVista }: { idProgetto: string; inVista: boolean }): ReactNode {
  const quadro = useQuadroCorrente();
  const tutti = quadro.progetti?.progetti ?? [];
  const progetto = tutti.find((uno) => uno.id === idProgetto);
  const idAmbiente = progetto?.idAmbiente;
  const spento = progetto?.condizione === "ambiente-spento";
  const [processi, setProcessi] = useState<ProcessoDiShinka[]>();
  const [motivo, setMotivo] = useState<string>();
  const [storia, setStoria] = useState<number[]>([]);

  useEffect(() => {
    if (idAmbiente === undefined || spento || !inVista) return;
    let vivo = true;
    let sveglia: ReturnType<typeof setTimeout> | undefined;
    const giro = async (): Promise<void> => {
      // Con la pagina in secondo piano non si chiede nulla: il nodo non lavora per nessuno.
      if (document.visibilityState === "visible") {
        try {
          const letto = await leggiRisorseAmbiente(idAmbiente);
          if (!vivo) return;
          if ("motivo" in letto) setMotivo(letto.motivo);
          else if (letto.processiDiShinka === undefined) setMotivo("Il nodo di questo ambiente non sa dire i suoi processi: va aggiornato.");
          else {
            setMotivo(undefined);
            setProcessi(letto.processiDiShinka);
          }
        } catch (causa) {
          if (vivo) setMotivo(causa instanceof Error ? causa.message : "I processi non si sono potuti leggere.");
        }
      }
      if (vivo) sveglia = setTimeout(() => void giro(), OGNI_MS);
    };
    void giro();
    return () => {
      vivo = false;
      clearTimeout(sveglia);
    };
  }, [idAmbiente, spento, inVista]);

  const delloStessoAmbiente = tutti.filter((uno) => uno.idAmbiente === idAmbiente);
  const suoi = progetto === undefined || processi === undefined ? undefined : processiDelProgetto(processi, progetto, delloStessoAmbiente);
  const cpu = suoi?.cpu;
  useEffect(() => {
    if (cpu !== undefined) setStoria((prima) => [...prima, cpu].slice(-PUNTI));
  }, [cpu, processi]);

  if (progetto === undefined || idAmbiente === undefined) return <div className="vuota-di-pannello">Progetto non trovato.</div>;
  if (spento) return <div className="vuota-di-pannello">L'ambiente «{progetto.nomeAmbiente}» è spento: i suoi processi si vedono quando torna.</div>;
  const usatoDa = (processo: ProcessoDiShinka): string[] => progettiCheLoUsano(processo, delloStessoAmbiente).map((uno) => uno.nome);
  return (
    <div className="pannello-processi" aria-label="Processi del progetto">
      {motivo !== undefined && <p className="errore">{motivo}</p>}
      {suoi === undefined && motivo === undefined && <p className="tenue">Leggo i processi…</p>}
      {suoi !== undefined && (
        <>
          <div className="riassunto-processi">
            <div>
              <span className="valore">{percento(suoi.cpu)}</span> <span className="tenue">processore</span>
            </div>
            <div>
              <span className="valore">{pesoInBreve(suoi.memoria)}</span> <span className="tenue">memoria</span>
            </div>
            <LineaDelProcessore valori={storia} />
          </div>
          <div className="gruppo-processi">
            <h3>Del progetto</h3>
            {suoi.righe.length === 0 ? (
              <p className="tenue">In questo momento il progetto non ha processi accesi: la conversazione parte quando la apri o le scrivi.</p>
            ) : (
              <RigheProcessi idAmbiente={idAmbiente} righe={suoi.righe} />
            )}
          </div>
          {suoi.condivisi.length > 0 && (
            <div className="gruppo-processi">
              <h3>Dell'ambiente, in uso dal progetto</h3>
              <RigheProcessi idAmbiente={idAmbiente} righe={suoi.condivisi.map((processo) => ({ processo, livello: 0 }))} usatoDa={usatoDa} />
            </div>
          )}
          <p className="tenue">
            Il processore è in percentuale di un nucleo. Terminare un processo ferma anche ciò che ha avviato; una conversazione terminata riparte al prossimo
            messaggio. Un server dell'ambiente serve anche agli altri progetti che lo usano.{" "}
            <a href={frammentoDi({ tipo: "ambiente", id: idAmbiente })}>Tutti i processi e le risorse di «{progetto.nomeAmbiente}»</a>
          </p>
        </>
      )}
    </div>
  );
}

/** La linea del processore usato dal progetto negli ultimi minuti. */
function LineaDelProcessore({ valori }: { valori: readonly number[] }): ReactNode {
  if (valori.length < 2) return null;
  const massimo = Math.max(100, ...valori);
  // Il più recente a destra: la linea cresce da destra finché non copre i suoi minuti.
  const punti = valori.map((valore, i) => `${100 - ((valori.length - 1 - i) / (PUNTI - 1)) * 100},${29 - (valore / massimo) * 27}`).join(" ");
  return (
    <div className="linea-processore">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Processore del progetto negli ultimi minuti">
        <polyline points={punti} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="tenue">processore, ultimi {Math.round((PUNTI * OGNI_MS) / 60_000)} minuti</span>
    </div>
  );
}
