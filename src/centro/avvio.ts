/**
 * Avvia il centro di Shinka.
 *
 * Variabili d'ambiente:
 *   SHINKA_DATI            cartella dei dati (predefinita: ./dati)
 *   SHINKA_INDIRIZZO       indirizzo di ascolto (predefinito: 127.0.0.1)
 *   SHINKA_PORTA           porta di ascolto (predefinita: 7850)
 *   SHINKA_PORTA_ANTEPRIMA porta da cui il proprietario vede l'anteprima delle applicazioni dei
 *                          progetti (predefinita: 7852); "no" per non servirla
 *   SHINKA_COOKIE_SICURO   "1" se l'interfaccia è servita in HTTPS da un altro programma; con
 *                          l'HTTPS di Shinka il cookie è già sicuro per chi entra in HTTPS
 *   SHINKA_HTTPS           "1" per parlare HTTPS sulla stessa porta (e su quella dell'anteprima),
 *                          "0" per non farlo; se manca decide `https.json` tra i dati, che si
 *                          scrive dalla pagina Impostazioni. HTTP resta, per nodi, gateway e guardiano
 *   SHINKA_HTTPS_NOMI      gli indirizzi da cui il proprietario apre Shinka, separati da virgole,
 *                          per esempio 192.168.1.20: entrano nel certificato
 *   SHINKA_HTTPS_REINDIRIZZA "1" per mandare all'HTTPS chi apre l'interfaccia in HTTP
 *   SHINKA_HTTPS_CERTIFICATO e SHINKA_HTTPS_CHIAVE  un certificato proprio, in PEM, al posto di quello di Shinka
 *   SHINKA_AUTENTICAZIONE  "abbonamento" (predefinita) oppure "api-key"
 *   SHINKA_AMBIENTE_NOME         nome dell'ambiente del centro (predefinito: il nome della macchina);
 *                                quello scelto nella pagina Impostazioni vale sopra
 *   SHINKA_AMBIENTE_DESCRIZIONE  che cosa offre l'ambiente del centro, come sopra
 *   SHINKA_MOTORE          "claude" (predefinito) o "codex": il motore delle conversazioni nuove,
 *                          se nella pagina Impostazioni non se ne sceglie uno
 *   SHINKA_PROGETTI        cartella in cui nascono i progetti dell'ambiente del centro
 *                          (predefinita: ./progetti accanto ai dati); lì dentro, in `_home`,
 *                          stanno anche i file degli argomenti della Home
 *   SHINKA_GATEWAY         dove il centro raggiunge il gateway, per esempio http://192.168.1.20:7851
 *   SHINKA_GATEWAY_GETTONE il gettone con cui il centro si presenta al gateway
 *   SHINKA_GATEWAY_PAGINA  l'indirizzo della pagina del vault per il browser, se diverso
 *                          Le tre voci possono stare anche nel file `gateway.json` tra i dati,
 *                          come `indirizzo`, `gettone` e `pagina`.
 *   SHINKA_REPOSITORY      il repository di Shinka: se c'è, tra i progetti compare il progetto Shinka,
 *                          in cui Shinka sviluppa sé stessa
 *   SHINKA_ORIGINALE       per un fork della copia pubblica: l'indirizzo Git dell'originale, da cui
 *                          arrivano le versioni nuove, proposte con la scheda di uno sviluppo (ADR 0059)
 *   SHINKA_INSTALLATA      la cartella della versione in funzione (predefinita: quella da cui parte)
 *   SHINKA_RIPARTE_DA_SOLO "1" quando chi tiene acceso il centro lo riaccende se si spegne (Docker
 *                          con Compose): allora una scelta che vuole un riavvio lo fa da sé
 *   SHINKA_GUARDIANO       "1" quando il centro è tenuto acceso dal guardiano, che lo imposta da sé:
 *                          solo allora una versione approvata viene messa in funzione
 */

import { AggiornamentiDallOriginale } from "./originale.ts";
import { ProposteRicordate, postiDegliArchivi } from "./proposte-ricordate.ts";
import { colLavoroOffline } from "./lavoro-offline.ts";
import { ProcessiDiShinka } from "../nodo/processi-di-shinka.ts";
import { PrimoAvvio } from "./primo-avvio.ts";
import { existsSync } from "node:fs";
import { CODICE_RIAVVIO, FILE_INSTALLAZIONE } from "../guardiano/guardiano.ts";
import { applicaRipristino, CARTELLA_DELLE_COPIE } from "./copia-di-sicurezza.ts";
import { CopieDiSicurezza } from "./copie.ts";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fonteConfigurata } from "../harness/autenticazione.ts";
import { TramiteAnteprima } from "../nodo/anteprima.ts";
import { Applicazioni } from "../nodo/applicazioni.ts";
import { ApplicazioniDeiProgetti } from "./applicazioni.ts";
import { CartelleCollegate } from "./cartelle-collegate.ts";
import { AggiornamentiDesktop } from "./desktop.ts";
import { FileDeiProgetti } from "./file-progetto.ts";
import { FileDeiProgettiQui } from "../nodo/file-progetto.ts";
import { apriConversazione, impostaMotorePredefinito, motorePredefinito } from "../nodo/motore.ts";
import { AccessiDeiMotori } from "../nodo/accessi.ts";
import { modelliDeiMotori, modelliDellAmbiente } from "../nodo/sonde-motori.ts";
import { CatalogoDeiModelli } from "./catalogo-modelli.ts";
import { CredenzialiNegliAmbienti } from "./credenziali-negli-ambienti.ts";
import { LavoriNelBrowser } from "./lavori-nel-browser.ts";
import { AccessiNegliAmbienti } from "./accessi.ts";
import { ImpostazioniDellInstallazione } from "./impostazioni-installazione.ts";
import { EstensioniInAmbiente } from "../nodo/estensioni.ts";
import { sistemaDiQuestaMacchina } from "../nodo/sistema.ts";
import { Terminali } from "../nodo/terminali.ts";
import { PORTA_ANTEPRIMA } from "../protocollo/anteprima.ts";
import { Accesso } from "./accesso.ts";
import { GatewayAllaVersione } from "./aggiornamento-gateway.ts";
import { AggiornamentoDeiNodi } from "./aggiornamento-nodi.ts";
import { ID_AMBIENTE_DEL_CENTRO, RegistroAmbienti } from "./ambienti.ts";
import { Anteprime } from "./anteprima.ts";
import { Approvazioni } from "./approvazioni.ts";
import { LavoriProgrammati } from "./programmati.ts";
import { NotificheApp } from "./notifiche-app.ts";
import { RisorseDegliAmbienti } from "./risorse.ts";
import { RegistroAccessi } from "./registro-accessi.ts";
import { preparaIdentitaPerINodi, type IdentitaPerINodi } from "./identita-per-i-nodi.ts";
import { ETICHETTA_STACK } from "../protocollo/stack.ts";
import { CampionatoreRisorse } from "../nodo/risorse.ts";
import { RegistroArgomenti } from "./argomenti.ts";
import { creaCentro } from "./centro.ts";
import { distribuisciSkill } from "./distribuzione-skill.ts";
import { EsecutoreLocale, EsecutoriRemoti } from "./esecutori.ts";
import { Estensioni } from "./estensioni.ts";
import { EstensioniNegliAmbienti } from "./estensioni-negli-ambienti.ts";
import { apriGateway, GatewayAssente } from "./gateway.ts";
import { Home } from "./home.ts";
import type { Canale } from "./canale.ts";
import { ModelliInRete, unisciModelli } from "./modelli-in-rete.ts";
import { EstensioniInterfaccia } from "./interfaccia.ts";
import { eIncarico, progettoDellaConversazione } from "../protocollo/incarichi.ts";
import { CustodiaImmagini } from "./immagini.ts";
import {
  IMPOSTAZIONI_HOME,
  istruzioniHome,
  STRUMENTI_HOME,
  STRUMENTI_HOME_SENZA_RICHIESTA,
} from "./istruzioni-home.ts";
import { LavoriDeiProgetti } from "./lavori.ts";
import { Memoria } from "./memoria.ts";
import { creaServerAnteprima } from "./server-anteprima.ts";
import { RegistroSkill } from "./skill.ts";
import { RegistroStili } from "./stili.ts";
import { chiaveDellaHome, chiDiUnProgetto, StrumentiComuni } from "./strumenti-comuni.ts";
import { SviluppoDiShinka } from "./sviluppo.ts";
import { inBreve, versioneDi } from "./preparazione.ts";
import { RegistroProgetti } from "./progetti.ts";
import { Proposte } from "./proposte.ts";
import { StatoHome } from "./stato-home.ts";
import { PonteTelegram } from "./telegram.ts";
import { consensoDellaHome, creaStrumentiHome, GRUPPO_STRUMENTI_HOME } from "./strumenti-home.ts";
import { Elaborati } from "./elaborati.ts";
import { PosizioneDelProprietario } from "./posizione.ts";
import {
  certificatoProprio,
  leggiConfigurazioneHttps,
  nomiDelCertificato,
  preparaCertificati,
  type CertificatiPronti,
  type HttpsDelCentro,
} from "./https.ts";
import { serviziVeri } from "./mappa.ts";
import { TerminaliDeiProgetti } from "./terminali.ts";
import { ImmaginiEsterne } from "./immagini-esterne.ts";

const dati = resolve(process.env.SHINKA_DATI ?? "dati");
const indirizzo = process.env.SHINKA_INDIRIZZO ?? "127.0.0.1";
const porta = Number(process.env.SHINKA_PORTA ?? "7850");
const cookieSicuro = process.env.SHINKA_COOKIE_SICURO === "1";
const cartellaWeb = resolve(import.meta.dirname, "../../web/dist");
const radiceProgetti = resolve(process.env.SHINKA_PROGETTI ?? join(dirname(dati), "progetti"));
const repository = process.env.SHINKA_REPOSITORY?.trim() || undefined;
const installata = resolve(process.env.SHINKA_INSTALLATA ?? join(import.meta.dirname, "../.."));
const colGuardiano = process.env.SHINKA_GUARDIANO === "1";
const ripartaDaSolo = process.env.SHINKA_RIPARTE_DA_SOLO === "1";

if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  throw new Error(`SHINKA_PORTA non è una porta valida: ${process.env.SHINKA_PORTA}`);
}
const portaAnteprima = leggiPortaAnteprima(process.env.SHINKA_PORTA_ANTEPRIMA);

// Se il proprietario ha chiesto un ripristino, i dati della copia entrano adesso, prima che
// qualcuno apra quelli di prima: da qui in poi il centro parte come sempre, con quelli.
const ripristino = applicaRipristino(dati);
if (ripristino !== undefined) {
  console.log(
    ripristino.riuscito
      ? `Ripristino: i dati sono quelli della copia del ${ripristino.copia.quando}; quelli di prima sono da parte in ${join(dati, CARTELLA_DELLE_COPIE)}.`
      : `Ripristino non riuscito, i dati restano quelli di prima: ${ripristino.errore ?? "motivo sconosciuto"}`,
  );
}

const fonte = fonteConfigurata();
const statoHome = StatoHome.apri(join(dati, "home.json"), IMPOSTAZIONI_HOME);
const immagini = new CustodiaImmagini(join(dati, "immagini"));

const accesso = await Accesso.apri(dati);
// La versione in funzione: i nodi collegati con un'altra risultano indietro.
const versione = await versioneDi(installata);
const ambienti = await RegistroAmbienti.apri(join(dati, "ambienti.json"), {
  nome: process.env.SHINKA_AMBIENTE_NOME ?? hostname(),
  descrizione: process.env.SHINKA_AMBIENTE_DESCRIZIONE ?? "",
  sistema: sistemaDiQuestaMacchina(),
  radiceProgetti,
  ...(versione === undefined ? {} : { versione }),
});
const progetti = await RegistroProgetti.apri(join(dati, "progetti.json"));
// Le scelte della pagina Impostazioni valgono da subito, prima che si apra qualunque conversazione.
const impostazioniInstallazione = ImpostazioniDellInstallazione.apri(dati, (scelte) => {
  impostaMotorePredefinito(scelte.motore);
  ambienti.accettaSoloCifrati(scelte.soloNodiCifrati === true);
  ambienti.rinominaDelCentro({
    nome: scelte.ambiente?.nome ?? process.env.SHINKA_AMBIENTE_NOME ?? hostname(),
    descrizione: scelte.ambiente?.descrizione ?? process.env.SHINKA_AMBIENTE_DESCRIZIONE ?? "",
  });
});
// Gli accessi di Claude e Codex: quelli di questa macchina li fa il centro, gli altri i nodi.
const accessiDelCentro = new AccessiDeiMotori({ dopoIlCambio: () => modelliDeiMotori.dimentica() });
const accessi = new AccessiNegliAmbienti(ambienti, accessiDelCentro);

// Memoria e skill stanno al centro e valgono in ogni ambiente: ogni conversazione, della Home
// o di un progetto, le usa attraverso gli stessi strumenti, che si eseguono qui.
const memoria = await Memoria.apri(join(dati, "memoria.md"));
const skill = await RegistroSkill.apri(join(dati, "skill"));
// Gli stili di risposta che il proprietario ha aggiunto: valgono in ogni conversazione.
const stili = await RegistroStili.apri(join(dati, "stili.json"));
// Le credenziali stanno nel gateway, un processo a parte: il centro gli chiede di usarle per nome.
const gateway = apriGateway(dati);

// Il terminale e l'anteprima di un progetto agiscono nel suo ambiente: qui per i progetti del
// centro, attraverso il nodo per gli altri.
const terminaliDelCentro: Terminali[] = [];
const terminali = new TerminaliDeiProgetti({
  progetti,
  ambienti,
  locale: (riferisci) => {
    const qui = new Terminali(riferisci);
    terminaliDelCentro.push(qui);
    return qui;
  },
});
const anteprime = new Anteprime({
  progetti,
  ambienti,
  locale: (riferisci) => new TramiteAnteprima(riferisci),
  porta: portaAnteprima,
  porteRiservate: [porta, ...(portaAnteprima === null ? [] : [portaAnteprima])],
  // Dopo un riavvio il proprietario ritrova aperta l'anteprima che guardava.
  file: join(dati, "anteprima.json"),
});

// Le applicazioni dei progetti: le avvia e le ferma il pulsante dell'anteprima, il ripristino
// dopo un riavvio e gli strumenti degli agenti. Quelle dell'ambiente del centro vivono qui.
const applicazioniDelCentro: Applicazioni[] = [];
const applicazioni = new ApplicazioniDeiProgetti({
  progetti,
  ambienti,
  locale: (riferisci) => {
    const qui = new Applicazioni(riferisci);
    applicazioniDelCentro.push(qui);
    return qui;
  },
  apriAnteprima: (idProgetto, portaApplicazione, percorso) => anteprime.apri(idProgetto, portaApplicazione, percorso),
  chiudiAnteprima: (idProgetto) => void anteprime.chiudi(idProgetto),
});

// I file dei progetti, per il pannello File: quelli dell'ambiente del centro si leggono qui.
const file = new FileDeiProgetti({ progetti, ambienti, locale: (riferisci) => new FileDeiProgettiQui(riferisci) });

// Un comando su un host per gli stack di prova aspetta l'approvazione del proprietario: la
// scheda compare nella conversazione che lo ha chiesto, della Home o di un progetto.
const PREFISSO_HOME = chiaveDellaHome("");
const approvazioni = new Approvazioni({
  gateway,
  pubblica: (chiave) => {
    if (!chiave.startsWith(PREFISSO_HOME)) return lavori.canale(chiave)?.pubblica;
    // Un argomento archiviato non ha nessuno davanti: lì non si chiede.
    return home !== undefined && chiave === chiaveDellaHome(home.idArgomentoAperto) ? home.canale.pubblica : undefined;
  },
});

// Lo sviluppo di Shinka nasce dopo i progetti, e gli strumenti lo chiedono nel momento in cui serve.
let sviluppo: SviluppoDiShinka | undefined;

// Il registro degli accessi: chi entra, da dove, e ciò che arriva senza una sessione.
const registroAccessi = new RegistroAccessi({ file: join(dati, "accessi.jsonl") });

// Le risorse degli ambienti, per la loro pagina: quelle di questa macchina le legge il centro, le
// altre i nodi; i container degli host per gli stack li legge il gateway.
// I processi che il centro accende nel suo ambiente (conversazioni, comandi, terminali, applicazioni).
// I server dei modelli locali sono di tutto l'ambiente: la pagina dei processi li mostra nei progetti che li usano.
const processiDelCentro = new ProcessiDiShinka({ usi: () => estensioniDelCentro.modelliLocali.usi() });
const risorse = new RisorseDegliAmbienti({
  ambienti,
  locale: new CampionatoreRisorse({ radiceProgetti, etichettaDiShinka: ETICHETTA_STACK, processiDiShinka: processiDelCentro }),
  processiLocali: processiDelCentro,
  ...(gateway instanceof GatewayAssente ? {} : { contenitori: () => gateway.contenitori() }),
});

// Le notifiche dell'app: gli stessi avvisi di Telegram, sui dispositivi che il proprietario ha iscritto.
const notifiche = new NotificheApp({ file: join(dati, "notifiche.json") });
const avvisaLApp = (avviso: { titolo: string; corpo: string; conversazione: string; urgente: boolean }): void => {
  if (!notifiche.attive) return;
  // Il numero sull'icona: quante conversazioni aspettano il proprietario.
  const aspettano = lavori.stato().progetti.filter((progetto) => progetto.condizione === "aspetta-te").length + (laHome().condizioneComplessiva === "aspetta-te" ? 1 : 0);
  void notifiche.manda({
    titolo: avviso.titolo,
    corpo: avviso.corpo,
    vai: avviso.conversazione === "home" ? "/" : `/progetti/${encodeURIComponent(avviso.conversazione)}`,
    urgente: avviso.urgente,
    ...(aspettano > 0 ? { distintivo: aspettano } : {}),
  });
};

// I lavori programmati: richieste del proprietario che partono da sole, nella Home o in un
// progetto. Home, progetti e Telegram nascono dopo: li si chiede nel momento in cui servono.
const programmati = new LavoriProgrammati({
  file: join(dati, "programmati.json"),
  home: () => laHome(),
  progetti: {
    progetto: (id) => lavori.progetto(id),
    canale: (id) => lavori.canale(id),
    invia: (id, testo) => lavori.invia(id, testo),
    ascolta: (ascoltatore) => lavori.ascolta(ascoltatore),
  },
  conferma: (chiave, scheda) => approvazioni.chiediProgrammato(chiave, scheda),
  allaFine: ({ lavoro, testo, errore }) =>
    ponteTelegram?.annunciaProgrammato({
      titolo: lavoro.titolo,
      conversazione: lavoro.dove.tipo === "home" ? "home" : lavoro.dove.id,
      dove: lavoro.dove.tipo === "home" ? "Home" : (lavoro.nomeProgetto ?? "progetto"),
      testo,
      ...(errore === undefined ? {} : { errore }),
    }),
});

// Le credenziali per SSH che il proprietario dà a un ambiente (ADR 0062): il centro le passa ai nodi,
// sigillate dal gateway, senza poterle leggere.
const credenzialiNegliAmbienti = new CredenzialiNegliAmbienti({ ambienti, gateway });
credenzialiNegliAmbienti.avvia();

const comuni = new StrumentiComuni(
  memoria,
  skill,
  gateway,
  (idProgetto, portaProposta, percorso) => anteprime.proponi(idProgetto, portaProposta, percorso),
  approvazioni,
  async (idProgetto, riassunto) =>
    sviluppo === undefined
      ? { testo: "In questa installazione di Shinka lo sviluppo di Shinka non è acceso.", errore: true }
      : sviluppo.chiediInstallazione(idProgetto, riassunto),
  async (idProgetto, riassunto) =>
    sviluppo === undefined
      ? { testo: "In questa installazione di Shinka lo sviluppo di Shinka non è acceso.", errore: true }
      : sviluppo.aggiornaGateway(idProgetto, riassunto),
  portaAnteprima === null ? undefined : (chiave, nome, argomenti) => applicazioni.strumento(chiave, nome, argomenti),
  (chi, nome, argomenti) => programmati.strumento(chi, nome, argomenti),
  (chiave, nome, argomenti) => collegate.strumento(chiave, nome, argomenti),
  (idProgetto, argomenti) => lavori.affidaIncarico(idProgetto, argomenti),
  credenzialiNegliAmbienti,
);
// Gli strumenti della conversazione di un incarico valgono per il suo progetto (ADR 0051).
const strumentoDiProgetto = (idConversazione: string, nome: unknown, argomenti: unknown) =>
  comuni.esegui(chiDiUnProgetto(idConversazione, (id) => progetti.trova(id)?.nome), nome, argomenti);

// Le estensioni: l'elenco sta al centro, e ogni ambiente riceve quelle accese lì. Quelle
// dell'ambiente del centro le usano i suoi progetti e la Home. Le chiavi che un'estensione
// dichiara escono dal vault nel momento in cui parte, e passano di qui senza fermarsi.
let estensioni: Estensioni | undefined;
const elencoEstensioni = (): Estensioni => {
  if (estensioni === undefined) throw new Error("Le estensioni non sono ancora pronte.");
  return estensioni;
};
const estensioniDelCentro = new EstensioniInAmbiente({
  cartella: join(dati, "estensioni"),
  radiceProgetti,
  chiavi: (nome) => estensioniNegliAmbienti.chiavi(nome, ID_AMBIENTE_DEL_CENTRO),
  alCambio: () => {
    home?.ricaricaEstensioni();
    lavori.ricaricaEstensioni();
  },
});
const estensioniNegliAmbienti = new EstensioniNegliAmbienti({
  ambienti,
  locale: estensioniDelCentro,
  estensioni: elencoEstensioni,
  chiavi: (nome, idAmbiente, nomi) =>
    gateway.chiaviEstensione({
      estensione: nome,
      ambiente: ambienti.stato().ambienti.find((uno) => uno.id === idAmbiente)?.nome ?? idAmbiente,
      chiavi: nomi,
    }),
});

// I modelli locali in rete degli altri ambienti (ADR 0053): li usano anche la Home e i progetti di qui.
const modelliInRete = new ModelliInRete({ modelli: () => estensioni?.modelliInRete() ?? [], ambienti });
const modelliDelCentro = unisciModelli(estensioniDelCentro.modelliLocali, modelliInRete);
// I modelli tra cui scegliere per un progetto nuovo, ambiente per ambiente: qui quelli dei motori di
// questo processo, che le conversazioni di qui condividono, con i locali e quelli in rete.
const catalogoModelli = new CatalogoDeiModelli({ ambienti, delCentro: () => modelliDellAmbiente(modelliDeiMotori, modelliDelCentro) });

const locale = new EsecutoreLocale(radiceProgetti, undefined, {
  strumento: strumentoDiProgetto,
  cartellaSkill: skill.cartella,
  // Le chat parallele del progetto Shinka sono del progetto Shinka; gli incarichi no.
  diShinka: (idConversazione) => !eIncarico(idConversazione) && progetti.trova(progettoDellaConversazione(idConversazione))?.diShinka === true,
  estensioni: estensioniDelCentro,
  modelliLocali: modelliDelCentro,
  cartellaModifiche: join(dati, "modifiche"),
});
const remoti = new EsecutoriRemoti(ambienti, undefined, undefined, strumentoDiProgetto);
const lavori = await LavoriDeiProgetti.apri({
  progetti,
  ambienti,
  cartellaConversazioni: join(dati, "conversazioni", "progetti"),
  cartellaModifiche: join(dati, "modifiche"),
  immagini,
  locale,
  remoti,
  registroIncarichi: join(dati, "incarichi.jsonl"),
  // Prima del messaggio il progetto riceve la memoria e, se è il progetto Shinka, com'è finita un'installazione.
  notaPrimaDelMessaggio: (idProgetto) => {
    const note = [sviluppo?.notaPerIlProgetto(idProgetto), memoria.daConsegnare(idProgetto)].filter((nota) => nota !== undefined);
    return note.length === 0 ? undefined : note.join("\n\n");
  },
});
// Le cartelle che il proprietario collega a un progetto in altri ambienti (ADR 0050).
const collegate = new CartelleCollegate({
  progetti,
  ambienti,
  esecutore: (idAmbiente) => lavori.esecutore(idAmbiente),
  annota: (idProgetto, testo) => lavori.annota(idProgetto, testo),
});

// Un nodo tenuto acceso dal suo guardiano passa alla versione del centro quando il centro glielo
// chiede: dopo un'installazione approvata, o dalla pagina degli ambienti. Non mentre lì si lavora.
const aggiornamenti = new AggiornamentoDeiNodi({
  ambienti,
  installata,
  versione,
  occupato: (idAmbiente) =>
    lavori
      .stato()
      .progetti.some((progetto) => progetto.idAmbiente === idAmbiente && (progetto.condizione === "al-lavoro" || progetto.condizione === "aspetta-te")),
});

// La conversazione della Home nata prima degli argomenti diventa il primo argomento, dov'era.
const archivioDiPrima = join(dati, "conversazioni", "home.jsonl");
const argomenti = await RegistroArgomenti.apri(
  join(dati, "argomenti.json"),
  existsSync(archivioDiPrima)
    ? {
        archivio: archivioDiPrima,
        cartella: join(dati, "home"),
        ...(statoHome.idSessioneEreditata === undefined ? {} : { idSessione: statoHome.idSessioneEreditata }),
      }
    : undefined,
);

// La Home, le proposte e gli strumenti si conoscono a vicenda: la Home nasce per ultima,
// e gli altri la chiedono nel momento in cui serve.
let home: Home | undefined;
const laHome = (): Home => {
  if (home === undefined) throw new Error("La Home non è ancora pronta.");
  return home;
};
// Una nota alla chat della Home che ha l'archivio indicato, o alla principale (ADR 0052).
const annotaLaHome = (testo: string, canale?: Canale): void => {
  if (home === undefined) return;
  const chat = canale === undefined ? undefined : [home, ...home.condizioniDelleChat().map(({ numero }) => home?.chat(numero))].find((una) => una?.canale === canale);
  (chat ?? home).annota(testo);
};
// Le proposte che aspettano il proprietario restano scritte: un riavvio non le perde.
const ricordate = ProposteRicordate.apri(join(dati, "proposte-in-attesa.json"));
// La versione in funzione si propone anche al gateway: il sì, però, lo chiede lui al proprietario.
const gatewayAllaVersione = new GatewayAllaVersione({ gateway, installata, riferisci: (testo) => sviluppo?.annota(testo) });
// Il progetto Shinka: la sua cartella è una copia di lavoro del repository di Shinka.
if (repository !== undefined) {
  sviluppo = await SviluppoDiShinka.apri({
    repository,
    radiceProgetti,
    installata,
    fileInstallazione: join(dati, FILE_INSTALLAZIONE),
    guardiano: colGuardiano,
    lavori,
    canaleHome: () => laHome().canale,
    annotaHome: annotaLaHome,
    riavvia: () => void spegni(CODICE_RIAVVIO),
    nodi: () => aggiornamenti.daAggiornare(),
    propaga: (idNodi) => aggiornamenti.propaga(idNodi),
    ricordate,
    ...(gateway instanceof GatewayAssente ? {} : { gateway: gatewayAllaVersione }),
  });
}
const proposte = new Proposte({
  canaleHome: () => laHome().canale,
  annotaHome: annotaLaHome,
  argomentoAperto: () => ({ idArgomento: laHome().idArgomentoAperto, cartellaAlCentro: laHome().cartellaAperta }),
  lavori,
  ambienti,
  // Le estensioni si aprono subito dopo: la scheda le chiede quando la Home propone un progetto.
  estensioniPerProgetto: () => estensioni?.perProgetto() ?? {},
  ricordate,
});
estensioni = await Estensioni.apri({
  file: join(dati, "estensioni.json"),
  ambienti: () => ambienti.stato().ambienti,
  inAmbiente: (idAmbiente) => estensioniNegliAmbienti.per(idAmbiente),
  canaleHome: () => laHome().canale,
  annotaHome: annotaLaHome,
  ricordate,
});
// Le estensioni dell'interfaccia (ADR 0054): le propone la Home, le conferma il proprietario.
const interfaccia = await EstensioniInterfaccia.apri({ file: join(dati, "interfaccia.json"), annota: annotaLaHome, ricordate });
const agisciInAmbiente = (idAmbiente: string, idArgomento: string, azione: Parameters<typeof locale.agisci>[1]) =>
  (idAmbiente === ID_AMBIENTE_DEL_CENTRO ? locale : remoti.per(idAmbiente)).agisci(idArgomento, azione);
const elaborati = new Elaborati({
  ambienti: () => ambienti.stato().ambienti,
  storia: async (idArgomento) => (await laHome().canaleDi(idArgomento))?.archiviati,
  cartellaAlCentro: (idArgomento) => laHome().cartellaDellArgomento(idArgomento),
  argomenti: () => [
    { id: argomenti.aperto.id },
    ...argomenti.chatParallele().map((chat) => ({ id: chat.idAperto })),
    ...argomenti.archiviati().map((voce) => ({ id: voce.id, titolo: voce.titolo })),
  ],
  agisci: agisciInAmbiente,
});
// Il ponte con Telegram nasce dopo la Home; i suoi strumenti lo chiedono quando servono.
let ponteTelegram: PonteTelegram | undefined;
// La posizione del proprietario resta qui, finché il centro è acceso: non va su disco.
const posizione = new PosizioneDelProprietario();
// I lavori della Home nel Chrome dei PC (ADR 0063): una conversazione a parte sul nodo, con Claude in Chrome.
const lavoriNelBrowser = new LavoriNelBrowser({ ambienti, esecutore: (idAmbiente) => lavori.esecutore(idAmbiente) });
const opzioniStrumenti = {
  ambienti,
  elaborati,
  lavoriNelBrowser,
  posizione,
  mappe: serviziVeri(),
  cartellaDellArgomento: (idArgomento: string) => laHome().cartellaDellArgomento(idArgomento),
  telegram: () => ponteTelegram,
  lavori,
  proposte,
  estensioni,
  interfaccia,
  home: laHome,
  comuni: (nome: Parameters<typeof comuni.esegui>[1], argomenti: unknown) =>
    comuni.esegui({ chiave: chiaveDellaHome(laHome().idArgomentoAperto), origine: "Home" }, nome, argomenti),
  agisci: agisciInAmbiente,
  ...(sviluppo === undefined ? {} : { sviluppo }),
};
// Gli strumenti di una chat della Home: lavorano con la sua Home, e la principale se quella non c'è più.
const strumentiDellaChat = (numero: number): typeof opzioniStrumenti => {
  const casa = (): Home => laHome().chat(numero) ?? laHome();
  return {
    ...opzioniStrumenti,
    home: casa,
    comuni: (nome: Parameters<typeof comuni.esegui>[1], argomenti: unknown) =>
      comuni.esegui({ chiave: chiaveDellaHome(casa().idArgomentoAperto), origine: "Home" }, nome, argomenti),
  };
};
const conSviluppo = sviluppo !== undefined;
home = await Home.apri({
  argomenti,
  immagini,
  cartellaArchivi: join(dati, "conversazioni", "argomenti"),
  radiceProgetti,
  impostazioni: () => statoHome.impostazioni,
  notaPrimaDelMessaggio: (idArgomento) => memoria.daConsegnare(chiaveDellaHome(idArgomento)),
  // Le azioni nel Chrome di un PC chieste per la Home si decidono nella sua chat (ADR 0063).
  decidiAltrove: (idPermesso, decisione) => lavoriNelBrowser.decidiPermesso(idPermesso, decisione),
  apri: (apertura) =>
    apriConversazione({
      cartella: apertura.cartella,
      impostazioni: statoHome.impostazioni,
      istruzioni: () => istruzioniHome(new Date(), { sviluppo: conSviluppo }),
      strumenti: STRUMENTI_HOME,
      strumentiSenzaRichiesta: STRUMENTI_HOME_SENZA_RICHIESTA,
      consenteDaSe: consensoDellaHome(ambienti),
      // Ogni argomento ha la sua conversazione, e ogni motore della conversazione i suoi strumenti:
      // quelli di una chat parallela agiscono nel suo argomento (ADR 0052).
      strumentiNostri: () => ({ [GRUPPO_STRUMENTI_HOME]: creaStrumentiHome(strumentiDellaChat(apertura.numero)) }),
      cartellaSkill: skill.cartella,
      estensioni: estensioniDelCentro,
      // La Home può lavorare con un modello locale di qui o in rete in un altro ambiente.
      modelliLocali: modelliDelCentro,
      ...(apertura.idSessione === undefined ? {} : { idSessione: apertura.idSessione }),
      alEvento: apertura.alEvento,
      alIdSessione: apertura.alIdSessione,
    }),
});

// Un fork della copia pubblica guarda ogni tanto se l'originale ha versioni nuove, e le propone (ADR 0059).
const indirizzoOriginale = process.env.SHINKA_ORIGINALE?.trim() || undefined;
const conLoSviluppo = sviluppo;
const originale =
  indirizzoOriginale === undefined || repository === undefined || conLoSviluppo === undefined
    ? undefined
    : new AggiornamentiDallOriginale({ repository, originale: indirizzoOriginale, file: join(dati, "originale.json"), proponi: (proposta) => void conLoSviluppo.proponi(proposta) });
originale?.avvia();

// Le proposte che aspettavano il proprietario prima del riavvio tornano, con i loro pulsanti.
ricordate.collega(postiDegliArchivi(laHome, lavori));
await proposte.ripristina();
await sviluppo?.ripristina();
await estensioni.ripristina();
await interfaccia.ripristina();

// Le skill arrivano a ogni nodo quando si collega e a ogni cambiamento; le conversazioni
// già aperte in questo ambiente le rileggono.
distribuisciSkill(skill, ambienti, () => {
  home?.ricaricaSkill();
  lavori.ricaricaSkill();
});

// Il lavoro offline (ADR 0056): ogni nodo riceve i progetti del suo ambiente e la memoria, e al
// ritorno consegna ciò che è stato fatto senza centro.
colLavoroOffline({ ambienti, lavori, progetti, memoria, strumento: strumentoDiProgetto, motorePredefinito });

// Le estensioni accese arrivano a ogni nodo quando si collega e a ogni cambiamento; qui si
// aspetta che i plugin dell'ambiente del centro siano al loro posto.
await estensioniNegliAmbienti.avvia();

// L'HTTPS: se è scelto, la stessa porta parla anche HTTPS. Se i certificati non si preparano,
// Shinka parte lo stesso in HTTP e lo dice: un HTTPS che non va non deve lasciarla spenta.
const configurazioneHttps = leggiConfigurazioneHttps(dati);
let certificatiHttps: CertificatiPronti | undefined;
let problemaHttps: string | undefined;
if (configurazioneHttps.attivo) {
  try {
    certificatiHttps =
      configurazioneHttps.proprio === undefined
        ? preparaCertificati(join(dati, "https"), nomiDelCertificato(configurazioneHttps.nomi))
        : certificatoProprio(configurazioneHttps.proprio);
    for (const avviso of certificatiHttps.avvisi) console.log(`HTTPS: ${avviso}`);
  } catch (errore) {
    problemaHttps = errore instanceof Error ? errore.message : String(errore);
    console.error(`HTTPS non partito, Shinka resta in HTTP: ${problemaHttps}`);
  }
}
const https: HttpsDelCentro = {
  dati,
  configurazione: configurazioneHttps,
  scelta: { attivo: configurazioneHttps.attivo, nomi: configurazioneHttps.nomi, reindirizza: configurazioneHttps.reindirizza },
  decisoDaVariabile: process.env.SHINKA_HTTPS === "1" || process.env.SHINKA_HTTPS === "0",
  ...(certificatiHttps === undefined ? {} : { certificati: certificatiHttps }),
  ...(problemaHttps === undefined ? {} : { problema: problemaHttps }),
  porta,
  // A riaccendere il centro è il guardiano, oppure Docker in un'installazione con Compose.
  ...(colGuardiano || ripartaDaSolo ? { riavvia: () => void spegni(CODICE_RIAVVIO) } : {}),
};

// Il certificato dei nodi: c'è sempre, anche senza HTTPS. Se non si prepara, i nodi restano in
// chiaro come prima e lo si dice: un problema qui non deve lasciare il centro spento.
let perINodi: IdentitaPerINodi | undefined;
try {
  perINodi = preparaIdentitaPerINodi(join(dati, "collegamento-nodi"), new Date(), (avviso) => console.log(`Collegamento dei nodi: ${avviso}`));
} catch (errore) {
  console.error(`Il certificato dei nodi non si è preparato, i nodi si collegano in chiaro: ${errore instanceof Error ? errore.message : String(errore)}`);
}

const { primoAvvio, codice: codicePrimoAvvio } = PrimoAvvio.apri(dati, accesso);
// Le copie di sicurezza dei dati: prepararle, caricarle, e chiedere un ripristino, che vale al prossimo avvio.
const copie = new CopieDiSicurezza({
  dati,
  memoria,
  skill,
  ...(versione === undefined ? {} : { versione }),
  // La risposta al proprietario parte prima che il centro si spenga.
  ...(colGuardiano || ripartaDaSolo ? { riavvia: () => void setTimeout(() => void spegni(CODICE_RIAVVIO), 1_500) } : {}),
});
await copie.riordina().catch((errore: unknown) => console.error("La cartella delle copie di sicurezza non è stata riordinata:", errore));

// Le immagini scritte nelle risposte: le stesse, già scaricate, per l'interfaccia e per Telegram.
const immaginiEsterne = new ImmaginiEsterne();
// Gli aggiornamenti di Shinka Desktop: l'ultima versione pubblicata dalle Impostazioni (ADR 0049).
const desktop = new AggiornamentiDesktop(join(dati, "desktop"));

const centro = await creaCentro({
  desktop,
  collegate,
  accesso,
  primoAvvio,
  installata,
  home,
  memoria,
  skill,
  stili,
  impostazioni: impostazioniInstallazione,
  accessi,
  gateway,
  approvazioni,
  argomenti,
  ambienti,
  lavori,
  proposte,
  estensioni,
  interfaccia,
  catalogoModelli,
  ...(originale === undefined ? {} : { originale }),
  elaborati,
  posizione,
  https,
  copie,
  aggiornamenti,
  programmati,
  notifiche,
  risorse,
  registroAccessi,
  ...(perINodi === undefined ? {} : { perINodi }),
  ...(sviluppo === undefined ? {} : { sviluppo }),
  terminali,
  anteprime,
  ...(portaAnteprima === null ? {} : { applicazioni }),
  file,
  cartellaWeb,
  statoHome,
  immagini,
  immaginiEsterne,
  cookieSicuro,
});
await centro.listen({ host: indirizzo, port: porta });

// Telegram: il bot lo tiene il gateway. Da qui passano i messaggi per la Home, gli avvisi e le
// richieste da approvare. Senza gateway non c'è nemmeno il bot.
ponteTelegram = gateway instanceof GatewayAssente ? undefined : new PonteTelegram({ gateway, elaborati, immaginiEsterne, posizione, home: laHome(), lavori, approvazioni, programmati, avvisa: avvisaLApp, vuole: (canale, genere) => notifiche.vuole(canale, genere), estensioni, ...(sviluppo === undefined ? {} : { sviluppo }) });
const telegram = ponteTelegram;
telegram?.avvia();
// Da qui i lavori programmati guardano l'ora: la Home, i progetti e Telegram ci sono.
programmati.avvia();

// L'anteprima sta su una porta sua: per il browser è un'altra origine, e ciò che gira
// nell'applicazione del progetto non arriva all'interfaccia di Shinka.
const serverAnteprima =
  portaAnteprima === null
    ? undefined
    : await creaServerAnteprima({
        accesso,
        anteprime,
        ...(https.certificati === undefined ? {} : { tls: { chiave: https.certificati.chiave, catena: https.certificati.catena } }),
      });
await serverAnteprima?.listen({ host: indirizzo, port: portaAnteprima ?? 0 });
// Le applicazioni che il proprietario voleva accese ripartono: quelle del centro adesso, quelle
// degli altri ambienti quando il loro nodo si ricollega.
if (portaAnteprima !== null) void applicazioni.ripristina(ID_AMBIENTE_DEL_CENTRO);

console.log(`Centro di Shinka in ascolto su http://${indirizzo}:${porta}`);
if (certificatiHttps !== undefined) {
  console.log(`HTTPS sulla stessa porta, per ${certificatiHttps.nomi.join(", ")}; certificato fino al ${certificatiHttps.server.scadeIl.slice(0, 10)}.`);
}
console.log(`Dati in ${dati}; fonte di autenticazione dell'harness: ${fonte}`);
console.log(`I progetti di questo ambiente nascono in ${radiceProgetti}`);
console.log(
  portaAnteprima === null
    ? "Anteprima spenta: SHINKA_PORTA_ANTEPRIMA dice di non servirla."
    : `Anteprima delle applicazioni dei progetti su http://${indirizzo}:${portaAnteprima}`,
);
console.log(`Memoria in ${join(dati, "memoria.md")}; skill, con la loro storia, in ${skill.cartella}`);
console.log(
  gateway instanceof GatewayAssente
    ? "Gateway non configurato: il vault non c'è, e Claude non ha credenziali da usare."
    : "Gateway configurato: le credenziali del vault si usano attraverso di lui.",
);
if (codicePrimoAvvio !== undefined) {
  console.log(`Password del proprietario non ancora impostata. Codice di primo avvio: ${codicePrimoAvvio}`);
  console.log("Aprendo Shinka nel browser, la pagina chiede questo codice e la password nuova (oppure: npm run imposta:password).");
}
console.log(
  sviluppo === undefined
    ? repository === undefined
      ? "Sviluppo di Shinka spento: SHINKA_REPOSITORY non dice dov'è il repository."
      : "Sviluppo di Shinka non disponibile: il progetto Shinka non si è potuto aprire."
    : `Sviluppo di Shinka acceso: repository ${repository}, versione in funzione ${versione === undefined ? "non registrata" : inBreve(versione)}; ` +
        (colGuardiano
          ? "il guardiano installa le versioni approvate."
          : "senza guardiano le versioni si provano ma non si installano da qui."),
);
// Dopo un'installazione il centro dice com'è finita, nella conversazione del progetto Shinka.
void sviluppo?.riferisci().catch((errore: unknown) => console.error("L'esito dell'installazione non è stato riferito:", errore));

let spegnimento = false;
async function spegni(codice = 0): Promise<void> {
  if (spegnimento) return;
  spegnimento = true;
  sviluppo?.chiudi();
  registroAccessi.chiudi();
  programmati.chiudi();
  aggiornamenti.chiudi();
  gatewayAllaVersione.chiudi();
  telegram?.chiudi();
  laHome().chiudi();
  lavori.chiudi();
  estensioniDelCentro.modelliLocali.chiudi();
  credenzialiNegliAmbienti.chiudi();
  gateway.chiudi();
  // I terminali dell'ambiente del centro vivono in questo processo: si spengono con lui.
  for (const qui of terminaliDelCentro) qui.spegniTutti();
  // Così le applicazioni: al prossimo avvio ripartono quelle volute.
  for (const qui of applicazioniDelCentro) qui.spegniTutte();
  await serverAnteprima?.close();
  await centro.close();
  process.exit(codice);
}

/** La porta dell'anteprima: quella predefinita, quella indicata, oppure nessuna. */
function leggiPortaAnteprima(scritto: string | undefined): number | null {
  const valore = scritto?.trim().toLowerCase();
  if (valore === undefined || valore === "") return controllata(PORTA_ANTEPRIMA);
  if (valore === "no" || valore === "0") return null;
  return controllata(Number(valore));

  function controllata(numero: number): number {
    if (!Number.isInteger(numero) || numero < 1 || numero > 65535 || numero === porta) {
      throw new Error(`SHINKA_PORTA_ANTEPRIMA non è una porta valida, o è la stessa di Shinka: ${scritto}`);
    }
    return numero;
  }
}
process.on("SIGINT", () => void spegni());
process.on("SIGTERM", () => void spegni());
