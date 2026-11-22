/**
 * Un host SSH di prova, in ascolto solo su questa macchina: accetta un utente con una password
 * o con una chiave, e a ogni comando risponde come gli viene detto. Serve ai test del gateway
 * e alla prova in locale, dove può eseguire i comandi davvero.
 */

import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import ssh2 from "ssh2";
import { improntaDi } from "../gateway/ssh.ts";

export interface RispostaAlComando {
  uscita?: string;
  errori?: string;
  codice?: number;
  /** Se presente, l'host aspetta questi millisecondi prima di rispondere. */
  attesaMs?: number;
}

export interface OpzioniHostDiProva {
  utente: string;
  /** La password accettata, se l'host accetta password. */
  password?: string;
  /** La chiave pubblica accettata, in formato OpenSSH, se l'host accetta chiavi. */
  chiavePubblica?: string;
  /** Vero se la password va chiesta con una domanda invece che nel modo solito. */
  soloConDomanda?: boolean;
  /**
   * Come l'host risponde a un comando. `ingresso` aspetta ciò che il cliente scrive al comando
   * fino alla sua fine: va chiamato solo per i comandi che leggono dall'ingresso.
   */
  esegui(comando: string, ingresso: () => Promise<string>): RispostaAlComando | Promise<RispostaAlComando>;
  /** La porta su cui ascoltare; se manca, una libera. */
  porta?: number;
}

export interface HostDiProva {
  porta: number;
  /** L'impronta della chiave con cui l'host si presenta. */
  impronta: string;
  /** I comandi ricevuti, nell'ordine. */
  comandi: string[];
  /** Quante volte qualcuno ha provato a entrare, riuscendoci o no. */
  tentativi: number;
  chiudi(): Promise<void>;
}

/** Una coppia di chiavi nuova, in formato OpenSSH. */
export function nuovaCoppiaDiChiavi(frase?: string): { privata: string; pubblica: string } {
  // Ogni tanto la libreria genera una chiave che poi non sa rileggere: in quel caso se ne genera un'altra.
  for (let giro = 0; ; giro += 1) {
    const coppia = ssh2.utils.generateKeyPairSync("ed25519", frase === undefined ? {} : { passphrase: frase, cipher: "aes256-ctr", rounds: 16 });
    if (!(ssh2.utils.parseKey(coppia.public) instanceof Error) || giro >= 9) return { privata: coppia.private, pubblica: coppia.public };
  }
}

export function avviaHostDiProva(opzioni: OpzioniHostDiProva): Promise<HostDiProva> {
  const chiaveHost = nuovaCoppiaDiChiavi();
  const pubblicaHost = ssh2.utils.parseKey(chiaveHost.pubblica);
  if (pubblicaHost instanceof Error) throw pubblicaHost;
  const accettata = opzioni.chiavePubblica === undefined ? undefined : ssh2.utils.parseKey(opzioni.chiavePubblica);
  if (accettata instanceof Error) throw accettata;

  const host: HostDiProva = {
    porta: 0,
    impronta: improntaDi(pubblicaHost.getPublicSSH()),
    comandi: [],
    tentativi: 0,
    chiudi: () => Promise.resolve(),
  };
  const clienti = new Set<ssh2.Connection>();

  const servizio = new ssh2.Server({ hostKeys: [chiaveHost.privata] }, (cliente) => {
    clienti.add(cliente);
    cliente.on("close", () => clienti.delete(cliente));
    cliente.on("error", () => {});
    cliente.on("authentication", (contesto) => {
      if (contesto.method !== "none") host.tentativi += 1;
      if (contesto.username !== opzioni.utente) {
        contesto.reject();
        return;
      }
      if (contesto.method === "password" && opzioni.password !== undefined && opzioni.soloConDomanda !== true) {
        if (contesto.password === opzioni.password) contesto.accept();
        else contesto.reject();
        return;
      }
      if (contesto.method === "keyboard-interactive" && opzioni.password !== undefined) {
        contesto.prompt([{ prompt: "Password: ", echo: false }], (risposte) => {
          if (risposte[0] === opzioni.password) contesto.accept();
          else contesto.reject();
        });
        return;
      }
      if (contesto.method === "publickey" && accettata !== undefined) {
        const stessa = contesto.key.algo === accettata.type && contesto.key.data.equals(accettata.getPublicSSH());
        if (!stessa) {
          contesto.reject();
          return;
        }
        // Senza firma il cliente chiede solo se la chiave andrebbe bene; con la firma entra.
        if (contesto.signature === undefined || accettata.verify(contesto.blob as Buffer, contesto.signature, contesto.hashAlgo) === true) {
          contesto.accept();
        } else {
          contesto.reject();
        }
        return;
      }
      const modi: ssh2.AuthenticationType[] = [];
      if (opzioni.password !== undefined) modi.push(opzioni.soloConDomanda === true ? "keyboard-interactive" : "password");
      if (accettata !== undefined) modi.push("publickey");
      contesto.reject(modi, false);
    });
    cliente.on("ready", () => {
      cliente.on("session", (accetta) => {
        const sessione = accetta();
        sessione.on("exec", (accettaComando, _rifiuta, informazioni) => {
          const flusso = accettaComando();
          host.comandi.push(informazioni.command);
          const pezzi: Buffer[] = [];
          const fine = new Promise<void>((finito) => flusso.on("end", () => finito()));
          flusso.on("data", (pezzo: Buffer) => pezzi.push(pezzo));
          const ingresso = async (): Promise<string> => {
            await fine;
            return Buffer.concat(pezzi).toString("utf8");
          };
          void Promise.resolve()
            .then(() => opzioni.esegui(informazioni.command, ingresso))
            .then(async (risposta) => {
              if (risposta.attesaMs !== undefined) await new Promise((fatto) => setTimeout(fatto, risposta.attesaMs));
              if (risposta.uscita !== undefined) flusso.write(risposta.uscita);
              if (risposta.errori !== undefined) flusso.stderr.write(risposta.errori);
              flusso.exit(risposta.codice ?? 0);
              flusso.end();
            })
            .catch((errore: unknown) => {
              flusso.stderr.write(String(errore));
              flusso.exit(1);
              flusso.end();
            });
        });
      });
    });
  });

  host.chiudi = () =>
    new Promise((fatto) => {
      for (const cliente of clienti) cliente.end();
      servizio.close(() => fatto());
    });

  return new Promise((pronto, rifiuta) => {
    servizio.on("error", rifiuta);
    servizio.listen(opzioni.porta ?? 0, "127.0.0.1", () => {
      host.porta = (servizio.address() as AddressInfo).port;
      pronto(host);
    });
  });
}

/** Esegue il comando davvero, nella shell di questa macchina: per la prova in locale. */
export function eseguiDavvero(comando: string): Promise<RispostaAlComando> {
  return new Promise((fatto) => {
    const diWindows = process.platform === "win32";
    const processo = spawn(
      diWindows ? "powershell.exe" : "bash",
      diWindows ? ["-NoProfile", "-NonInteractive", "-Command", comando] : ["-c", comando],
      { windowsHide: true },
    );
    let uscita = "";
    let errori = "";
    processo.stdout.on("data", (pezzo: Buffer) => (uscita += pezzo.toString("utf8")));
    processo.stderr.on("data", (pezzo: Buffer) => (errori += pezzo.toString("utf8")));
    processo.on("error", (errore) => fatto({ errori: errore.message, codice: 127 }));
    processo.on("close", (codice) => fatto({ uscita, errori, codice: codice ?? 1 }));
  });
}
