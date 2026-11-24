/**
 * Le righe dei processi accesi da Shinka, con quanto pesano e il pulsante per terminarne uno con ciò
 * che ha avviato: nella pagina dell'ambiente, per progetto, e nel pannello di un progetto.
 */

import { useState, type ReactNode } from "react";
import type { ProcessoDiShinka } from "../../src/protocollo/risorse.ts";
import { terminaProcesso } from "./api.ts";
import { grandezzaInBreve as pesoInBreve } from "./descrivi.ts";
import { cheCosE, type RigaProcesso } from "./processi.ts";

export const percento = (valore: number): string => `${valore.toLocaleString("it-IT", { maximumFractionDigits: valore < 10 ? 1 : 0 })}%`;

export function RigheProcessi({
  idAmbiente,
  righe,
  usatoDa,
}: {
  idAmbiente: string;
  righe: readonly RigaProcesso[];
  /** Per un processo condiviso, i nomi dei progetti che lo usano. */
  usatoDa?: (processo: ProcessoDiShinka) => readonly string[];
}): ReactNode {
  const [daTerminare, setDaTerminare] = useState<number>();
  const [esito, setEsito] = useState<{ pid: number; errore?: string }>();
  const termina = (pid: number): void => {
    setDaTerminare(undefined);
    setEsito({ pid });
    terminaProcesso(idAmbiente, pid)
      .then(() => setEsito(undefined))
      .catch((causa: unknown) => setEsito({ pid, errore: causa instanceof Error ? causa.message : "Non si è terminato." }));
  };
  return (
    <ul>
      {righe.map(({ processo, livello }) => {
        const tipo = cheCosE(processo);
        const chi = usatoDa?.(processo) ?? [];
        return (
          <li key={processo.pid} style={{ paddingLeft: `${livello * 16}px` }}>
            <div className="riga-processo">
              <span className="nome">
                {processo.nome}
                {tipo !== undefined && <span className="tenue"> · {tipo}</span>}
              </span>
              <span className="numero">{percento(processo.cpu)}</span>
              <span className="numero">{pesoInBreve(processo.memoria)}</span>
              {daTerminare === processo.pid ? (
                <span className="pulsanti">
                  <button type="button" className="mini pericolo" onClick={() => termina(processo.pid)}>
                    Termina
                  </button>
                  <button type="button" className="mini discreto" onClick={() => setDaTerminare(undefined)}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" className="mini discreto" disabled={esito?.pid === processo.pid && esito.errore === undefined} onClick={() => setDaTerminare(processo.pid)}>
                  {esito?.pid === processo.pid && esito.errore === undefined ? "Termino…" : "Termina…"}
                </button>
              )}
            </div>
            {chi.length > 0 && <div className="tenue comando-processo">In uso da {chi.join(", ")}</div>}
            {processo.comando !== undefined && <div className="tenue comando-processo">{processo.comando}</div>}
            {esito?.pid === processo.pid && esito.errore !== undefined && <p className="errore">{esito.errore}</p>}
          </li>
        );
      })}
    </ul>
  );
}
