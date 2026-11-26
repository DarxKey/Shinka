/**
 * Ciò che nelle risposte di Claude non è solo testo: i blocchi di codice, con il colore della
 * sintassi, il nome del linguaggio e il pulsante Copia, i diagrammi Mermaid e i riquadri di cifre,
 * disegnati come riquadri (ADR 0066). Le librerie che
 * servono si caricano la prima volta che servono: aprire una chat senza codice non le scarica.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { useAspetto } from "./aspetto.ts";
import { copia } from "./copia.ts";
import { comandoDaEseguire, eUnComando, mandaAlTerminale } from "./comandi-eseguibili.ts";
import { useBaseDellaChat, useSolaLettura } from "./ContestoChat.ts";
import { apriSchedaDelPannello } from "./apri-pannello.ts";
import { useQuadroCorrente } from "./Quadro.tsx";
import { progettoDellaConversazione } from "../../src/protocollo/incarichi.ts";
import { leggiRiquadro, LINGUAGGIO_RIQUADRO } from "../../src/protocollo/disegni.ts";

/** L'icona del pulsante Copia: due fogli; dopo, un segno di spunta o una croce. */
function IconaCopia({ fatto }: { fatto: "copiato" | "non-riuscito" | undefined }): ReactNode {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {fatto === "copiato" ? (
        <path d="M4.5 10.5l3.5 3.5 7.5-8" />
      ) : fatto === "non-riuscito" ? (
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
      ) : (
        <>
          <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
          <path d="M13 4.5V4.25A1.75 1.75 0 0 0 11.25 2.5h-6.5A1.75 1.75 0 0 0 3 4.25v6.5c0 .97.78 1.75 1.75 1.75H5" />
        </>
      )}
    </svg>
  );
}

/** Il pulsante Copia, con l'icona: per un blocco di codice o per una risposta intera. */
export function PulsanteCopia({ testo, etichetta = "Copia" }: { testo: string; etichetta?: string }): ReactNode {
  const [fatto, setFatto] = useState<"copiato" | "non-riuscito">();
  useEffect(() => {
    if (fatto === undefined) return;
    const sveglia = setTimeout(() => setFatto(undefined), 1800);
    return () => clearTimeout(sveglia);
  }, [fatto]);
  return (
    <button
      type="button"
      className={fatto === undefined ? "copia" : `copia ${fatto}`}
      aria-label={fatto === "copiato" ? "Copiato" : fatto === "non-riuscito" ? "Non copiato" : etichetta}
      title={fatto === "copiato" ? "Copiato" : fatto === "non-riuscito" ? "Non copiato" : etichetta}
      onClick={() => void copia(testo).then((riuscito) => setFatto(riuscito ? "copiato" : "non-riuscito"))}
    >
      <IconaCopia fatto={fatto} />
    </button>
  );
}

/**
 * Il pulsante ▶ di un blocco che è un comando, nella chat di un progetto: apre il pannello sul
 * terminale del progetto e ve lo scrive, con Invio, come se lo battesse il proprietario. Non passa
 * dai permessi di Claude: è il proprietario a lanciarlo.
 */
function PulsanteEsegui({ codice, linguaggio }: { codice: string; linguaggio: string }): ReactNode {
  const base = useBaseDellaChat();
  const solaLettura = useSolaLettura();
  const quadro = useQuadroCorrente();
  const [fatto, setFatto] = useState<"lanciato" | "non-riuscito">();
  useEffect(() => {
    if (fatto === undefined) return;
    const sveglia = setTimeout(() => setFatto(undefined), 2000);
    return () => clearTimeout(sveglia);
  }, [fatto]);
  const codificato = /^\/api\/progetti\/([^/]+)$/.exec(base)?.[1];
  if (solaLettura || codificato === undefined || !eUnComando(linguaggio)) return null;
  const idProgetto = progettoDellaConversazione(decodeURIComponent(codificato));
  const spento = quadro.progetti?.progetti.find((progetto) => progetto.id === idProgetto)?.condizione === "ambiente-spento";
  const etichetta = spento
    ? "L'ambiente del progetto è spento: il terminale non si apre"
    : fatto === "lanciato"
      ? "Lanciato nel terminale"
      : fatto === "non-riuscito"
        ? "Il terminale non si è aperto"
        : "Esegui nel terminale del progetto";
  return (
    <button
      type="button"
      className={fatto === undefined ? "esegui" : `esegui ${fatto}`}
      aria-label={etichetta}
      title={etichetta}
      disabled={spento}
      onClick={() => {
        apriSchedaDelPannello(idProgetto, "terminale");
        void mandaAlTerminale(idProgetto, comandoDaEseguire(codice, linguaggio)).then((riuscito) => setFatto(riuscito ? "lanciato" : "non-riuscito"));
      }}
    >
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {fatto === "lanciato" ? <path d="M4.5 10.5l3.5 3.5 7.5-8" /> : fatto === "non-riuscito" ? <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /> : <path d="M6.5 4.5v11l9-5.5z" />}
      </svg>
    </button>
  );
}

/** Un blocco di codice: il linguaggio, il pulsante Copia, e il codice con i suoi colori quando sono pronti. */
export function BloccoCodice({ codice, linguaggio }: { codice: string; linguaggio: string }): ReactNode {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    let valido = true;
    setHtml(undefined);
    void import("./evidenzia.ts").then(({ evidenzia }) => {
      if (valido) setHtml(evidenzia(codice, linguaggio));
    });
    return () => {
      valido = false;
    };
  }, [codice, linguaggio]);
  if (linguaggio === "mermaid") return <Diagramma codice={codice} />;
  if (linguaggio === LINGUAGGIO_RIQUADRO) return <RiquadroDiCifre codice={codice} />;
  return (
    <div className="blocco-codice">
      <div className="testa-codice">
        <span className="linguaggio">{linguaggio === "" ? "codice" : linguaggio}</span>
        <PulsanteCopia testo={codice} etichetta="Copia il codice" />
        <PulsanteEsegui codice={codice} linguaggio={linguaggio} />
      </div>
      <pre>
        {html === undefined ? <code>{codice}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
    </div>
  );
}

/** Un riquadro di cifre: un titolo, una riga per voce con la cifra a destra, verde se entra e rossa se esce. */
function RiquadroDiCifre({ codice }: { codice: string }): ReactNode {
  const riquadro = leggiRiquadro(codice);
  return (
    <figure className="riquadro-cifre">
      {riquadro.titolo !== undefined && <figcaption className="titolo-riquadro">{riquadro.titolo}</figcaption>}
      <div className="corpo-riquadro">
        {riquadro.righe.map((riga, indice) => (
          <div key={indice} className="riga-riquadro">
            <div className="voce-riquadro">
              <span>{riga.voce}</span>
              {riga.nota !== undefined && <span className="nota-riquadro">{riga.nota}</span>}
            </div>
            {riga.valore !== undefined && <span className={riga.segno === undefined ? "valore-riquadro" : `valore-riquadro ${riga.segno}`}>{riga.valore}</span>}
          </div>
        ))}
      </div>
      {riquadro.note.map((nota, indice) => (
        <p key={indice} className="tenue spiegazione-riquadro">
          {nota}
        </p>
      ))}
    </figure>
  );
}

/** Un colore del tema di Shinka, letto dalle sue variabili: Mermaid vuole colori veri. */
function coloreDelTema(nome: string, riserva: string): string {
  const letto = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return letto === "" ? riserva : letto;
}

/** L'aspetto dei diagrammi: i colori di Shinka, frecce curve, riquadri arrotondati come nelle risposte di ChatGPT. */
function temaDeiDiagrammi(scuro: boolean): Record<string, unknown> {
  const superficie = coloreDelTema("--superficie", scuro ? "#202023" : "#ffffff");
  const testo = coloreDelTema("--testo", scuro ? "#ececea" : "#1c1c1e");
  const tenue = coloreDelTema("--tenue", scuro ? "#a3a29e" : "#6b6a68");
  const bordo = coloreDelTema("--bordo", scuro ? "#323236" : "#e2e1dd");
  const codice = coloreDelTema("--codice", scuro ? "#29292d" : "#f2f1ee");
  const accento = coloreDelTema("--grafico", scuro ? "#6590f5" : "#2f5fd0");
  const bene = coloreDelTema("--bene", scuro ? "#5ecb93" : "#1f7a4d");
  const male = coloreDelTema("--male", scuro ? "#ff8a80" : "#b3261e");
  const attesa = coloreDelTema("--attesa", scuro ? "#f0b35a" : "#a85f00");
  const tavolozza = [accento, bene, attesa, male, tenue, "#9b7bd8", "#3fb3c8", "#d97eb0"];
  return {
    theme: "base",
    // L'aspetto classico: senza le ombre dell'aspetto nuovo di Mermaid 12, e con le frecce curve.
    look: "classic",
    // La disposizione di prima (dagre): con quella nuova di Mermaid 12 le frecce vanno a gomito e la curva non vale.
    layout: "dagre",
    darkMode: scuro,
    themeCSS: `.node rect, .node .label-container { rx: 12px; ry: 12px; } .edgeLabel, .edgeLabel p { background-color: ${superficie}; color: ${testo}; } .edgeLabel rect { fill: ${superficie}; }`,
    themeVariables: {
      darkMode: scuro,
      background: superficie,
      fontFamily: "inherit",
      fontSize: "15px",
      primaryColor: codice,
      primaryBorderColor: bordo,
      primaryTextColor: testo,
      secondaryColor: codice,
      tertiaryColor: superficie,
      lineColor: bene,
      textColor: testo,
      edgeLabelBackground: superficie,
      clusterBkg: superficie,
      clusterBorder: bordo,
      noteBkgColor: codice,
      noteTextColor: testo,
      noteBorderColor: bordo,
      actorBkg: codice,
      actorBorder: bordo,
      actorTextColor: testo,
      signalColor: tenue,
      signalTextColor: testo,
      ...Object.fromEntries(tavolozza.map((colore, indice) => [`pie${indice + 1}`, colore])),
      pieStrokeColor: superficie,
      pieOuterStrokeColor: bordo,
      pieTitleTextColor: testo,
      pieSectionTextColor: scuro ? "#0d1220" : "#ffffff",
      pieLegendTextColor: testo,
      xyChart: { backgroundColor: "transparent", titleColor: testo, xAxisLabelColor: tenue, yAxisLabelColor: tenue, xAxisLineColor: bordo, yAxisLineColor: bordo, xAxisTickColor: bordo, yAxisTickColor: bordo, plotColorPalette: tavolozza.join(",") },
    },
    flowchart: { curve: "basis", padding: 14, nodeSpacing: 40, rankSpacing: 70 },
  };
}

/** Un diagramma Mermaid, disegnato dalla sua libreria; se non si disegna, resta il codice con il perché. */
function Diagramma({ codice }: { codice: string }): ReactNode {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { tema } = useAspetto();
  const [svg, setSvg] = useState<string>();
  const [errore, setErrore] = useState<string>();
  // Con il tema automatico il diagramma si ridisegna quando il sistema passa dal chiaro allo scuro.
  const [sistemaScuro, setSistemaScuro] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
  useEffect(() => {
    const domanda = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (domanda === undefined) return;
    const cambia = (): void => setSistemaScuro(domanda.matches);
    domanda.addEventListener("change", cambia);
    return () => domanda.removeEventListener("change", cambia);
  }, []);
  const scuro = tema === "scuro" || (tema === "automatico" && sistemaScuro);
  useEffect(() => {
    let valido = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        // "strict": niente script né collegamenti attivi nel disegno.
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", ...temaDeiDiagrammi(scuro) });
        const { svg: disegnato } = await mermaid.render(id, codice);
        if (valido) setSvg(disegnato);
      })
      .catch((causa: unknown) => {
        if (valido) setErrore(causa instanceof Error ? causa.message : String(causa));
      });
    return () => {
      valido = false;
    };
  }, [codice, id, scuro]);
  if (svg !== undefined) {
    return (
      <figure className="diagramma">
        <div className="disegno" dangerouslySetInnerHTML={{ __html: svg }} />
        <span className="copia-riquadro">
          <PulsanteCopia testo={codice} etichetta="Copia il codice del diagramma" />
        </span>
      </figure>
    );
  }
  return (
    <div className="blocco-codice">
      <div className="testa-codice">
        <span className="linguaggio">mermaid</span>
        <PulsanteCopia testo={codice} etichetta="Copia il codice" />
      </div>
      <pre>
        <code>{codice}</code>
      </pre>
      {errore !== undefined && <p className="tenue errore-diagramma">Il diagramma non si è potuto disegnare: {errore.split("\n")[0]}</p>}
    </div>
  );
}
