# ATLAS AGENT
## Specifica funzionale e architetturale per implementazione con Claude Code

**Versione:** 1.0 | **Data:** 10 novembre 2026 | **Stato:** Baseline di progetto / proposta tecnica

> **Mandato per Claude Code:** realizzare una piattaforma self-hosted, personale, estensibile e sicura, con control plane su VM Linux, agente operativo su PC Windows, controllo di Docker e infrastruttura, memoria persistente, apprendimento verificato e modulo di self-improvement capace di proporre e sviluppare estensioni. Le nuove estensioni non possono essere attivate senza approvazione esplicita del proprietario. Implementare per incrementi verificabili; non simulare integrazioni non funzionanti.

## 1. Executive summary

Atlas Agent è un agente personale operativo, disponibile 24/7, utilizzabile tramite Telegram, Web UI e CLI. Claude Code è il motore di sviluppo e ragionamento iniziale, mentre orchestrazione, strumenti, policy, dati e memoria sono implementati in componenti indipendenti. Il control plane risiede su una VM Linux; sul PC Windows opera un servizio per funzioni di sistema e un companion nella sessione utente per computer-use. Gateway dedicati consentono operazioni amministrative su Docker host e, progressivamente, SSH, Windows Server, hypervisor e dispositivi di rete.

La piattaforma è progettata per eseguire senza prompt continui le azioni già autorizzate, ma non per concedere accesso illimitato e incontrollato al modello. L'autorizzazione è applicata dal gateway con identità, target, scope e policy, non tramite semplice istruzione nel prompt. La memoria distingue osservazioni da fatti verificati e procedure riutilizzabili; l'auto-miglioramento produce modifiche software isolate, testabili e sottoposte ad approvazione prima della promozione.

### 1.1 Obiettivi prioritari
- Sviluppare progetti software con Claude Code ufficiale, preservando capacità CLI e strumenti nativi.
- Controllare da Telegram e Web UI processi lunghi, con stato, log, cancel e notifiche.
- Eseguire deploy Docker e amministrazione consentita senza reinserire ogni volta credenziali.
- Eseguire operazioni Windows (PowerShell, installazioni, file) e computer-use sulla sessione interattiva.
- Conservare memoria episodica, semantica e procedurale, con provenienza e ambito.
- Generare e migliorare skill riutilizzabili con validazione, versionamento e rollback.
- Sviluppare nuove estensioni dell'Agent Runtime su richiesta dell'utente o proposta dell'agente, con approvazione preventiva all'attivazione.
- Consentire in futuro adapter per altri harness/modelli senza migrare memoria e policy.

### 1.2 Non-obiettivi della prima release
- Non costruire un nuovo modello LLM né replicare internamente il ragionamento di Claude Code.
- Non fornire root/Domain Admin globali all'LLM, né un terminale privilegiato senza policy.
- Non promettere unattended computer-use sul desktop Windows bloccato o senza sessione interattiva.
- Non implementare subito tutte le API di hypervisor, NAS, firewall o sistemi enterprise.
- Non garantire che il piano Claude Pro possa sostenere attività AI 24/7 o un prodotto terzo: verificare autenticazione, condizioni d'uso e quota nella configurazione concreta.

## 2. Principi architetturali

1. **Model/harness agnostic:** il runtime usa `AgentAdapter`, non dipende da un solo vendor.
2. **Trust boundaries:** il codice generato dall'LLM è non attendibile fino alla validazione; le policy vivono fuori dall'LLM.
3. **Least privilege e zero trust:** credenziali per servizio/host, autorizzazioni per azione e sessioni a scadenza.
4. **Autonomia controllata:** classi di azioni preautorizzate; approvazioni per rischi e scope nuovi.
5. **Observability by design:** ogni job, tool call e side effect ha ID, timestamp, origine e audit.
6. **Recovery first:** idempotenza, timeout, ripresa, backup, snapshot ove sensato e rollback.
7. **Evidence-based learning:** il successo deriva da test, output e verifiche, non dalla sola dichiarazione del modello.
8. **Separation of duties:** il componente che propone estensioni non può approvarle né auto-elevarsi privilegi.
9. **Local-first:** dati, memoria e log rimangono sulla VM salvo provider esterni esplicitamente configurati.
10. **Incremental delivery:** ogni fase deve avere test e demo riproducibili prima di passare alla successiva.

## 3. Topologia e infrastruttura

```text
Telegram / Browser Web UI / CLI
                 |
           API Gateway (auth, rate limit, TLS)
                 |
       Orchestrator + Task Queue + Scheduler
          |           |                |
     Claude Runner  Memory/Skill       Policy/Approval
     AgentAdapter   Engine             + Audit
          |           |                |
       Tool Registry / MCP Gateway / Extension Manager
                 |
          Execution Gateway (mTLS)
          /           |            \
   Windows Agent   Docker Agent    SSH/API Adapters
    Service + GUI    scoped API     servers/network

Persistent data: SQLite -> PostgreSQL; Git skill/extension repository;
secret broker/vault; artifact storage; structured logs.
```

### 3.1 VM Linux: profilo iniziale
Sistema suggerito: Ubuntu Server LTS; 4 vCPU, 8 GB RAM, 100 GB disco, nessuna GPU per inferenza remota. Il rendering video o l'inferenza locale vanno delegati ad altri worker. La macchina rimane operativa quando il PC Windows è spento. Accessi remoti sulla rete privata WireGuard/Tailscale; dashboard e gateway non devono essere esposti direttamente su Internet.

### 3.2 Separazione di processi
- **API/UI:** nessun privilegio amministrativo sugli host.
- **Orchestrator:** crea job, invoca runner, aggiorna stati e applica limiti.
- **Claude Runner:** utente Linux non privilegiato, workspace isolato per job/progetto; niente mount del socket Docker né accesso indiscriminato al vault.
- **Tool/Execution Gateway:** esegue solo operazioni con schema e permessi validati.
- **Extension Builder:** container/VM effimera, accesso di rete ristretto, nessun segreto di produzione.
- **Extension Runtime:** estensioni firmate o con hash registrato, capacità esplicite, isolamento e revoca.

## 4. Componenti del control plane

### 4.1 API e autenticazione
Stack suggerito: Python 3.12+, FastAPI, Pydantic, WebSocket/SSE per streaming, React/TypeScript per dashboard. Login locale iniziale con passkey/OIDC se disponibile; MFA per approvazioni sensibili. Telegram è un canale di ingresso collegato a uno o più ID utente ammessi: non basta conoscere il token del bot per essere autorizzati.

### 4.2 Orchestrator e job lifecycle
Stati: `queued`, `preparing`, `running`, `waiting_approval`, `paused`, `succeeded`, `failed`, `cancelled`, `timed_out`. Ogni job contiene `job_id`, `correlation_id`, richiedente, canale, scope, policy context, `workspace_id`, adapter scelto, deadline e riferimenti agli artifact. Retry solo su operazioni idempotenti oppure dopo reconciliation; impedire doppi deploy su ritentativo. Arresto immediato di nuovi step tramite kill switch; riconoscere che un'azione già eseguita su host remoto potrebbe richiedere rollback esplicito.

### 4.3 Runner Claude Code
Avviare il client ufficiale Claude Code in directory di lavoro controllate, usando interfacce CLI/documentate. Supportare input prompt, session resume dove ufficialmente possibile, eventi strutturati, cancellazione, timeout e raccolta artifact. La modalità di autenticazione con abbonamento Claude Pro va validata direttamente con i termini e limiti correnti; non estrarre token né mettere credenziali utente in gateway o container. Considerare esplicitamente che l'uso non presidiato di un'applicazione intermediaria può richiedere API key e fatturazione distinta. La prima integrazione deve essere un esperimento tecnico/contrattuale verificato; prevedere fallback API e rendere visibile la fonte di billing.

### 4.4 AgentAdapter
```python
class AgentAdapter(Protocol):
    async def start_task(self, task: Task, context: TaskContext) -> RunHandle: ...
    async def stream_events(self, handle: RunHandle) -> AsyncIterator[AgentEvent]: ...
    async def resume(self, handle: RunHandle, message: str) -> None: ...
    async def cancel(self, handle: RunHandle) -> None: ...
    async def capabilities(self) -> CapabilitySet: ...
```

Non assumere che tutti gli harness espongano session resume o eventi identici: dichiarare capacità per adapter. I job non devono importare SDK Anthropic direttamente fuori dal modulo adapter.

### 4.5 Event bus e scheduler
Per l'MVP: job store SQLite + worker singolo e scheduling persistente; successivamente PostgreSQL, Redis o un motore di workflow affidabile. Cron job configurabili dall'utente, heartbeat degli agenti, task di manutenzione e notifiche a risultato o errore. Imporre rate limit e budget di tool call, token e tempo per impedire loop autonomi incontrollati.

## 5. Windows Agent e computer-use

### 5.1 Due processi distinti
- **Windows System Service (.NET):** esegue comandi amministrativi tipizzati, inventario, installazioni software autorizzate (winget/MSI), gestione servizi e file. Account di servizio dedicato; privilegi elevati solo per operazioni approvate; PowerShell constrained endpoints/JEA ove utilizzabile.
- **Windows Desktop Companion (.NET):** avviato nella sessione interattiva dell'utente, gestisce screenshot, accessibilità/UI Automation, finestre, input e controllo browser. Comunica col service tramite IPC autenticato (named pipe con ACL).

Il service non deve tentare di controllare la UI dalla Session 0. Quando PC, sessione desktop o companion non sono disponibili, il job passa a `waiting_for_endpoint` o `paused` con timeout e messaggio utile.

### 5.2 Priorità strumenti
Per l'automazione usare in quest'ordine: API/CLI -> browser DOM/Playwright -> Windows UI Automation -> screenshot + coordinate, con screenshot di verifica prima/dopo. Minimizzare interazioni con app contenenti dati personali o aziendali; escludere finestre di password manager, prompt di sicurezza e UAC dall'automazione non presidiata salvo meccanismi approvati separati.

### 5.3 Connettività
Il companion e il service aprono connessioni outbound autenticate verso il control plane; certificati mTLS per device, rotazione e revoca. Nessuna porta RDP o agente esposta pubblicamente. Eventuale streaming schermo cifrato, temporaneo e con audit; indicatori locali che mostrano quando l'agente sta controllando il desktop; hotkey di stop locale.

## 6. Adapter infrastrutturali

### 6.1 Docker
Il Docker Agent gira vicino all'engine e non consegna all'LLM `/var/run/docker.sock`: espone operazioni validate come `inspect`, `list`, `deploy_compose`, `logs`, `restart`, `update`, `health`, `rollback`. Limitare image registry, reti, volumi, path host, porte, capabilities e privileged mode. Vietare mount sensibili (socket Docker, `/`, directory dei segreti) salvo eccezioni esplicite approvate. Ogni deploy salva manifesto, digest immagini, snapshot della configurazione e output dei test.

### 6.2 SSH / PowerShell Remoting / API
Account di servizio separati per ambienti `lab`, `staging`, `prod`; comandi amministrativi tipizzati e shell interattiva solo in workspace a bassa fiducia. Registry host con attributi: owner, ambiente, criticità, sistema, endpoint, credenziale, capability e policy. Per vSphere, Proxmox, NAS e apparati rete aggiungere adapter solo dopo test su laboratorio e definizione granularità delle operazioni.

### 6.3 Credential broker
Segreti in vault o key store OS; riferimenti (`secret_ref`) negli schemi, mai valori nelle memorie. I gateway recuperano credenziali solo per target e azione autorizzati, con lease breve e audit. Redazione di token/password nei log. Vietato includere segreti in prompt, output dei tool o artifact. La password non è necessaria a ogni task perché l'identità del device e la policy consentono il recupero controllato.

## 7. Policy engine, approvazioni e threat model

### 7.1 Livelli di rischio
- **R0 Lettura:** inventario, lettura metriche/log non sensibili: automatico nel perimetro consentito.
- **R1 Modifiche reversibili lab:** deploy container standard, restart servizi lab, installazione software da allowlist: automatico se prerequisiti e rollback soddisfatti.
- **R2 Modifiche sensibili:** riavvio host, update OS, porte/firewall, produzione, nuovi privilegi o reti: approvazione esplicita.
- **R3 Distruttivo/identità:** delete VM/volume, modifiche AD, segreti, backup retention, privilegi e operazioni non reversibili: approvazione forte + verifica preventiva; eventualmente doppio consenso.

La policy deve essere deterministica (`principal`, `action`, `resource`, `environment`, `risk`, `constraints`) e verificata dal gateway al momento dell'esecuzione, anche se il modello aveva già ottenuto un piano approvato. Ogni token di approvazione è legato a hash di piano, host, azioni e scadenza; ogni modifica del piano invalida l'approvazione.

### 7.2 Minacce da considerare
Prompt injection da siti web, README, email e log; esfiltrazione di segreti; shell escalation; estensioni malevole o difettose; compromissione Telegram; replay di task; supply-chain delle dipendenze; cross-project memory leakage; auto-riscrittura delle policy. Mitigazioni: confini di fiducia, sandbox, egress filtering, revisione artefatti, allowlist, scanner dipendenze, firme/hash, audit e separazione approvatore/esecutore. I contenuti recuperati dall'esterno sono dati non attendibili e non possono autorizzare nuove capacità.

### 7.3 Kill switch e ripristino
Interruzione job, disabilitazione singolo agent/gateway, revoca certificati, blocco approvazioni pendenti e rollback applicativo. Backup cifrati di database, registry skill, policy e configurazioni; test periodici di restore. Audit append-only inoltrato su storage separato, ove disponibile.

## 8. Memoria, recall e knowledge lifecycle

### 8.1 Modello dati
- `Observation`: fatto osservato, origine, timestamp, project/host, evidenza, confidenza.
- `Episode`: task, intenzione, sequenza eventi, outcome, artifact, failures.
- `Fact`: informazione consolidata con scope, valid_from/expiry e provenienza.
- `Procedure`: workflow validato con prerequisiti, strumenti, test, rollback e versione.
- `Skill`: contenuto operativo richiamabile da Claude e altri adapter, con capability richieste.

Separare knowledge globale, progetto, ambiente e host. Non propagare un fatto da lab a prod senza validazione. Versionare e consentire correzione/oblio. Escludere segreti e informazioni sensibili dalle embeddings e dai riassunti; retention configurabile.

### 8.2 Recall
Inizialmente SQLite FTS5 con filtri per scope, recency e affidabilità, quindi PostgreSQL/pgvector solo se le metriche giustificano ricerca semantica. Prima del task recuperare poche memorie ad alta pertinenza con citazioni verso episodi/artifact; non caricare indiscriminatamente tutta la cronologia nel contesto.

### 8.3 Learning pipeline
`capture -> redact -> extract candidates -> verify evidence -> deduplicate -> classify -> propose -> validate -> publish`. L'autonomia può creare nuove osservazioni e bozze. Una skill che invoca tool con privilegi maggiori richiede sempre approvazione. Successi e fallimenti devono produrre feedback confrontabile: test passati, errore residuo, rollback necessario, qualità percepita dall'utente. Memorie senza evidenza vanno marcate come ipotesi.

## 9. Self-improvement ed Extension Development Studio

### 9.1 Requisito centrale
Atlas può **proporre**, **progettare**, **scrivere**, **testare** e **revisionare** nuove estensioni della piattaforma. Può farlo (A) su richiesta esplicita dell'utente oppure (B) autonomamente quando identifica un limite, un workflow ripetitivo o un'integrazione utile. In entrambi i casi **l'installazione, l'attivazione e ogni aumento di privilegi richiedono approvazione esplicita dell'utente**. Le proposte autonome non devono trasformarsi in modifiche silenziose del runtime.

### 9.2 Categorie di estensione
- **Tool adapter:** nuove operazioni su sistemi esistenti (es. API di un NAS).
- **Integration connector:** servizio esterno o protocollo, con credenziali dedicate.
- **Workflow/skill:** procedura e orchestrazione di tool esistenti; meno rischiosa del codice eseguibile.
- **UI extension:** nuova vista o comando della dashboard.
- **Agent adapter:** supporto a un harness/modello alternativo.
- **Background worker:** task periodico con budget, limiti e scheduler.

**Non ammettere self-modification del Policy Engine, dell'approvatore, del credential broker o del sistema di firma tramite un workflow di autopromozione.** Cambiamenti in tali componenti richiedono procedura manuale e review più severa.

### 9.3 Pipeline di sviluppo estensioni
1. **Opportunity detection:** da richiesta utente o metrica (es. 5 task falliti perché manca una specifica API).
2. **Proposal:** problema, valore, alternative senza codice, ambito, accessi, dipendenze, rischi, test, piano di rollback e stima del consumo AI.
3. **Approval to build (facoltativa per richieste dirette):** per suggerimenti autonomi chiedere permesso prima di impegnare risorse rilevanti; la sola proposta non autorizza nuove capacità.
4. **Isolated branch/worktree:** generazione codice in repository e sandbox di sviluppo, senza credenziali prod né accesso ai gateway reali.
5. **Automated validation:** lint/typecheck/unit/integration con mock, schema contract, secret scanning, SAST, dependency/license review, SBOM, test negativi e policy tests.
6. **Staging:** esecuzione dell'estensione in staging con dati fittizi e capability di test; smoke test e simulazione rollback.
7. **Review package:** diff, changelog, manifest capacità, report test, dipendenze, rischi residui, source commit/hash e demo.
8. **Explicit promotion approval:** l'utente approva versione specifica e capability specifiche; l'approvazione deve legarsi a hash immutabile.
9. **Controlled deployment:** firma/registrazione hash, rollout canary, health check, monitoraggio; auto rollback per regressioni note.
10. **Post-release learning:** esiti registrati, uso, errori e proposta eventuale miglioramento successivo.

### 9.4 Extension manifest (bozza)
```yaml
id: com.atlas.adapters.docker-health
version: 0.1.0
api_version: v1
entrypoint: extension:register
kind: tool_adapter
publisher: local-owner
capabilities:
  - docker.inspect
  - docker.logs.read
resources:
  hosts: [docker-lab-01]
  network_egress: ["docker-gateway.internal"]
  filesystem: ["/workspace/read-only"]
secrets: []
limits:
  cpu: "1"
  memory_mb: 512
  timeout_seconds: 60
approval:
  activation_required: true
  privileged_changes_required: true
validation:
  test_command: "pytest -q"
  required_checks: [unit, integration, security, policy]
```

### 9.5 Proactive recommendation engine
Valuta pattern osservati: task ripetuti, tool failure ricorrenti, uso manuale dello stesso workaround, integrazioni assenti. Produce un **Opportunity Card** con evidenze, beneficio, costo, complessità, rischi, permessi richiesti e opzioni: ignorare, rimandare, approvare progettazione, approvare sviluppo. Imporre rate limit alle proposte (es. massimo 1 notifica non urgente ogni 24 ore), deduplica e possibilità di disattivazione.

### 9.6 Learning vs self-improvement
L'autoapprendimento migliora memoria e skill usando capacità esistenti. Il self-improvement modifica il software Atlas mediante nuovi plugin/adapter/UI/worker. I due processi hanno gate distinti: osservazioni automatiche, skill eseguibili dopo test/approvazione secondo rischio, **codice di estensione sempre revisionato e approvato prima dell'attivazione**.

### 9.7 Anti-regression e anti-recursion
Nessuna estensione può installare estensioni, disabilitare audit, cambiare proprie capability, concedersi segreti o modificare policy. Nessun self-improvement può aumentare il proprio budget o autoapprovare. Test di non regressione del control plane su ogni promozione; version pinning, atomic deployment, rollback a versione precedente. Bloccare catene infinite di auto-miglioramento mediante profondità massima, budget e approvazioni.

## 10. API e contratti minimi

### 10.1 Endpoint iniziali
```text
POST   /api/v1/jobs
GET    /api/v1/jobs/{id}
POST   /api/v1/jobs/{id}/cancel
GET    /api/v1/jobs/{id}/events          [SSE]
GET    /api/v1/agents
GET    /api/v1/hosts
POST   /api/v1/approvals/{id}/decision
GET    /api/v1/memories/search
GET    /api/v1/skills
GET    /api/v1/extensions
POST   /api/v1/extensions/proposals
POST   /api/v1/extensions/{id}/build
POST   /api/v1/extensions/{id}/approve
POST   /api/v1/extensions/{id}/rollback
```

### 10.2 Event schema
```json
{
  "event_id": "uuid", "job_id": "uuid", "timestamp": "ISO-8601",
  "type": "tool.started|tool.completed|approval.requested|job.state.changed",
  "actor": "runner|gateway|user", "target": "docker-lab-01",
  "risk": "R1", "result": "redacted payload", "trace_id": "uuid"
}
```

### 10.3 Identità e idempotenza
Ogni comando verso un nodo contiene `request_id`, `principal_id`, `capability`, `target_id`, `arguments` validati, `approval_id` se necessario, scadenza e firma/identità di trasporto. Il gateway respinge richieste non autorizzate, vecchie, duplicate o incoerenti; registra l'effetto reale distinto dal risultato dichiarato dal runner.

## 11. UX / dashboard e Telegram

Dashboard con: inbox task, run live e step, log tool sanitizzati, host/agent registry, memoria ricercabile con provenienza, skill registry, extension studio, approvals, policy editor, usage/billing, security events, backup status. Visualizzare in modo inequivocabile `proposal`, `built`, `tested`, `awaiting approval`, `active`, `rolled back`.

Telegram: lista allowlist di user ID/chat ID, comandi `/task`, `/status`, `/cancel`, `/hosts`, `/approvals`, `/memory`, `/extensions`; non pubblicare credenziali, dump completi o screenshot sensibili. Le approvazioni R2/R3 e di attivazione codice devono richiedere una conferma rafforzata nella dashboard, non un semplice tap su Telegram senza autenticazione supplementare.

## 12. Modello dati iniziale

Entità: `users`, `devices`, `hosts`, `capabilities`, `policies`, `jobs`, `job_events`, `approvals`, `artifacts`, `memory_observations`, `memory_facts`, `episodes`, `skills`, `skill_versions`, `extension_proposals`, `extension_builds`, `extension_versions`, `extension_permissions`, `secret_refs`, `audit_records`.

Campo comune: UUID, created/updated, owner/scope, stato e revision. `audit_records` append-only; artifact e log possono essere conservati separatamente con retention configurabile. Considerare schema migration e backup fin dall'MVP.

## 13. Security and privacy acceptance gates

- Non esistono credenziali in database di memoria, prompt, Git, artifact o log.
- Nessun endpoint privileged senza policy enforcement server-side e audit.
- Nessuna estensione non approvata viene caricata nel processo operativo.
- Cambio manifest/capability dopo approvazione invalida automaticamente la promozione.
- Il runner non può accedere al socket Docker, ai secret store o ai percorsi amministrativi host.
- Prompt injection da pagina web non può concedere capability o approvare una modifica.
- Il blocco/revoca di un device impedisce ulteriori esecuzioni dopo scadenza del token e terminazione delle sessioni.
- Una perdita di connettività non provoca retry distruttivi incontrollati.
- Una nuova versione fallita viene arrestata e rollbackata con audit.

## 14. Piano implementativo per Claude Code

### Fase 0 — Repo e vertical slice (priorità P0)
Monorepo, documentazione, ADR, CI, pre-commit, test, Docker Compose, config `.env.example` senza segreti, quality gates. Dimostrare l'avvio del control plane e una API health.

### Fase 1 — Jobs + Claude integration (P0)
API task, runner adapter isolato, streaming eventi, Web UI minima, Telegram allowlist, start/cancel/timeout, session history, autenticazione, usage meter. **Gate:** un task di sviluppo produce artifact in workspace e log consultabili. Verificare esplicitamente condizioni d'uso e billing del client Claude ufficiale in questa architettura.

### Fase 2 — Docker lab gateway (P0)
Registry host, tool schema Docker, policy R0/R1, secret broker minimale, audit, deploy compose idempotente, health/rollback. **Gate:** da Telegram richiesta deploy Uptime Kuma in lab; app raggiungibile, volume persistente, manifest versionato, nessun accesso socket al runner.

### Fase 3 — Windows Agent (P1)
Service .NET, enrollment mTLS, inventario, PowerShell con azioni tipizzate, winget autorizzato; companion GUI, Playwright e UI Automation. **Gate:** installazione applicazione allowlist, screenshot verificato e stop locale funzionante; PC offline gestito correttamente.

### Fase 4 — Memory & skill learning (P1)
Episodi, osservazioni, redaction, FTS5, recall, skill draft/test/approval, Git versioning. **Gate:** il secondo deploy simile recupera una procedura precedente con citazione e riduce i passaggi senza inventare informazioni.

### Fase 5 — Extension Studio / self-improvement (P1)
Opportunity detector, proposte, sandbox builder, manifest, check security, staging, review diff, activation approval, rollout e rollback. **Gate:** richiesta di creare un adapter fittizio; Atlas genera codice/test, presenta review package e non attiva nulla fino ad approvazione; dopo l'approvazione l'estensione passa test e funziona, quindi rollbackabile.

### Fase 6 — Hardening e multi-adapter (P2)
PostgreSQL, queue distribuita, OpenCode/altro adapter, API VMware/SSH, backup/restore drill, metriche, disaster recovery e valutazione automatizzata.

## 15. Test end-to-end obbligatori

| ID | Scenario | Risultato atteso |
|---|---|---|
| T01 | Task Telegram verso Claude Runner | Stato e output consultabili, identità corretta |
| T02 | Interrompere task lungo | Cancel propagato; nessun nuovo tool step |
| T03 | Docker deploy lab | Servizio funzionante, compose/volumi/versione registrati |
| T04 | Docker delete senza approvazione | Negato e registrato in audit |
| T05 | Tentativo prompt injection da README/web | Nessuna nuova capability o segreto esposto |
| T06 | PC Windows offline | Job sospeso/errore comprensibile, nessuna perdita stato |
| T07 | Installazione app Windows allowlist | Esecuzione/verifica, audit e stop disponibili |
| T08 | Memoria corretta da utente | Versione aggiornata, provenienza preservata |
| T09 | Skill con test falliti | Non pubblicata automaticamente |
| T10 | Proposta self-improvement autonoma | Opportunity Card, nessuna installazione |
| T11 | Build di estensione in sandbox | Test e diff disponibili, nessun accesso prod |
| T12 | Tentata autoapprovazione plugin | Negata da sistema di policy |
| T13 | Modifica manifest dopo approvazione | Hash mismatch, deploy bloccato |
| T14 | Rollback plugin difettoso | Versione precedente ripristinata e audit |
| T15 | Backup/restore del control plane | Job, skill, policy e dati ripristinati |

## 16. Sviluppo guidato: istruzioni operative per Claude Code

1. Leggere l'intera specifica, identificare ambiguità reali e proporre ADR minime, senza riscrivere arbitrariamente gli obiettivi.
2. Iniziare dalla Fase 0 e procedere con PR/commit piccoli e test eseguibili; implementare un vertical slice per volta.
3. Scrivere prima contratti/schema, poi adapter/mock, quindi implementazioni reali.
4. Ogni componente deve avere test unitari, integration e negative/security quando applicabile.
5. Non usare dati finti presentandoli come veri; documentare ogni integrazione mancante come stub.
6. Non abilitare per default permessi elevati, autoapprovazione, shell root o Docker socket nel runner.
7. Per ogni fase produrre `README`, `DEPLOYMENT`, `SECURITY`, `OPERATIONS` e ADR aggiornati.
8. Conservare un `IMPLEMENTATION_STATUS.md` con ciò che è reale, mock, testato, bloccato e le decisioni prese.
9. Prima di configurare Claude Pro come backend non presidiato, verificare condizioni d'uso, modalità di login supportata e quote; prevedere API mode come alternativa.
10. Fermarsi ai gate definiti prima di espandere il perimetro; chiedere approvazione per cambiamenti ad architettura di sicurezza e self-improvement.

## 17. Decisioni aperte (non bloccanti per Fase 0)

- Hypervisor VM: VMware/vSphere o altro; nessuna dipendenza nella prima fase.
- Host Docker: VM principale o nodi separati; preferire nodi separati per carichi operativi.
- Windows: Windows 11 presumibile, confermare architettura e policy UAC/EDR al setup.
- Vault: scegliere in base al sistema operativo e alle credenziali già usate.
- Distribuzione del sistema: inizialmente solo uso personale; un eventuale prodotto commerciale richiederà revisione licensing/auth/telemetria.
- Retention default di log e screenshot, crittografia backup, ruoli approvatori e ambienti prod/lab.
- Accesso a siti e contenuti esterni: rispettare autenticazione, privacy, copyright e condizioni dei servizi.

## 18. Definition of Done del progetto

Atlas Agent è accettato quando un utente autorizzato può inviare una richiesta tramite Telegram, seguirla da dashboard, far eseguire da Claude Code un progetto o da un gateway un task operativo, ricevere un risultato verificabile, ritrovare il contesto corretto nelle sessioni successive e autorizzare esplicitamente una nuova estensione generata dalla piattaforma. Tutto ciò deve avvenire con audit, credenziali protette, limiti configurabili, policy enforceable e rollback testato.

