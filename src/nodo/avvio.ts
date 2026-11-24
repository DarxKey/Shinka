/**
 * Avvia il nodo di Shinka su questa macchina e lo collega al centro.
 *
 * La prima volta servono l'indirizzo del centro e il nome dell'ambiente:
 *
 *   npm run nodo -- --centro http://192.168.1.20:7850 --nome "PC Windows" --descrizione "Unity, Blender" --progetti "C:/Users/io/Progetti"
 *
 * Con `--browser-del-pc si` i progetti di questo ambiente possono usare il browser di questa macchina
 * attraverso l'estensione Claude in Chrome; `--browser-del-pc no` lo spegne. Vale solo su Windows e macOS,
 * e solo nei modi dei permessi in cui ogni azione viene chiesta. Accenderlo fa riscrivere a Claude Code il
 * collegamento con l'estensione (~/.claude/chrome), che da quel momento punta al programma usato da Shinka.
 *
 * Il collegamento con il centro è cifrato: il nodo ricorda il certificato del centro la prima volta
 * che lo vede, e da lì in poi parla solo con chi lo presenta. Se il centro è stato rifatto da capo,
 * `--dimentica-centro` fa dimenticare al nodo quello di prima.
 *
 * Le scelte vengono salvate: dalla volta successiva basta `npm run nodo`.
 * Per cambiarne una, per esempio la cartella dei progetti, si riavvia il nodo indicando solo quella.
 * La cartella nuova vale per i progetti che nasceranno: quelli esistenti restano dove sono.
 *
 * Avviato così il nodo resta alla versione che ha: per cambiarla lo si ferma e lo si riavvia dal
 * codice nuovo. Tenuto acceso dal suo guardiano (`src/guardiano/avvio-nodo.ts`) passa invece da
 * solo alla versione del centro, quando il centro glielo chiede.
 *
 * Variabili d'ambiente:
 *   SHINKA_DATI_NODO  cartella dei dati del nodo (predefinita: ./dati-nodo)
 *   SHINKA_GUARDIANO  "1" quando il nodo è tenuto acceso dal suo guardiano, che lo imposta da sé
 */

import { ProcessiDiShinka } from "./processi-di-shinka.ts";
import { AvvioConWindows } from "./avvio-con-windows.ts";
import { AccessiDeiMotori } from "./accessi.ts";
import { CampionatoreRisorse } from "./risorse.ts";
import { ETICHETTA_STACK } from "../protocollo/stack.ts";
import { modelliDeiMotori } from "./sonde-motori.ts";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CODICE_RIAVVIO,
  CODICE_RIFIUTATO,
  FILE_COLLEGATO,
  FILE_INSTALLAZIONE,
  leggiInstallazione,
  scriviInstallazione,
} from "../guardiano/guardiano.ts";
import { inBreve, versioneDi } from "../protocollo/versione.ts";
import { preparaAggiornamento } from "./aggiornamento.ts";
import { CollegamentoAlCentro, indirizzoDelCollegamento } from "./collegamento.ts";
import { EstensioniInAmbiente } from "./estensioni.ts";
import { custodiaDelSegreto, leggiOCreaIdentita } from "./identita.ts";
import { LavoroDelNodo } from "./lavoro.ts";
import { LavoroOffline } from "./offline.ts";
import { Sportello } from "./sportello.ts";
import { preparaCartellaSkill } from "./skill.ts";
import { sistemaDiQuestaMacchina } from "./sistema.ts";
import { FILE_STATO_DEL_COLLEGAMENTO, scriviStatoDelCollegamento } from "./stato-del-collegamento.ts";

interface Impostazioni {
  centro: string;
  nome: string;
  descrizione: string;
  /** Cartella in cui nascono le cartelle dei progetti nuovi. */
  progetti: string;
  /** Vero se i progetti possono usare il browser di questa macchina. */
  browserDelPc: boolean;
  /** L'impronta del certificato dei nodi del centro, da quando il nodo lo ha riconosciuto o dal comando che lo ha preparato. */
  improntaDelCentro?: string;
}

const dati = resolve(process.env.SHINKA_DATI_NODO ?? "dati-nodo");
const fileImpostazioni = join(dati, "nodo.json");
/** La cartella da cui gira questa versione del nodo. */
const installata = resolve(import.meta.dirname, "../..");
const fileInstallazione = join(dati, FILE_INSTALLAZIONE);
const fileCollegato = join(dati, FILE_COLLEGATO);
const fileStatoDelCollegamento = join(dati, FILE_STATO_DEL_COLLEGAMENTO);
const colGuardiano = process.env.SHINKA_GUARDIANO === "1";

try {
  await mkdir(dati, { recursive: true });
  const impostazioni = await leggiImpostazioni();
  // Controlla subito che l'indirizzo sia utilizzabile, prima di provare a collegarsi.
  indirizzoDelCollegamento(impostazioni.centro);
  await writeFile(fileImpostazioni, JSON.stringify(impostazioni, null, 2));

  const fileIdentita = join(dati, "identita.json");
  const identita = await leggiOCreaIdentita(fileIdentita);
  const versione = await versioneDi(installata);
  // Ciò che una versione di prima ha scritto del suo collegamento non vale per questa.
  await rm(fileCollegato, { force: true });
  console.log(`Nodo "${impostazioni.nome}" (${sistemaDiQuestaMacchina()}) verso ${impostazioni.centro}`);
  console.log(
    `Versione ${versione === undefined ? "non registrata" : inBreve(versione)}; ` +
      (colGuardiano ? "il guardiano installa le versioni che il centro chiede." : "senza guardiano il nodo si aggiorna a mano."),
  );
  console.log(`I progetti nuovi nascono in ${impostazioni.progetti}`);

  // La copia delle skill di Shinka in questo ambiente: il centro la tiene uguale alla sua.
  const cartellaSkill = join(dati, "skill");
  await preparaCartellaSkill(cartellaSkill);

  const browserDelPc = impostazioni.browserDelPc && (process.platform === "win32" || process.platform === "darwin");
  if (impostazioni.browserDelPc) {
    console.log(
      browserDelPc
        ? "Browser del PC acceso: i progetti possono usarlo con l'estensione Claude in Chrome, chiedendo ogni azione."
        : "Browser del PC non disponibile su questo sistema: resta spento.",
    );
  }

  let ultimoStato = "";
  let inAggiornamento = false;
  // I processi che il nodo accende: la pagina dell'ambiente li mostra per progetto, e ne termina uno bloccato.
  const processiDiShinka = new ProcessiDiShinka();
  // Su Windows il proprietario sceglie dalla pagina degli ambienti se il nodo parte a ogni accesso.
  const avvioConWindows = AvvioConWindows.diQuestaMacchina();
  const lavoro = new LavoroDelNodo({
    radiceProgetti: impostazioni.progetti,
    cartellaSkill,
    cartellaModifiche: join(dati, "modifiche"),
    // Gli accessi di Claude e Codex su questa macchina: li fa il proprietario dalla pagina Impostazioni.
    accessi: new AccessiDeiMotori({ dopoIlCambio: () => modelliDeiMotori.dimentica() }),
    // Le risorse di questa macchina: si leggono quando il proprietario guarda la pagina dell'ambiente.
    risorse: new CampionatoreRisorse({ radiceProgetti: impostazioni.progetti, etichettaDiShinka: ETICHETTA_STACK, processiDiShinka }),
    processiDiShinka,
    ...(avvioConWindows === undefined ? {} : { avvioConWindows }),
    // Le estensioni che il centro accende qui: i plugin stanno tra i dati del nodo, e nella
    // configurazione di Claude Code di questa macchina non si scrive nulla.
    estensioni: (chiavi, alCambio) =>
      new EstensioniInAmbiente({ cartella: join(dati, "estensioni"), radiceProgetti: impostazioni.progetti, chiavi, alCambio }),
    ...(browserDelPc ? { browserDelPc: true } : {}),
    riferisci: (messaggio) => collegamento.riferisci(messaggio),
    // Solo con il guardiano c'è chi scambia le cartelle e torna indietro se la versione nuova non parte.
    ...(colGuardiano
      ? {
          aggiorna: (comando) => {
            const { idRichiesta } = comando;
            if (inAggiornamento) {
              collegamento.riferisci({ tipo: "aggiornamento-non-riuscito", idRichiesta, motivo: "Un aggiornamento è già in corso su questo nodo." });
              return;
            }
            inAggiornamento = true;
            console.log(`Il centro chiede di passare alla versione ${inBreve(comando.versione)}: la preparo.`);
            void preparaAggiornamento({ installata, fileInstallazione, versione: comando.versione, file: comando.file }).then((esito) => {
              if (!esito.pronta) {
                inAggiornamento = false;
                console.error(`Aggiornamento non riuscito: ${esito.motivo}`);
                collegamento.riferisci({ tipo: "aggiornamento-non-riuscito", idRichiesta, motivo: esito.motivo });
                return;
              }
              console.log("Versione nuova pronta: mi spengo, e il guardiano mi riavvia con quella.");
              collegamento.riferisci({ tipo: "aggiornamento-pronto", idRichiesta });
              lavoro.spegni();
              // Il tempo che il messaggio parta e che i processi delle conversazioni lascino la cartella.
              setTimeout(() => {
                collegamento.ferma();
                process.exit(CODICE_RIAVVIO);
              }, 2_000);
            });
          },
        }
      : {}),
  });
  // Il lavoro offline (ADR 0056): i progetti di qui si riprendono dallo sportello quando il centro non c'è.
  const offline = await LavoroOffline.apri({
    cartella: join(dati, "offline"),
    nome: impostazioni.nome,
    radiceProgetti: impostazioni.progetti,
    cartellaSkill,
    apri: lavoro.apriPerOffline,
    riferisci: (messaggio) => collegamento.riferisci(messaggio),
  });
  lavoro.usaOffline(offline);
  const sportello = new Sportello({
    offline,
    dati,
    idAmbiente: identita.idNodo,
    nome: impostazioni.nome,
    sistema: sistemaDiQuestaMacchina(),
    radiceProgetti: impostazioni.progetti,
  });
  try {
    const { porta } = await sportello.apri();
    console.log(`Sportello per il lavoro offline su 127.0.0.1:${porta}.`);
  } catch (errore) {
    console.error(`Lo sportello per il lavoro offline non si è aperto: ${errore instanceof Error ? errore.message : String(errore)}`);
  }
  const collegamento: CollegamentoAlCentro = new CollegamentoAlCentro({
    centro: impostazioni.centro,
    nome: impostazioni.nome,
    descrizione: impostazioni.descrizione,
    radiceProgetti: impostazioni.progetti,
    identita,
    segreto: custodiaDelSegreto(fileIdentita, identita),
    ...(impostazioni.improntaDelCentro === undefined ? {} : { impronta: impostazioni.improntaDelCentro }),
    alImpronta: (impronta) => {
      impostazioni.improntaDelCentro = impronta;
      writeFileSync(fileImpostazioni, JSON.stringify(impostazioni, null, 2));
      console.log("Riconosciuto il certificato del centro: da qui il nodo parla solo con lui.");
    },
    alCifrato: (cifrato) => {
      if (!cifrato) console.log("Attenzione: il collegamento con il centro è in chiaro, perché il centro non ha risposto a quello cifrato.");
    },
    sistema: sistemaDiQuestaMacchina(),
    ...(versione === undefined ? {} : { versione }),
    ...(colGuardiano ? { siAggiorna: true } : {}),
    // Se l'ultima versione chiesta dal centro non è partita, il nodo lo dice finché il centro non lo ha sentito.
    aggiornamentoFallito: () => {
      const ultima = leggiInstallazione(fileInstallazione);
      if (ultima?.fase !== "tornata-indietro" || ultima.riferita === true) return undefined;
      return { versione: ultima.versione, motivo: ultima.motivo ?? "non è partita" };
    },
    alComando: (comando) => lavoro.esegui(comando),
    offline: () => offline.daConsegnare(),
    ...(avvioConWindows === undefined ? {} : { avvioConWindows: () => avvioConWindows.attivo() }),
    alCambio: (stato) => {
      // Senza il centro nessuno vedrebbe il lavoro: le conversazioni aperte si fermano.
      if (stato.stato === "scollegato" || stato.stato === "rifiutato" || stato.stato === "centro-non-riconosciuto" || stato.stato === "solo-cifrato") {
        lavoro.chiudiTutto();
        // Da qui i progetti di questo ambiente si riprendono dallo sportello.
        if (offline.eCollegato) offline.collegato(false);
      }
      // Accolto dal centro: il lavoro fatto offline si consegna.
      if (stato.stato === "attivo" && !offline.eCollegato) offline.collegato(true);
      // Durante i tentativi falliti lo stesso avviso si ripeterebbe a ogni giro.
      if (stato.stato === ultimoStato && stato.stato !== "in-attesa") return;
      ultimoStato = stato.stato;
      // Per chi guarda da questa macchina, come l'icona del nodo su Windows.
      void scriviStatoDelCollegamento(fileStatoDelCollegamento, stato).catch((errore: unknown) =>
        console.error(`Non è stato possibile scrivere lo stato del collegamento: ${errore instanceof Error ? errore.message : String(errore)}`),
      );
      switch (stato.stato) {
        case "collegamento":
          console.log("Mi collego al centro…");
          break;
        case "in-attesa":
          console.log(
            "Il centro non conosce ancora questo nodo. Apri Shinka, vai in Ambienti e approva la richiesta.",
          );
          console.log(`Codice di verifica: ${stato.codice}  (deve coincidere con quello mostrato in Shinka)`);
          break;
        case "attivo":
          console.log(`Collegato: l'ambiente "${stato.nome}" è attivo.`);
          void allAttivazione(versione);
          break;
        case "scollegato":
          console.log("Centro non raggiungibile: continuo a riprovare.");
          break;
        case "centro-non-riconosciuto":
          console.error(
            "Chi risponde all'indirizzo del centro non presenta il certificato che questo nodo ricorda: non gli parlo, e continuo a riprovare. " +
              "Se il centro è stato rifatto da capo, riavvia il nodo una volta con --dimentica-centro.",
          );
          break;
        case "solo-cifrato":
          console.error("Il centro accetta solo collegamenti cifrati, e questo nodo non è riuscito ad aprirne uno: continuo a riprovare.");
          break;
        case "rifiutato":
          console.error(`Il centro ha rifiutato questo nodo: ${stato.motivo}`);
          process.exitCode = CODICE_RIFIUTATO;
          break;
      }
    },
  });

  collegamento.avvia();
  const spegni = (): void => {
    void sportello.chiudi();
    lavoro.spegni();
    collegamento.ferma();
    process.exit(0);
  };
  process.on("SIGINT", spegni);
  process.on("SIGTERM", spegni);
} catch (errore) {
  console.error(errore instanceof Error ? errore.message : String(errore));
  process.exitCode = 1;
}

/**
 * Il centro ha accolto il nodo: il guardiano lo legge da qui per sapere che questa versione è
 * partita, e un aggiornamento non riuscito, ormai detto al centro, non va più ripetuto.
 */
async function allAttivazione(versione: string | undefined): Promise<void> {
  try {
    await writeFile(fileCollegato, `${JSON.stringify({ versione: versione ?? null, quando: new Date().toISOString() })}\n`);
    const ultima = leggiInstallazione(fileInstallazione);
    if (ultima?.fase === "tornata-indietro" && ultima.riferita !== true) {
      await scriviInstallazione(fileInstallazione, { ...ultima, riferita: true });
    }
  } catch (errore) {
    console.error(`Non è stato possibile scrivere lo stato del collegamento: ${errore instanceof Error ? errore.message : String(errore)}`);
  }
}

async function leggiImpostazioni(): Promise<Impostazioni> {
  const { values } = parseArgs({
    options: {
      centro: { type: "string" },
      nome: { type: "string" },
      descrizione: { type: "string" },
      progetti: { type: "string" },
      "browser-del-pc": { type: "string" },
      "dimentica-centro": { type: "boolean" },
    },
  });
  const salvate = await leggiSalvate();
  const centro = values.centro ?? salvate.centro;
  if (centro === undefined || centro.trim() === "") {
    throw new Error(
      'Manca l\'indirizzo del centro. Esempio: npm run nodo -- --centro http://192.168.1.20:7850 --nome "PC Windows"',
    );
  }
  const browser = values["browser-del-pc"]?.trim().toLowerCase();
  if (browser !== undefined && browser !== "si" && browser !== "sì" && browser !== "no") {
    throw new Error('--browser-del-pc vuole "si" oppure "no".');
  }
  return {
    browserDelPc: browser === undefined ? salvate.browserDelPc === true : browser !== "no",
    centro: centro.trim(),
    nome: (values.nome ?? salvate.nome ?? hostname()).trim(),
    descrizione: (values.descrizione ?? salvate.descrizione ?? "").trim(),
    progetti: resolve(values.progetti ?? salvate.progetti ?? join(homedir(), "Shinka", "Progetti")),
    ...(values["dimentica-centro"] === true || typeof salvate.improntaDelCentro !== "string" || salvate.improntaDelCentro === "" ? {} : { improntaDelCentro: salvate.improntaDelCentro }),
  };
}

async function leggiSalvate(): Promise<Partial<Impostazioni>> {
  try {
    return JSON.parse(await readFile(fileImpostazioni, "utf8")) as Partial<Impostazioni>;
  } catch {
    return {};
  }
}
