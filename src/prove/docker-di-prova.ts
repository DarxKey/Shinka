/**
 * Un Docker finto, per i test e per la prova in locale: capisce i comandi che il gateway scrive
 * per gli stack di prova e tiene a mente container e cartelle, senza avviare nulla. Parte con un
 * servizio "del proprietario", che non è di Shinka: serve a vedere che non viene toccato senza
 * approvazione.
 *
 * Non è un Docker: che i comandi veri facciano ciò che devono lo dice la prova su un host vero
 * (`src/prove/stack-su-host.ts`).
 */

import { ETICHETTA_STACK, SEGNO_DI_SHINKA } from "../protocollo/stack.ts";
import type { RispostaAlComando } from "./host-di-prova.ts";

export interface ContainerDiProva {
  nome: string;
  /** Il progetto di Docker Compose, se il container ne ha uno. */
  progetto: string;
  /** Il valore dell'etichetta di Shinka; vuoto se il container non è di Shinka. */
  etichetta: string;
  immagine: string;
  stato: "running" | "exited";
  porte: string;
}

/** Il testo tra i primi apici dopo `prima`. */
function traApici(comando: string, prima: string): string | undefined {
  const posto = comando.indexOf(prima);
  if (posto === -1) return undefined;
  return /'([^']*)'/.exec(comando.slice(posto + prima.length))?.[1];
}

export class DockerDiProva {
  /** I container che ci sono, compresi quelli che non sono di Shinka. */
  container: ContainerDiProva[] = [
    { nome: "plex", progetto: "", etichetta: "", immagine: "plexinc/pms-docker", stato: "running", porte: "0.0.0.0:32400->32400/tcp" },
  ];
  /** Le cartelle che ci sono sull'host: vero se portano il segno di Shinka. */
  cartelle = new Map<string, boolean>();
  /** I file scritti nelle cartelle degli stack, con il loro contenuto. */
  file = new Map<string, string>();
  /** Ciò che Docker Compose ha ricevuto all'ultimo avvio di ogni progetto. */
  composti = new Map<string, Record<string, unknown>>();
  /** I comandi ricevuti, nell'ordine, con ciò che hanno letto dall'ingresso. */
  ricevuti: { comando: string; ingresso?: string }[] = [];
  /** Se vero, dopo `stop` i container risultano ancora accesi alla prima lettura. */
  lentoAFermarsi = false;
  #daFermare: string[] = [];

  async esegui(comando: string, ingresso: () => Promise<string>): Promise<RispostaAlComando> {
    const legge = comando === "sh -s" || / -f - /.test(comando);
    const scritto = legge ? await ingresso() : undefined;
    this.ricevuti.push({ comando, ...(scritto === undefined ? {} : { ingresso: scritto }) });

    if (comando === "sh -s") return this.#prepara(scritto ?? "");
    if (comando.startsWith("sleep ")) {
      this.#ferma();
      return {};
    }
    if (comando.startsWith("docker ps -a --filter 'label=com.docker.compose.project=")) {
      const progetto = traApici(comando, "--filter ")?.split("=").slice(2).join("=") ?? "";
      const cartella = traApici(comando, "[ -e ") ?? "";
      const righe = this.container.filter((uno) => uno.progetto === progetto).map((uno) => this.#riga(uno));
      const segno = this.cartelle.get(cartella);
      if (!this.lentoAFermarsi) this.#ferma();
      return { uscita: `${righe.join("")}::cartella::\n${segno === undefined ? "assente" : segno ? "nostra" : "estranea"}\n` };
    }
    // La lettura per la pagina degli ambienti: tutti i container, e le risorse di quelli accesi.
    if (comando.startsWith("docker ps -a --no-trunc --format '{{json .}}'")) {
      const ps = this.container.map((uno) =>
        JSON.stringify({ Names: uno.nome, Image: uno.immagine, State: uno.stato, Status: uno.stato === "running" ? "Up 2 hours" : "Exited (0) 1 hour ago", Ports: uno.porte, Labels: uno.etichetta === "" ? "" : `${ETICHETTA_STACK}=${uno.etichetta}` }),
      );
      const stats = this.container.filter((uno) => uno.stato === "running").map((uno) => JSON.stringify({ Name: uno.nome, CPUPerc: "1.50%", MemUsage: "128MiB / 2GiB" }));
      return { uscita: `${ps.join("\n")}\n::risorse::\n${stats.join("\n")}\n` };
    }
    if (comando.startsWith(`docker ps -a --filter 'label=${ETICHETTA_STACK}'`)) {
      return { uscita: this.container.filter((uno) => uno.etichetta !== "").map((uno) => this.#riga(uno)).join("") };
    }
    if (comando.startsWith("docker compose -p ")) {
      const progetto = traApici(comando, "-p ") ?? "";
      const suoi = this.container.filter((uno) => uno.progetto === progetto);
      if (/ up -d /.test(comando)) return this.#avvia(progetto, scritto ?? "");
      if (/ stop$/.test(comando)) {
        this.#daFermare = suoi.map((uno) => uno.nome);
        return {};
      }
      if (/ down /.test(comando)) {
        this.container = this.container.filter((uno) => uno.progetto !== progetto);
        return {};
      }
      if (/ logs /.test(comando)) return { uscita: suoi.map((uno) => `${uno.nome}  | pronto\n`).join("") };
    }
    if (comando.startsWith(`if [ -f '`) && comando.includes("rm -rf -- ")) {
      const cartella = traApici(comando, "rm -rf -- ") ?? "";
      if (this.cartelle.get(cartella) !== true) return { errori: "La cartella non porta il segno di Shinka.\n", codice: 4 };
      this.#togli(cartella);
      return {};
    }

    // Un comando libero, come quelli che Claude scrive con esegui_su_host.
    const parole = comando.trim().split(/\s+/);
    if (parole[0] === "docker" && (parole[1] === "stop" || parole[1] === "start") && parole[2] !== undefined) {
      const trovato = this.container.find((uno) => uno.nome === parole[2]);
      if (trovato === undefined) return { errori: `Error response from daemon: No such container: ${parole[2]}\n`, codice: 1 };
      trovato.stato = parole[1] === "stop" ? "exited" : "running";
      return { uscita: `${trovato.nome}\n` };
    }
    if (parole[0] === "docker" && parole[1] === "ps") {
      return { uscita: `NAMES\tIMAGE\tSTATE\n${this.container.map((uno) => `${uno.nome}\t${uno.immagine}\t${uno.stato}\n`).join("")}` };
    }
    return { uscita: `eseguito: ${comando}\n` };
  }

  #riga(uno: ContainerDiProva): string {
    const dettaglio = uno.stato === "running" ? "Up 2 seconds" : "Exited (0) 1 second ago";
    return `${uno.nome}\t${uno.etichetta}\t${uno.immagine}\t${uno.stato}\t${dettaglio}\t${uno.porte}\n`;
  }

  #ferma(): void {
    for (const uno of this.container) if (this.#daFermare.includes(uno.nome)) uno.stato = "exited";
    this.#daFermare = [];
  }

  #togli(cartella: string): void {
    for (const percorso of [...this.cartelle.keys()]) if (percorso === cartella || percorso.startsWith(`${cartella}/`)) this.cartelle.delete(percorso);
    for (const percorso of [...this.file.keys()]) if (percorso.startsWith(`${cartella}/`)) this.file.delete(percorso);
  }

  /** Lo script di preparazione: cartelle, segno di Shinka e file. */
  #prepara(script: string): RispostaAlComando {
    const righe = script.split("\n");
    for (let posto = 0; posto < righe.length; posto += 1) {
      const riga = righe[posto] ?? "";
      const percorso = /'([^']*)'/.exec(riga)?.[1] ?? "";
      if (riga.startsWith("mkdir -p ") || riga.startsWith("[ -d ")) {
        if (!this.cartelle.has(percorso)) this.cartelle.set(percorso, false);
      } else if (riga.startsWith(": > ") && percorso.endsWith(`/${SEGNO_DI_SHINKA}`)) {
        this.cartelle.set(percorso.slice(0, -SEGNO_DI_SHINKA.length - 1), true);
      } else if (riga.startsWith("rm -rf -- ")) {
        this.#togli(percorso);
      } else if (riga.startsWith("base64 -d > ")) {
        let codificato = "";
        for (posto += 1; posto < righe.length && righe[posto] !== "SHINKA_FILE"; posto += 1) codificato += righe[posto] ?? "";
        this.file.set(percorso, Buffer.from(codificato, "base64").toString("utf8"));
      }
    }
    return {};
  }

  #avvia(progetto: string, scritto: string): RispostaAlComando {
    let composto: { services?: Record<string, { image?: string; labels?: Record<string, string>; ports?: { target: number; published: string; protocol: string }[] }> };
    try {
      composto = JSON.parse(scritto) as typeof composto;
    } catch {
      return { errori: "yaml: il file non si legge\n", codice: 15 };
    }
    this.composti.set(progetto, composto as Record<string, unknown>);
    const servizi = Object.entries(composto.services ?? {});
    this.container = this.container.filter((uno) => uno.progetto !== progetto || servizi.some(([nome]) => uno.nome === `${progetto}-${nome}-1`));
    for (const [nome, servizio] of servizi) {
      const nuovo: ContainerDiProva = {
        nome: `${progetto}-${nome}-1`,
        progetto,
        etichetta: servizio.labels?.[ETICHETTA_STACK] ?? "",
        immagine: servizio.image ?? "",
        stato: "running",
        porte: (servizio.ports ?? []).map((porta) => `0.0.0.0:${porta.published}->${porta.target}/${porta.protocol}`).join(", "),
      };
      const posto = this.container.findIndex((uno) => uno.nome === nuovo.nome);
      if (posto === -1) this.container.push(nuovo);
      else this.container[posto] = nuovo;
    }
    return { errori: servizi.map(([nome]) => ` Container ${progetto}-${nome}-1  Started\n`).join("") };
  }
}
