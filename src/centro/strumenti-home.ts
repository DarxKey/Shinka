/**
 * Gli strumenti che la Home ha in più rispetto a una conversazione qualunque: conoscere
 * ambienti e progetti, agire in un ambiente, proporre un progetto o chiedere dove lavorare,
 * cambiare argomento e ritrovare ciò che è stato fatto in quelli archiviati.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { VoceArgomento } from "../protocollo/argomenti.ts";
import {
  cartellaDellArgomento,
  DURATA_MASSIMA_COMANDO_MS,
  traIFileDellaHome,
  type AzioneInAmbiente,
  type EsitoAzione,
} from "../protocollo/azioni.ts";
import type { EventoArchiviato, EventoConversazione } from "../protocollo/eventi.ts";
import { IMPEGNI, type Impegno, type ModoPermessi } from "../protocollo/impostazioni.ts";
import type { Ambiente } from "../protocollo/nodi.ts";
import type { VoceProgetto } from "../protocollo/progetti.ts";
import { GRUPPO_STRUMENTI, type ChiamaStrumento } from "../protocollo/strumenti.ts";
import { definizioniApplicazione, definizioniComuni } from "../nodo/strumenti-comuni.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import { inPocheRighe, type Estensioni, type RichiestaEstensione } from "./estensioni.ts";
import { eSkillDiShinka } from "../nodo/profili.ts";
import type { Elaborati } from "./elaborati.ts";
import type { PonteTelegram } from "./telegram.ts";
import { posizioneInParole, type PosizioneDelProprietario } from "./posizione.ts";
import { disegnaMappa, MappaNonDisegnata, type PuntoMappa, type ServiziMappa } from "./mappa.ts";
import { AGGIORNA_MASSIMO, percorsoDiElaboratoValido } from "../protocollo/elaborati.ts";
import { AmbienteSpento } from "./esecutori.ts";
import type { LavoriDeiProgetti } from "./lavori.ts";
import type { Proposte } from "./proposte.ts";
import type { Canale } from "./canale.ts";
import type { SviluppoDiShinka } from "./sviluppo.ts";
import {
  cerca,
  fileScritti,
  trascrivi,
  ultimaRichiesta,
  statoDelProgetto,
  ultimoResoconto,
  type Cercabile,
} from "./storia.ts";

/** Nome del gruppo di strumenti: quelli della Home si chiamano `mcp__shinka__…`. */
export const GRUPPO_STRUMENTI_HOME = GRUPPO_STRUMENTI;

/** Ciò che gli strumenti chiedono alla Home. */
export interface CasaDegliStrumenti {
  readonly idArgomentoAperto: string;
  /** La cartella dell'argomento aperto, nell'ambiente del centro. */
  readonly cartellaAperta: string;
  /** L'archivio dell'argomento aperto: lì compaiono le schede che gli strumenti propongono. */
  readonly canale: Canale;
  pubblica(evento: EventoConversazione): void;
  richiediCambio(richiesta: { titolo: string; riassunto: string; riprendi?: string }): string | { rifiuto: string };
  archiviati(): VoceArgomento[];
  cercabili(): Promise<Cercabile[]>;
}

export interface OpzioniStrumentiHome {
  ambienti: RegistroAmbienti;
  lavori: LavoriDeiProgetti;
  proposte: Proposte;
  /** La Home, chiesta nel momento in cui serve: nasce dopo i suoi strumenti. */
  home(): CasaDegliStrumenti;
  /** Compie un'azione in un ambiente, nella cartella di un argomento. */
  agisci(idAmbiente: string, idArgomento: string, azione: AzioneInAmbiente): Promise<EsitoAzione>;
  /** Esegue gli strumenti comuni a ogni conversazione: memoria e skill. Senza, la Home non li ha. */
  comuni?: ChiamaStrumento;
  /** Lo sviluppo di Shinka da dentro Shinka. Senza, la Home non può proporlo. */
  sviluppo?: Pick<SviluppoDiShinka, "proponi">;
  /** Le estensioni di Shinka. Senza, la Home non può proporne. */
  estensioni?: Pick<Estensioni, "proponi" | "stato" | "guarda">;
  /** Gli elaborati degli argomenti. Senza, la Home non può mostrarne nella chat. */
  elaborati?: Pick<Elaborati, "trova">;
  /** La cartella di un argomento nell'ambiente del centro, dove la Home disegna le mappe. */
  cartellaDellArgomento?: (idArgomento: string) => string;
  /** La posizione che il proprietario ha condiviso. Senza, la Home non la conosce. */
  posizione?: PosizioneDelProprietario;
  /** Dove la Home prende mappe e percorsi per disegnare. Senza, non disegna mappe. */
  mappe?: ServiziMappa;
  /** Telegram, chiesto nel momento in cui serve: nasce dopo gli strumenti. Senza, la Home non manda file lì. */
  telegram?: () => Pick<PonteTelegram, "inviaElaborato"> | undefined;
}

/**
 * Ciò che uno strumento restituisce a Claude.
 * È un tipo e non un'interfaccia perché l'harness lo vuole aperto ad altri campi.
 */
export type RispostaStrumento = {
  content: [{ type: "text"; text: string }];
  /** Presente quando lo strumento non ha potuto fare ciò che gli era stato chiesto. */
  isError?: true;
};

const CONDIZIONI: Record<VoceProgetto["condizione"], string> = {
  "al-lavoro": "al lavoro",
  "aspetta-te": "aspetta una risposta del proprietario",
  fermo: "fermo",
  "ambiente-spento": "ambiente spento",
};

/** Quanto di un file scritto in un argomento viene riportato quando lo si rilegge. */
const FILE_RIPORTATO_MASSIMO = 20_000;

function risposta(testo: string): RispostaStrumento {
  return { content: [{ type: "text", text: testo }] };
}

function nonRiuscito(testo: string): RispostaStrumento {
  return { content: [{ type: "text", text: testo }], isError: true };
}

/**
 * Trova per nome, senza badare alle maiuscole. Chi cerca è un modello, e non sempre ripete
 * il nome tale e quale: a volte ne scrive solo una parte, a volte lo riporta insieme a ciò
 * che lo accompagnava nell'elenco. Vale prima il nome esatto, poi il nome più lungo
 * contenuto in ciò che è stato scritto, poi il primo nome che contiene ciò che è stato scritto.
 */
export function trovaPerNome<T extends { nome: string }>(elementi: T[], nome: string): T | undefined {
  const cercato = nome.trim().toLowerCase();
  if (cercato === "") return undefined;
  const esatto = elementi.find((e) => e.nome.toLowerCase() === cercato);
  if (esatto !== undefined) return esatto;
  const contenuti = elementi
    .filter((e) => e.nome.trim() !== "" && cercato.includes(e.nome.toLowerCase()))
    .sort((a, b) => b.nome.length - a.nome.length);
  return contenuti[0] ?? elementi.find((e) => e.nome.toLowerCase().includes(cercato));
}

/** La shell in cui girano i comandi di un ambiente. */
function shellDi(ambiente: Ambiente): string {
  return ambiente.sistema.toLowerCase().startsWith("windows") ? "PowerShell" : "bash";
}

function giorno(quando: string): string {
  return quando.slice(0, 10);
}

/**
 * Decide quali azioni della Home negli ambienti non hanno bisogno del consenso del proprietario
 * anche quando l'harness lo chiederebbe: leggere tra i file degli argomenti, sempre; scriverli,
 * quando il proprietario ha scelto le modifiche libere. Tutto il resto segue il modo dei permessi.
 */
export function consensoDellaHome(
  ambienti: RegistroAmbienti,
): (strumento: string, ingresso: unknown, modo: ModoPermessi) => boolean {
  return (strumento, ingresso, modo) => {
    // Una skill di Shinka è una procedura scritta dalla Home: usarla non chiede consenso. Quella
    // di un plugin è di terzi, e segue il modo dei permessi.
    if (strumento === "Skill") return eSkillDiShinka(ingresso);
    const legge = strumento === `mcp__${GRUPPO_STRUMENTI_HOME}__leggi_file`;
    const scrive = strumento === `mcp__${GRUPPO_STRUMENTI_HOME}__scrivi_file`;
    if (!legge && !(scrive && modo !== "chiedi")) return false;
    if (typeof ingresso !== "object" || ingresso === null) return false;
    const { ambiente, percorso } = ingresso as Record<string, unknown>;
    if (typeof ambiente !== "string" || typeof percorso !== "string") return false;
    const trovato = trovaPerNome(ambienti.stato().ambienti, ambiente);
    return trovato !== undefined && traIFileDellaHome(trovato.radiceProgetti, percorso);
  };
}

/**
 * Ciò che ogni strumento della Home fa quando Claude lo usa.
 * Sta fuori dalla registrazione presso l'harness, così si può provare senza Claude.
 */
export function azioniDellaHome(opzioni: OpzioniStrumentiHome) {
  const { ambienti, lavori, proposte } = opzioni;
  const attivi = (): Ambiente[] => ambienti.stato().ambienti.filter((a) => a.attivo);

  /** Il nome sta tra virgolette, staccato dal resto: è quello, e solo quello, che va ripetuto. */
  const descriviAmbiente = (ambiente: Ambiente): string => {
    const offre = ambiente.descrizione === "" ? "" : `; offre: ${ambiente.descrizione}`;
    const cartella = cartellaDellArgomento(ambiente.radiceProgetti, opzioni.home().idArgomentoAperto);
    const comeAgire = ambiente.delCentro
      ? "qui giri tu: usa Bash, Read, Write ed Edit"
      : `shell: ${shellDi(ambiente)}; cartella di questo argomento: ${cartella}`;
    return `- nome: "${ambiente.nome}"; sistema: ${ambiente.sistema}${offre}; ${comeAgire}`;
  };
  const elencoAttivi = (): string => attivi().map(descriviAmbiente).join("\n");

  const ambienteAttivo = (nome: string): Ambiente | RispostaStrumento => {
    const trovato = trovaPerNome(attivi(), nome);
    if (trovato !== undefined) return trovato;
    const spento = trovaPerNome(ambienti.stato().ambienti, nome);
    return nonRiuscito(
      spento !== undefined
        ? `L'ambiente "${spento.nome}" è spento: finché non torna attivo non ci si può lavorare. Dillo al proprietario.`
        : `Nessun ambiente attivo si chiama "${nome}". Quelli attivi sono:\n${elencoAttivi()}\nRiprova indicando solo il nome tra virgolette.`,
    );
  };

  const agisci = async (nomeAmbiente: string, azione: AzioneInAmbiente): Promise<RispostaStrumento> => {
    const ambiente = ambienteAttivo(nomeAmbiente);
    if ("content" in ambiente) return ambiente;
    let esito: EsitoAzione;
    try {
      esito = await opzioni.agisci(ambiente.id, opzioni.home().idArgomentoAperto, azione);
    } catch (errore) {
      return nonRiuscito(
        errore instanceof AmbienteSpento
          ? `L'ambiente "${ambiente.nome}" si è spento: l'azione non è stata eseguita.`
          : `L'azione in "${ambiente.nome}" non è riuscita: ${errore instanceof Error ? errore.message : String(errore)}`,
      );
    }
    const testo =
      azione.tipo === "scrivi-file" && esito.riuscita && esito.percorso !== undefined
        ? `File scritto in "${ambiente.nome}": ${esito.percorso}`
        : esito.testo;
    return esito.riuscita ? risposta(testo) : nonRiuscito(testo);
  };

  const progettoPerNome = (nome: string): VoceProgetto | RispostaStrumento => {
    const progetti = lavori.stato().progetti;
    const trovato = trovaPerNome(progetti, nome);
    if (trovato !== undefined) return trovato;
    return nonRiuscito(
      `Nessun progetto si chiama "${nome}". ` +
        (progetti.length === 0
          ? "Non c'è ancora nessun progetto."
          : `I progetti sono: ${progetti.map((p) => `"${p.nome}"`).join(", ")}.`),
    );
  };

  const storiaDelProgetto = (idProgetto: string): readonly EventoArchiviato[] =>
    lavori.canale(idProgetto)?.archiviati ?? [];

  return {
    elencaAmbienti(): RispostaStrumento {
      const spenti = ambienti
        .stato()
        .ambienti.filter((a) => !a.attivo)
        .map((a) => `"${a.nome}"`);
      return risposta(
        elencoAttivi() + (spenti.length === 0 ? "" : `\nSpenti in questo momento: ${spenti.join(", ")}.`),
      );
    },

    eseguiInAmbiente(argomenti: { ambiente: string; comando: string; secondi?: number }): Promise<RispostaStrumento> {
      const durataMs =
        argomenti.secondi === undefined
          ? undefined
          : Math.min(Math.max(argomenti.secondi, 1) * 1000, DURATA_MASSIMA_COMANDO_MS);
      return agisci(argomenti.ambiente, {
        tipo: "esegui",
        comando: argomenti.comando,
        ...(durataMs === undefined ? {} : { durataMs }),
      });
    },

    scriviFile(argomenti: { ambiente: string; percorso: string; contenuto: string }): Promise<RispostaStrumento> {
      return agisci(argomenti.ambiente, {
        tipo: "scrivi-file",
        percorso: argomenti.percorso,
        contenuto: argomenti.contenuto,
      });
    },

    leggiFile(argomenti: { ambiente: string; percorso: string }): Promise<RispostaStrumento> {
      return agisci(argomenti.ambiente, { tipo: "leggi-file", percorso: argomenti.percorso });
    },

    async proponiProgetto(argomenti: {
      nome: string;
      brief: string;
      ambiente: string;
      cartella_esistente?: string;
    }): Promise<RispostaStrumento> {
      const ambiente = ambienteAttivo(argomenti.ambiente);
      if ("content" in ambiente) return ambiente;
      const nome = argomenti.nome.trim();
      const brief = argomenti.brief.trim();
      if (nome === "" || brief === "") {
        return nonRiuscito("Servono un nome e un brief: la proposta non è stata mostrata.");
      }
      const esistente = argomenti.cartella_esistente?.trim() ?? "";
      if (esistente !== "") {
        // La cartella si guarda subito: una proposta su una cartella che non c'è non serve a nessuno.
        let cartella: { percorso: string; git: boolean };
        try {
          cartella = await lavori.controllaCartella(ambiente.id, esistente);
        } catch (errore) {
          return nonRiuscito(
            `${errore instanceof Error ? errore.message : String(errore)} La proposta non è stata mostrata: ` +
              "controlla il percorso con il proprietario, oppure proponi il progetto senza cartella esistente.",
          );
        }
        proposte.proponi(
          {
            nome,
            brief,
            idAmbiente: ambiente.id,
            cartellaEsistente: cartella.percorso,
            ...(cartella.git
              ? {}
              : {
                  avvisoCartella:
                    "Non è un repository Git: Shinka non lo inizializza. Se serve, il progetto te lo proporrà.",
                }),
          },
          opzioni.home().canale,
        );
        return risposta(
          `Proposta mostrata al proprietario: progetto "${nome}" nell'ambiente "${ambiente.nome}", nella cartella che esiste già ` +
            `${cartella.percorso}${cartella.git ? ", che è un repository Git" : ", che non è un repository Git"}. ` +
            "Il proprietario può cambiare il percorso dalla scheda. Non è stato creato nulla, e la cartella non è stata toccata. " +
            "Aspetta la sua decisione senza cominciare il lavoro.",
        );
      }
      // Se l'argomento ha già prodotto file, il progetto può nascere con quelli del suo ambiente.
      const casa = opzioni.home();
      const daPortare = await proposte.fileDellArgomento({ idArgomento: casa.idArgomentoAperto, cartellaAlCentro: casa.cartellaAperta });
      proposte.proponi({ nome, brief, idAmbiente: ambiente.id, ...(daPortare === undefined ? {} : { daPortare }) }, casa.canale);
      const li = daPortare?.file.find((voce) => voce.idAmbiente === ambiente.id);
      const altrove = (daPortare?.file ?? [])
        .filter((voce) => voce.idAmbiente !== ambiente.id)
        .map((voce) => `"${ambienti.stato().ambienti.find((a) => a.id === voce.idAmbiente)?.nome ?? voce.idAmbiente}"`);
      const suiFile =
        (li === undefined
          ? ""
          : ` Questo argomento ha ${li.quanti === 1 ? "un file" : `${li.quanti} file`} in "${ambiente.nome}": ` +
            "se il proprietario conferma, il progetto nasce con una loro copia.") +
        (altrove.length === 0
          ? ""
          : ` Questo argomento ha file anche in ${altrove.join(", ")}: quelli non seguono il progetto, ` +
            "che nasce con i soli file del proprio ambiente. Se servono, dillo al proprietario.");
      return risposta(
        `Proposta mostrata al proprietario: progetto "${nome}" nell'ambiente "${ambiente.nome}". ` +
          `Non è stato creato nulla. Aspetta la sua decisione senza cominciare il lavoro.${suiFile}`,
      );
    },

    proponiSviluppo(argomenti: { titolo: string; richiesta: string }): RispostaStrumento {
      const titolo = argomenti.titolo.trim();
      const richiesta = argomenti.richiesta.trim();
      if (opzioni.sviluppo === undefined) {
        return nonRiuscito("In questa installazione di Shinka lo sviluppo di Shinka non è acceso: dillo al proprietario.");
      }
      if (titolo === "" || richiesta === "") {
        return nonRiuscito("Servono un titolo e la richiesta: la proposta non è stata mostrata.");
      }
      opzioni.sviluppo.proponi({ titolo, richiesta }, opzioni.home().canale);
      return risposta(
        `Proposta mostrata al proprietario: sviluppare in Shinka "${titolo}". Non è partito nulla: il lavoro comincia nel progetto Shinka solo se lui conferma la scheda. Rispondi con una frase sola e aspetta la sua decisione.`,
      );
    },

    async proponiEstensione(argomenti: ArgomentiEstensione): Promise<RispostaStrumento> {
      if (opzioni.estensioni === undefined) return nonRiuscito("In questa installazione di Shinka le estensioni non ci sono: dillo al proprietario.");
      const ambiente = ambienteAttivo(argomenti.ambiente);
      if ("content" in ambiente) return ambiente;
      let definizione: RichiestaEstensione["definizione"];
      switch (argomenti.tipo) {
        case undefined:
          break;
        case "mcp-locale":
          if (argomenti.comando === undefined) return nonRiuscito("Per un server locale serve il comando che lo avvia: la scheda non è stata mostrata.");
          definizione = { tipo: "mcp-locale", comando: argomenti.comando, argomenti: argomenti.argomenti ?? [], variabili: argomenti.variabili ?? {} };
          break;
        case "mcp-remoto":
          if (argomenti.indirizzo === undefined) return nonRiuscito("Per un server remoto serve l'indirizzo: la scheda non è stata mostrata.");
          definizione = { tipo: "mcp-remoto", indirizzo: argomenti.indirizzo, trasporto: argomenti.trasporto ?? "http" };
          break;
        case "modello-locale":
          if (argomenti.comando === undefined || argomenti.porta === undefined || argomenti.modello === undefined || argomenti.contesto === undefined) {
            return nonRiuscito("Per un modello locale servono il comando del server, la porta, il nome del modello e il contesto: la scheda non è stata mostrata.");
          }
          definizione = {
            tipo: "modello-locale",
            comando: argomenti.comando,
            argomenti: argomenti.argomenti ?? [],
            variabili: argomenti.variabili ?? {},
            porta: argomenti.porta,
            modello: argomenti.modello,
            contesto: argomenti.contesto,
            uscita: argomenti.uscita ?? 32_000,
            impegni: argomenti.impegni ?? ["medium"],
          };
          break;
        case "plugin":
          if (argomenti.repository === undefined) return nonRiuscito("Per un plugin serve l'indirizzo del repository: la scheda non è stata mostrata.");
          definizione = {
            tipo: "plugin",
            repository: argomenti.repository,
            ...(argomenti.riferimento === undefined ? {} : { riferimento: argomenti.riferimento }),
            ...(argomenti.cartella === undefined ? {} : { cartella: argomenti.cartella }),
          };
          break;
      }
      const esito = await opzioni.estensioni.proponi({
        nome: argomenti.nome,
        descrizione: argomenti.descrizione ?? "",
        idAmbiente: ambiente.id,
        ...(definizione === undefined ? {} : { definizione }),
        chiavi: argomenti.chiavi ?? [],
      }, opzioni.home().canale);
      if ("motivo" in esito) return nonRiuscito(`${esito.motivo} La scheda non è stata mostrata.`);
      return risposta(
        `Scheda mostrata al proprietario: estensione "${argomenti.nome.trim()}" nell'ambiente "${ambiente.nome}". Non è stato installato né avviato nulla: ` +
          "se lui conferma, l'ambiente la avvia una volta e la accende solo se parte, e com'è andata lo saprai da un messaggio [Shinka]. " +
          "Rispondi con una frase sola e aspetta la sua decisione.",
      );
    },

    async elencaEstensioni(argomenti: { guarda?: boolean }): Promise<RispostaStrumento> {
      if (opzioni.estensioni === undefined) return nonRiuscito("In questa installazione di Shinka le estensioni non ci sono.");
      const tutti = ambienti.stato().ambienti;
      const nomeDi = (idAmbiente: string): string => tutti.find((uno) => uno.id === idAmbiente)?.nome ?? idAmbiente;
      const parti: string[] = [];
      const { estensioni } = opzioni.estensioni.stato();
      parti.push(
        estensioni.length === 0
          ? "Nell'elenco di Shinka non c'è ancora nessuna estensione."
          : `Estensioni di Shinka (le gestisce il proprietario dalla pagina Estensioni):\n${estensioni.map((una) => inPocheRighe(una, nomeDi)).join("\n")}`,
      );
      for (const ambiente of attivi()) {
        let viste = opzioni.estensioni.stato().dellAmbiente[ambiente.id];
        let problema = "";
        if (viste === undefined || argomenti.guarda === true) {
          try {
            viste = await opzioni.estensioni.guarda(ambiente.id);
          } catch (errore) {
            problema = ` Adesso non si è potuto guardare: ${errore instanceof Error ? errore.message : String(errore)}`;
          }
        }
        if (viste === undefined) {
          parti.push(`Ambiente "${ambiente.nome}": che cosa ha già di suo non si sa.${problema}`);
          continue;
        }
        const server = viste.server.map((uno) => uno.nome).join(", ") || "nessuno";
        const plugin = viste.plugin.map((uno) => (uno.versione === undefined ? uno.nome : `${uno.nome} ${uno.versione}`)).join(", ") || "nessuno";
        parti.push(
          `Ambiente "${ambiente.nome}", già installato dal proprietario fuori da Shinka (guardato il ${giorno(viste.quando)}):${problema}\n` +
            `  server MCP: ${server}\n  plugin: ${plugin}\n  skill e comandi: ${viste.quanteSkill}` +
            (viste.skill.length === 0 ? "" : ` (${viste.skill.slice(0, 25).join(", ")}${viste.quanteSkill > 25 ? ", …" : ""})`),
        );
      }
      parti.push(
        "Ciò che è già in un ambiente lo usano i progetti di quell'ambiente, non tu, e Shinka non lo gestisce: non proporne un doppione. " +
          "Tu usi le estensioni di Shinka accese nell'ambiente in cui giri.",
      );
      return risposta(parti.join("\n\n"));
    },

    async mostraElaborato(argomenti: { ambiente: string; percorso: string; titolo?: string; aggiorna?: string }): Promise<RispostaStrumento> {
      if (opzioni.elaborati === undefined) {
        return nonRiuscito("In questa installazione di Shinka gli elaborati non si possono mostrare: di' al proprietario dove sta il file.");
      }
      const idArgomento = opzioni.home().idArgomentoAperto;
      const trovato = await opzioni.elaborati.trova(idArgomento, argomenti.ambiente, argomenti.percorso);
      if ("problema" in trovato) return nonRiuscito(trovato.problema);
      const titolo = argomenti.titolo?.trim();
      const aggiorna = argomenti.aggiorna?.trim();
      opzioni.home().pubblica({
        tipo: "elaborato-mostrato",
        idArgomento,
        idAmbiente: trovato.ambiente.id,
        nomeAmbiente: trovato.ambiente.nome,
        percorso: trovato.percorso,
        ...(titolo === undefined || titolo === "" ? {} : { titolo }),
        ...(aggiorna === undefined || aggiorna === "" ? {} : { aggiorna }),
      });
      return risposta(
        `Il proprietario vede "${trovato.percorso}" nella chat, e lo ritrova nella pagina Elaborati. ` +
          "Se ti ha scritto da Telegram, il file gli arriva anche lì, dopo il testo con cui chiudi il turno.",
      );
    },

    posizioneDelProprietario(): RispostaStrumento {
      return risposta(posizioneInParole(opzioni.posizione?.ultima(), Date.now()));
    },

    async disegnaMappa(argomenti: {
      punti: PuntoMappa[];
      tragitto?: "piedi";
      file?: string;
    }): Promise<RispostaStrumento> {
      const servizi = opzioni.mappe;
      const delCentro = ambienti.stato().ambienti.find((ambiente) => ambiente.delCentro);
      if (servizi === undefined || delCentro === undefined) {
        return nonRiuscito("In questa installazione di Shinka le mappe non si disegnano.");
      }
      const file = (argomenti.file ?? "mappa.png").trim();
      if (!percorsoDiElaboratoValido(file) || !/\.png$/i.test(file)) {
        return nonRiuscito("Il file dev'essere un nome che finisce con .png, dentro la cartella di questo argomento: per esempio mappa-shinjuku.png.");
      }
      const cartella = opzioni.cartellaDellArgomento?.(opzioni.home().idArgomentoAperto);
      if (cartella === undefined) return nonRiuscito("La cartella di questo argomento non si trova.");
      try {
        await mkdir(dirname(join(cartella, file)), { recursive: true });
        const mappa = await disegnaMappa(
          { punti: argomenti.punti, ...(argomenti.tragitto === undefined ? {} : { tragitto: argomenti.tragitto }) },
          join(cartella, file),
          servizi,
        );
        const righe = [
          `Mappa disegnata: "${file}" nell'ambiente "${delCentro.nome}". Mostrala con mostra_elaborato.`,
          ...(mappa.percorso === undefined
            ? []
            : [
                `Tragitto a piedi: ${(mappa.percorso.metri / 1000).toFixed(1).replace(".", ",")} km, circa ${Math.max(1, Math.round(mappa.percorso.secondi / 60))} minuti (calcolato con OpenStreetMap).`,
              ]),
          `Google Maps, il luogo: ${mappa.link.luogo}`,
          ...(mappa.link.aPiedi === undefined ? [] : [`Google Maps, a piedi: ${mappa.link.aPiedi}`]),
          ...(mappa.link.conIMezzi === undefined ? [] : [`Google Maps, con i mezzi: ${mappa.link.conIMezzi}`]),
          ...mappa.avvisi.map((avviso) => `Attenzione: ${avviso}`),
        ];
        return risposta(righe.join("\n"));
      } catch (errore) {
        return nonRiuscito(errore instanceof MappaNonDisegnata ? errore.message : `La mappa non è stata disegnata: ${errore instanceof Error ? errore.message : String(errore)}`);
      }
    },

    async inviaFileTelegram(argomenti: { ambiente: string; percorso: string; didascalia?: string }): Promise<RispostaStrumento> {
      const ponte = opzioni.telegram?.();
      if (opzioni.elaborati === undefined || ponte === undefined) {
        return nonRiuscito("In questa installazione di Shinka Telegram non c'è: il file non si può mandare lì. Dillo al proprietario.");
      }
      const idArgomento = opzioni.home().idArgomentoAperto;
      const trovato = await opzioni.elaborati.trova(idArgomento, argomenti.ambiente, argomenti.percorso);
      if ("problema" in trovato) return nonRiuscito(trovato.problema);
      const didascalia = argomenti.didascalia?.trim();
      const problema = await ponte.inviaElaborato({
        idArgomento,
        idAmbiente: trovato.ambiente.id,
        percorso: trovato.percorso,
        ...(didascalia === undefined || didascalia === "" ? {} : { titolo: didascalia }),
      });
      if (problema !== undefined) return nonRiuscito(`Il file non è arrivato su Telegram: ${problema}`);
      return risposta(`"${trovato.percorso}" è arrivato al proprietario su Telegram.`);
    },

    chiediDoveLavorare(argomenti: { lavoro: string }): RispostaStrumento {
      const lavoro = argomenti.lavoro.trim();
      if (lavoro === "") return nonRiuscito("Serve una riga che dica di quale lavoro si tratta.");
      opzioni.home().pubblica({ tipo: "scelta-richiesta", idScelta: randomUUID(), lavoro });
      return risposta(
        "Domanda mostrata al proprietario, con due pulsanti: farlo qui nella Home oppure aprire un progetto. " +
          "Termina con una frase sola e aspetta la sua risposta, senza cominciare il lavoro.",
      );
    },

    elencaProgetti(): RispostaStrumento {
      const progetti = lavori.stato().progetti;
      if (progetti.length === 0) return risposta("Non c'è ancora nessun progetto.");
      return risposta(
        progetti
          .map((p) => {
            const storia = storiaDelProgetto(p.id);
            // Lo stato scritto dal progetto vale più del suo ultimo messaggio, che può parlare d'altro.
            const stato = statoDelProgetto(storia)?.testo;
            const resoconto = stato ?? ultimoResoconto(storia);
            const inBreve = resoconto?.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim() ?? "";
            const ultimo =
              resoconto === undefined
                ? ""
                : stato === undefined
                  ? `; ultimo resoconto: ${resoconto.replace(/\s+/g, " ").slice(0, 300)}${resoconto.length > 300 ? "…" : ""}`
                  : `; stato del progetto: ${inBreve.slice(0, 400)}${inBreve.length > 400 ? "…" : ""}`;
            return `- nome: "${p.nome}"; ambiente: ${p.nomeAmbiente}; condizione: ${CONDIZIONI[p.condizione]}${ultimo}`;
          })
          .join("\n"),
      );
    },

    leggiProgetto(argomenti: { progetto: string; storia?: boolean }): RispostaStrumento {
      const progetto = progettoPerNome(argomenti.progetto);
      if ("content" in progetto) return progetto;
      const storia = storiaDelProgetto(progetto.id);
      const stato = statoDelProgetto(storia);
      const parti = [
        `Progetto "${progetto.nome}"`,
        `Ambiente: ${progetto.nomeAmbiente}; cartella: ${progetto.cartella}`,
        `Condizione: ${CONDIZIONI[progetto.condizione]}`,
        `Nato il ${giorno(progetto.creatoIl)}`,
        `\nBrief:\n${progetto.brief}`,
        stato === undefined
          ? "\nStato del progetto: il progetto non lo ha ancora scritto."
          : `\nStato del progetto, scritto dal progetto il ${giorno(stato.quando)}:\n${stato.testo}`,
        `\nUltima richiesta del proprietario:\n${ultimaRichiesta(storia) ?? "nessuna"}`,
        `\nUltimo resoconto del progetto:\n${ultimoResoconto(storia) ?? "il progetto non ha ancora scritto nulla"}`,
      ];
      if (argomenti.storia === true) {
        parti.push(`\nStoria della conversazione, dalla più vecchia:\n${trascrivi(storia, "Progetto")}`);
      }
      return risposta(parti.join("\n"));
    },

    apriProgetto(argomenti: { progetto: string }): RispostaStrumento {
      const progetto = progettoPerNome(argomenti.progetto);
      if ("content" in progetto) return progetto;
      opzioni.home().pubblica({ tipo: "apri-progetto", idProgetto: progetto.id });
      return risposta(`L'interfaccia si è spostata sul progetto "${progetto.nome}".`);
    },

    inoltraAProgetto(argomenti: { progetto: string; istruzione: string; modello?: string; effort?: Impegno }): RispostaStrumento {
      const progetto = progettoPerNome(argomenti.progetto);
      if ("content" in progetto) return progetto;
      const istruzione = argomenti.istruzione.trim();
      if (istruzione === "") return nonRiuscito("Serve l'istruzione da inoltrare.");
      // Modello ed effort per questo lavoro solo, se il proprietario li ha chiesti. I permessi no:
      // li sceglie il proprietario, nella conversazione del progetto.
      const modello = argomenti.modello?.trim();
      const perQuestoLavoro = {
        ...(modello === undefined || modello === "" ? {} : { modello }),
        ...(argomenti.effort === undefined ? {} : { impegno: argomenti.effort }),
      };
      const conScelte = Object.keys(perQuestoLavoro).length > 0;
      try {
        lavori.invia(progetto.id, `[Inoltrato dalla Home su richiesta del proprietario]\n${istruzione}`, [], conScelte ? perQuestoLavoro : undefined);
      } catch (errore) {
        if (errore instanceof AmbienteSpento) {
          return nonRiuscito(
            `L'ambiente del progetto "${progetto.nome}" è spento: l'istruzione non è stata inoltrata.`,
          );
        }
        throw errore;
      }
      const usate = lavori.impostazioniInUso(progetto.id);
      return risposta(
        `Istruzione inoltrata al progetto "${progetto.nome}": il lavoro prosegue lì. ` +
          (conScelte
            ? `Per questo lavoro solo usa il modello ${usate.modello ?? "predefinito"} con effort ${usate.impegno ?? "predefinito"}; poi il progetto torna alle sue impostazioni. `
            : "") +
          "Per sapere com'è andata usa leggi_progetto più tardi.",
      );
    },

    cambiaArgomento(argomenti: { titolo: string; riassunto: string; riprendi?: string }): RispostaStrumento {
      const esito = opzioni.home().richiediCambio(argomenti);
      return typeof esito === "string" ? risposta(esito) : nonRiuscito(esito.rifiuto);
    },

    async cercaArgomenti(argomenti: { testo: string }): Promise<RispostaStrumento> {
      const cercabili = await opzioni.home().cercabili();
      if (cercabili.length === 0) return risposta("Non c'è ancora nessun argomento archiviato.");
      const voci = new Map(opzioni.home().archiviati().map((voce) => [voce.id, voce]));
      const trovati = cerca(cercabili, argomenti.testo);
      if (trovati.length === 0) {
        return risposta(
          `Nessun argomento archiviato parla di "${argomenti.testo}". Gli ultimi archiviati sono:\n` +
            [...voci.values()]
              .slice(0, 8)
              .map((voce) => `- ${voce.id}: "${voce.titolo}" (${giorno(voce.archiviatoIl)})`)
              .join("\n"),
        );
      }
      return risposta(
        trovati
          .map((trovato) => {
            const voce = voci.get(trovato.id);
            const storia = cercabili.find((c) => c.id === trovato.id)?.storia ?? [];
            const file = fileScritti(storia).map((f) =>
              f.ambiente === undefined ? f.percorso : `${f.percorso} (in "${f.ambiente}")`,
            );
            return [
              `- identificativo: ${trovato.id}`,
              `  titolo: "${voce?.titolo ?? ""}"; archiviato il ${giorno(voce?.archiviatoIl ?? "")}`,
              `  riassunto: ${voce?.riassunto === "" ? "manca" : (voce?.riassunto ?? "manca")}`,
              ...(file.length === 0 ? [] : [`  file: ${file.join(", ")}`]),
              ...(trovato.brano === undefined ? [] : [`  brano: …${trovato.brano}…`]),
            ].join("\n");
          })
          .join("\n"),
      );
    },

    async leggiArgomento(argomenti: { argomento: string }): Promise<RispostaStrumento> {
      const cercabili = await opzioni.home().cercabili();
      const chiesto = argomenti.argomento.trim();
      const trovato =
        cercabili.find((c) => c.id === chiesto) ??
        trovaPerNome(
          cercabili.map((c) => ({ ...c, nome: c.titolo })),
          chiesto,
        );
      if (trovato === undefined) {
        return nonRiuscito(
          `Nessun argomento archiviato corrisponde a "${chiesto}". Usa l'identificativo indicato da cerca_argomenti.`,
        );
      }
      const voce = opzioni.home().archiviati().find((v) => v.id === trovato.id);
      const file = fileScritti(trovato.storia);
      const parti = [
        `Argomento "${trovato.titolo}" (${trovato.id}), archiviato il ${giorno(voce?.archiviatoIl ?? "")}`,
        `Riassunto: ${trovato.riassunto === "" ? "manca" : trovato.riassunto}`,
        `\nConversazione, dalla più vecchia:\n${trascrivi(trovato.storia, "Home")}`,
      ];
      if (file.length > 0) {
        parti.push("\nFile scritti in questo argomento, con l'ultimo contenuto che la storia conserva:");
        for (const scritto of file) {
          const dove = scritto.ambiente === undefined ? "nell'ambiente del centro" : `nell'ambiente "${scritto.ambiente}"`;
          parti.push(`\n### ${scritto.percorso} (${dove})`);
          parti.push(
            scritto.contenuto === undefined
              ? "(il file è stato solo modificato: per il testo intero va riletto nel suo ambiente)"
              : scritto.contenuto.length <= FILE_RIPORTATO_MASSIMO
                ? scritto.contenuto
                : `${scritto.contenuto.slice(0, FILE_RIPORTATO_MASSIMO)}\n[… tagliato: per il resto va riletto nel suo ambiente]`,
          );
        }
        parti.push(
          "\nSe il file può essere cambiato da allora, rileggilo nel suo ambiente prima di riconsegnarlo: " +
            "con Read se è in quello del centro, con leggi_file negli altri.",
        );
      }
      return risposta(parti.join("\n"));
    },
  };
}

const AMBIENTE = z
  .string()
  .describe(
    "Solo il nome dell'ambiente, come compare tra virgolette in elenca_ambienti: senza sistema e senza ciò che offre.",
  );

const PROGETTO = z.string().describe("Solo il nome del progetto, come compare tra virgolette in elenca_progetti.");

/** Ciò che la Home scrive per proporre un'estensione. */
interface ArgomentiEstensione {
  nome: string;
  descrizione?: string;
  ambiente: string;
  tipo?: "mcp-locale" | "mcp-remoto" | "plugin" | "modello-locale";
  comando?: string;
  porta?: number;
  modello?: string;
  contesto?: number;
  uscita?: number;
  impegni?: Impegno[];
  argomenti?: string[];
  variabili?: Record<string, string>;
  indirizzo?: string;
  trasporto?: "http" | "sse";
  repository?: string;
  riferimento?: string;
  cartella?: string;
  chiavi?: string[];
}

/** Registra gli strumenti della Home presso l'harness, con le descrizioni che Claude legge. */
export function creaStrumentiHome(opzioni: OpzioniStrumentiHome) {
  const azioni = azioniDellaHome(opzioni);

  return createSdkMcpServer({
    name: GRUPPO_STRUMENTI_HOME,
    version: "1.0.0",
    alwaysLoad: true,
    tools: [
      tool(
        "elenca_ambienti",
        "Elenca gli ambienti attivi, con il sistema, ciò che ciascuno offre, la shell dei comandi e la cartella che questo argomento ha lì. Usalo prima di agire in un ambiente e prima di proporre un progetto.",
        {},
        async () => azioni.elencaAmbienti(),
      ),
      tool(
        "esegui_in_ambiente",
        "Esegue un comando in un ambiente diverso da quello in cui giri, nella shell di quell'ambiente (PowerShell su Windows, bash su Linux) e partendo dalla cartella di questo argomento. Restituisce codice di uscita e uscita del comando. Per l'ambiente in cui giri usa Bash.",
        {
          ambiente: AMBIENTE,
          comando: z.string().min(1).max(20_000).describe("Il comando, scritto per la shell di quell'ambiente."),
          secondi: z
            .number()
            .int()
            .min(1)
            .max(600)
            .optional()
            .describe("Dopo quanti secondi fermare il comando. Se manca, 120."),
        },
        async (argomenti) => azioni.eseguiInAmbiente(argomenti),
      ),
      tool(
        "scrivi_file",
        "Scrive un file di testo in un ambiente diverso da quello in cui giri, creandolo o sostituendolo per intero. Un percorso relativo parte dalla cartella di questo argomento in quell'ambiente. Per l'ambiente in cui giri usa Write.",
        {
          ambiente: AMBIENTE,
          percorso: z
            .string()
            .min(1)
            .max(1000)
            .describe("Di norma solo il nome del file: finisce nella cartella di questo argomento."),
          contenuto: z.string().max(1_000_000).describe("Il testo intero del file."),
        },
        async (argomenti) => azioni.scriviFile(argomenti),
      ),
      tool(
        "leggi_file",
        "Legge un file di testo in un ambiente diverso da quello in cui giri. Un percorso relativo parte dalla cartella di questo argomento in quell'ambiente. Per l'ambiente in cui giri usa Read.",
        {
          ambiente: AMBIENTE,
          percorso: z.string().min(1).max(1000),
        },
        async (argomenti) => azioni.leggiFile(argomenti),
      ),
      tool(
        "proponi_progetto",
        "Propone al proprietario di aprire un progetto per un lavoro che durerà più sedute o che ha bisogno di una cartella e di un repository suoi. Non crea nulla: mostra una scheda, e il progetto nasce solo se il proprietario conferma. Se questo argomento ha già prodotto file nell'ambiente indicato, il progetto nasce con una loro copia: proponi l'ambiente in cui stanno. Dopo averlo usato, rispondi con una frase sola e non cominciare il lavoro.",
        {
          nome: z.string().min(1).max(60).describe("Nome breve del progetto, due o tre parole."),
          brief: z
            .string()
            .min(1)
            .max(8000)
            .describe(
              "La richiesta del proprietario, completa di ciò che serve a chi comincerà il lavoro senza aver letto questa conversazione.",
            ),
          ambiente: AMBIENTE,
          cartella_esistente: z
            .string()
            .max(1000)
            .optional()
            .describe(
              "Il percorso completo di una cartella che esiste già nell'ambiente, quando il proprietario vuole che il progetto lavori lì: il progetto nasce in quella cartella, senza copiarla né toccarla. Se manca, nasce in una cartella nuova.",
            ),
        },
        async (argomenti) => azioni.proponiProgetto(argomenti),
      ),
      tool(
        "mostra_elaborato",
        "Mostra al proprietario, direttamente nella chat, un file che hai prodotto in questo argomento: un documento, un itinerario, uno script, un'immagine, una mappa o un'altra pagina HTML. Lo vede come anteprima, e lo ritrova più tardi nella pagina Elaborati, che raccoglie ciò che gli hai consegnato. Mostra solo la versione definitiva, non prove, bozze o file di lavoro. Il file deve stare nella cartella di questo argomento, nell'ambiente indicato. Non chiede consenso: mostra soltanto.",
        {
          ambiente: AMBIENTE,
          percorso: z
            .string()
            .min(1)
            .max(1000)
            .describe("Il percorso del file: relativo alla cartella di questo argomento, oppure completo dentro di essa."),
          titolo: z.string().max(120).optional().describe("Che cos'è, in poche parole, se il nome del file non basta."),
          aggiorna: z
            .string()
            .max(AGGIORNA_MASSIMO)
            .optional()
            .describe(
              "Per un elaborato vivo, con dati che cambiano: il comando che lo rifà con i dati del momento, eseguito nella cartella di questo argomento nello stesso ambiente (per esempio `python3 cruscotto.py`). Il proprietario lo vede e lo fa partire con il pulsante «Aggiorna». Deve riscrivere lo stesso file, in meno di tre minuti, senza chiedere nulla.",
            ),
        },
        async (argomenti) => azioni.mostraElaborato(argomenti),
      ),
      tool(
        "posizione_del_proprietario",
        "Dice dove si trova il proprietario, se ha condiviso la sua posizione da Telegram o dal browser nelle ultime ore: coordinate, precisione, da dove viene e quanto è vecchia. Usalo quando ti chiede qualcosa che parte da dove si trova, come «come ci arrivo da qui?» o «che c'è qui vicino?». Se non c'è, dice come chiedergliela.",
        {},
        async () => azioni.posizioneDelProprietario(),
      ),
      tool(
        "disegna_mappa",
        "Disegna una mappa come immagine PNG nella cartella di questo argomento: le mappe di OpenStreetMap (in Giappone con i nomi in alfabeto latino), i punti con le loro etichette e, con tragitto \"piedi\", il percorso a piedi dal primo all'ultimo punto, con lunghezza e tempo. Il primo punto è la partenza (verde), l'ultimo l'arrivo (rosso). Restituisce anche i link a Google Maps per il luogo, a piedi e con i mezzi. Poi mostrala con mostra_elaborato. Da Telegram le mappe vanno sempre così, non come pagina HTML.",
        {
          punti: z
            .array(
              z.object({
                lat: z.number().min(-85).max(85),
                lon: z.number().min(-180).max(180),
                etichetta: z.string().max(60).optional().describe("Il nome da scrivere accanto al punto, in alfabeto latino."),
                ruolo: z.enum(["partenza", "arrivo", "tappa"]).optional(),
              }),
            )
            .min(1)
            .max(20),
          tragitto: z.enum(["piedi"]).optional().describe("\"piedi\" per disegnare il percorso a piedi tra i punti, nell'ordine."),
          file: z.string().max(200).optional().describe("Il nome del file, che finisce con .png. Se manca, mappa.png."),
        },
        async (argomenti) => azioni.disegnaMappa(argomenti),
      ),
      tool(
        "invia_file_telegram",
        "Manda al proprietario su Telegram, nella chat con il bot, un file che hai prodotto in questo argomento: un PDF, un documento, un'immagine (arriva come foto), una pagina HTML, uno script. Usalo quando ti chiede di ricevere un file lì. Se ti ha scritto da Telegram non serve: i file che mostri con mostra_elaborato gli arrivano già. Il file deve stare nella cartella di questo argomento, fino a 50 MB. Non chiede consenso: il file va solo al proprietario.",
        {
          ambiente: AMBIENTE,
          percorso: z
            .string()
            .min(1)
            .max(1000)
            .describe("Il percorso del file: relativo alla cartella di questo argomento, oppure completo dentro di essa."),
          didascalia: z.string().max(1000).optional().describe("Una riga sotto il file, se il nome non basta."),
        },
        async (argomenti) => azioni.inviaFileTelegram(argomenti),
      ),
      tool(
        "chiedi_dove_lavorare",
        "Quando non è chiaro se un lavoro si chiude in una seduta o merita un progetto, chiede al proprietario dove farlo: compaiono due pulsanti, farlo qui nella Home oppure aprire un progetto. Dopo averlo usato, fermati e aspetta la risposta.",
        {
          lavoro: z.string().min(1).max(300).describe("Il lavoro in una riga, come lo leggerà il proprietario."),
        },
        async (argomenti) => azioni.chiediDoveLavorare(argomenti),
      ),
      tool(
        "elenca_progetti",
        "Elenca i progetti esistenti, con il loro ambiente, la condizione in cui si trovano e l'inizio del loro stato del progetto, oppure del loro ultimo resoconto se non lo hanno ancora scritto.",
        {},
        async () => azioni.elencaProgetti(),
      ),
      tool(
        "leggi_progetto",
        "Dice a che punto è un progetto: brief, condizione, stato del progetto come il progetto stesso lo tiene aggiornato, ultima richiesta del proprietario e ultimo resoconto. Funziona anche quando l'ambiente del progetto è spento. Con `storia` aggiunge la conversazione del progetto, per quando serve il dettaglio.",
        {
          progetto: PROGETTO,
          storia: z.boolean().optional().describe("Vero per avere anche la conversazione del progetto."),
        },
        async (argomenti) => azioni.leggiProgetto(argomenti),
      ),
      tool(
        "apri_progetto",
        "Porta il proprietario su un progetto esistente, quando chiede di aprirlo o di tornarci.",
        { progetto: PROGETTO },
        async (argomenti) => azioni.apriProgetto(argomenti),
      ),
      tool(
        "inoltra_a_progetto",
        "Passa un'istruzione a un progetto, che la riceve come un messaggio e ci lavora nella sua conversazione. Usalo solo quando è il proprietario a chiederlo. Se il proprietario chiede un modello o un effort per questo lavoro, indicali: valgono finché il progetto lavora su questa istruzione, poi tornano le sue impostazioni. Il modo dei permessi non si cambia da qui: lo sceglie il proprietario nella conversazione del progetto.",
        {
          progetto: PROGETTO,
          istruzione: z
            .string()
            .min(1)
            .max(8000)
            .describe("L'istruzione completa: il progetto non vede questa conversazione."),
          modello: z
            .string()
            .max(100)
            .optional()
            .describe("Il modello per questo lavoro, solo se il proprietario lo chiede: per esempio opus, sonnet, haiku, fable."),
          effort: z.enum(IMPEGNI).optional().describe("L'effort per questo lavoro, solo se il proprietario lo chiede."),
        },
        async (argomenti) => azioni.inoltraAProgetto(argomenti),
      ),
      tool(
        "cambia_argomento",
        "Archivia l'argomento aperto e passa a un altro: uno nuovo, oppure uno archiviato da riprendere. Usalo come prima e unica azione quando il messaggio del proprietario apre una questione diversa. Il messaggio viene riproposto da Shinka nell'altro argomento: dopo averlo usato non rispondere e non scrivere altro.",
        {
          titolo: z.string().min(1).max(80).describe("Titolo dell'argomento che si chiude, poche parole."),
          riassunto: z
            .string()
            .max(2000)
            .describe(
              "Che cosa è stato chiesto e fatto nell'argomento che si chiude, con quali file e in quale ambiente, e che cosa è rimasto in sospeso. Mai segreti.",
            ),
          riprendi: z
            .string()
            .optional()
            .describe(
              "Identificativo di un argomento archiviato da riprendere, come lo indica cerca_argomenti. Se manca comincia un argomento nuovo.",
            ),
        },
        async (argomenti) => azioni.cambiaArgomento(argomenti),
      ),
      tool(
        "cerca_argomenti",
        "Cerca tra gli argomenti archiviati quelli che parlano di qualcosa: nei titoli, nei riassunti, nei nomi dei file e in ciò che è stato detto e scritto. Usalo prima di produrre qualcosa che potrebbe esistere già.",
        { testo: z.string().min(1).max(200).describe("Poche parole che descrivono ciò che si cerca.") },
        async (argomenti) => azioni.cercaArgomenti(argomenti),
      ),
      tool(
        "leggi_argomento",
        "Riporta la conversazione di un argomento archiviato e i file che vi sono stati scritti, con il loro contenuto.",
        { argomento: z.string().min(1).max(100).describe("L'identificativo indicato da cerca_argomenti.") },
        async (argomenti) => azioni.leggiArgomento(argomenti),
      ),
      ...(opzioni.sviluppo === undefined
        ? []
        : [
            tool(
              "proponi_sviluppo",
              "Propone al proprietario di sviluppare un pezzo nuovo di Shinka stessa: una funzione che manca, un comportamento da cambiare, un difetto da correggere. Non avvia nulla: mostra una scheda con il titolo e la richiesta, e solo se il proprietario la conferma la richiesta passa al progetto Shinka, che ci lavora sul codice di Shinka. Usalo quando è lui a chiedere di cambiare Shinka, e anche di tua iniziativa quando, lavorando, ti accorgi che a Shinka manca qualcosa che servirebbe davvero. Dopo averlo usato, rispondi con una frase sola e non cominciare il lavoro.",
              {
                titolo: z.string().min(1).max(80).describe("Il pezzo da sviluppare, in poche parole."),
                richiesta: z
                  .string()
                  .min(1)
                  .max(8000)
                  .describe(
                    "Che cosa manca o va cambiato, perché serve e come dovrebbe comportarsi, con ciò che il proprietario ha detto in proposito. Chi ci lavorerà non vede questa conversazione.",
                  ),
              },
              async (argomenti) => azioni.proponiSviluppo(argomenti),
            ),
          ]),
      ...(opzioni.estensioni === undefined
        ? []
        : [
            tool(
              "elenca_estensioni",
              "Elenca le estensioni di Shinka (server MCP e plugin di terzi, con gli ambienti in cui sono accese) e, per ogni ambiente attivo, ciò che il proprietario vi ha già installato per conto suo fuori da Shinka. Usalo quando chiede che cosa è installato, e sempre prima di proporre un'estensione, per non proporre un doppione.",
              { guarda: z.boolean().optional().describe("Vero per guardare di nuovo adesso che cosa c'è negli ambienti, invece di riferire l'ultima volta.") },
              async (argomenti) => azioni.elencaEstensioni(argomenti),
            ),
            tool(
              "proponi_estensione",
              "Propone al proprietario di installare e accendere un'estensione in un ambiente: un server MCP locale (un programma che parte lì), un server MCP remoto (un indirizzo), un plugin di Claude Code preso da un repository Git, oppure un modello locale (un server come llama-server che gira su quella macchina e parla come l'API di Anthropic: i progetti di quell'ambiente lo scelgono come modello o come chi implementa, e il nodo lo accende quando serve e lo spegne dopo dieci minuti fermo). Non installa né avvia nulla: mostra una scheda con che cosa è, il comando o l'indirizzo esatto, da dove viene e in quale ambiente, e solo se il proprietario conferma l'ambiente la avvia una volta e la accende se parte. Per accendere in un altro ambiente un'estensione che è già nell'elenco, indica solo nome e ambiente, senza tipo. Dopo averlo usato, rispondi con una frase sola.",
              {
                nome: z.string().min(1).max(40).describe("Il nome dell'estensione: minuscole, cifre e trattini. I suoi strumenti si chiameranno mcp__nome__…"),
                descrizione: z.string().max(600).optional().describe("Che cosa fa e a che cosa serve al proprietario, in una o due frasi. Serve sempre per un'estensione nuova."),
                ambiente: AMBIENTE,
                tipo: z.enum(["mcp-locale", "mcp-remoto", "plugin", "modello-locale"]).optional().describe("Che cos'è. Manca solo per accendere altrove un'estensione già in elenco."),
                comando: z
                  .string()
                  .max(400)
                  .optional()
                  .describe("Per mcp-locale e modello-locale: il programma da avviare, senza argomenti, scritto per il sistema di quell'ambiente. Per un modello locale il server stesso (per esempio il percorso completo di llama-server.exe), non uno script che lo lancia. Su Windows un comando come npx va avviato da cmd: comando \"cmd\", argomenti [\"/c\", \"npx\", …]."),
                argomenti: z.array(z.string().max(2000)).max(80).optional().describe("Per mcp-locale e modello-locale: gli argomenti, uno per voce; per un modello locale \"{impegno}\" diventa l'impegno con cui il server parte. Scrivi la versione del pacchetto (pacchetto@1.2.3): un'estensione resta ferma alla versione mostrata nella scheda."),
                variabili: z.record(z.string(), z.string().max(2000)).optional().describe("Per mcp-locale e modello-locale: variabili d'ambiente che non sono segreti."),
                porta: z.number().int().min(1024).max(65535).optional().describe("Per modello-locale: la porta su cui il server ascolta, su 127.0.0.1."),
                modello: z.string().max(120).optional().describe("Per modello-locale: il nome con cui il server chiama il modello (per llama-server, il suo --alias)."),
                contesto: z.number().int().min(1024).optional().describe("Per modello-locale: i token di contesto del server (per llama-server, -c)."),
                uscita: z.number().int().min(256).optional().describe("Per modello-locale: quanti token può scrivere una risposta, ragionamento compreso. Se manca, 32000."),
                impegni: z
                  .array(z.enum(IMPEGNI))
                  .min(1)
                  .max(5)
                  .optional()
                  .describe("Per modello-locale: gli impegni che il server accetta al posto di \"{impegno}\" negli argomenti (per llama-server, --reasoning-effort {impegno}); il primo è il predefinito."),
                indirizzo: z.string().max(1000).optional().describe("Per mcp-remoto: l'indirizzo https del server."),
                trasporto: z.enum(["http", "sse"]).optional().describe("Per mcp-remoto: come ci si collega. Se manca, http."),
                repository: z.string().max(1000).optional().describe("Per plugin: l'indirizzo https del repository Git."),
                riferimento: z.string().max(200).optional().describe("Per plugin: un ramo, un'etichetta o un commit scritto per intero. Shinka lo ferma al commit a cui punta adesso. Se manca, il ramo predefinito."),
                cartella: z.string().max(400).optional().describe("Per plugin: la cartella del plugin dentro il repository, se il repository ne raccoglie più d'uno."),
                chiavi: z
                  .array(z.string().max(80))
                  .max(10)
                  .optional()
                  .describe("Solo i NOMI dei segreti che l'estensione vuole: variabili d'ambiente per mcp-locale (per esempio GITHUB_TOKEN), intestazioni per mcp-remoto (per esempio Authorization). Il valore lo scrive il proprietario nel vault: tu non lo chiedi e non lo vedi."),
              },
              async (argomenti) => azioni.proponiEstensione(argomenti),
            ),
          ]),
      ...(opzioni.comuni === undefined ? [] : [...definizioniComuni(opzioni.comuni), ...definizioniApplicazione(opzioni.comuni)]),
    ],
  });
}
