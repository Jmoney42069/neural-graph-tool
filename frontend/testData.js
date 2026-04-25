/*!
 * testData.js — NeuralGraph Intelligente Demo Graph
 * Voltera Backoffice Pipeline — 67 nodes, 95 edges — volledig gebaseerd op Demo/steps/
 *
 * Globals exposed:
 *   window.NeuralGraphTestData = {
 *     loadDemoGraph()          → { nodes, edges }  (geen render, alleen data)
 *     loadDemo()               → laadt + rendert + slaat op
 *     load(nodeCount)          → synthetische graph (performance test)
 *     generate(n, e)           → { nodes, edges } zonder render
 *     findCriticalPath(nodes, edges)  → { path: [ids], nodesOnPath: Set<id> }
 *   }
 */
(function () {
    "use strict";

    // =========================================================================
    // SYSTEEM 1A — GRAPH EXTRACTIE UIT DEMO MAP
    // Alle 67 nodes gebaseerd op echte MD bestanden in Demo/steps/
    // =========================================================================

    function loadDemoGraph() {
        var nodes = _buildNodes();
        var edges = _buildEdges();
        var cp    = findCriticalPath(nodes, edges);

        // Markeer nodes op kritieke route
        nodes.forEach(function (n) {
            n.onCriticalPath = cp.nodesOnPath.has(n.id);
        });
        // Markeer edges op kritieke route
        edges.forEach(function (e) {
            var from = cp.path.indexOf(e.from);
            var to   = cp.path.indexOf(e.to);
            e.onCriticalPath = from !== -1 && to !== -1 && to === from + 1;
        });

        return { nodes: nodes, edges: edges, criticalPath: cp.path };
    }

    // =========================================================================
    // NODES — exact gebouwd uit Demo/steps/ MD inhoud
    // =========================================================================
    function _buildNodes() {
        return [
            // ── ROLLEN ──────────────────────────────────────────────────────────────────
            {
                id: "rol-closer",
                label: "Closer",
                category: "customer",
                description: "Verkoopmedewerker verantwoordelijk voor het afsluiten van de deal en overdracht naar backoffice.",
                source_text: "Closer (verantwoordelijk) — overdracht naar backoffice na deal [step_02_deal_gewonnen]",
                source_file: "step_02_deal_gewonnen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "rol-backoffice",
                label: "Backoffice",
                category: "general",
                description: "Ontvangende partij na deal. Verantwoordelijk voor financiering, werkvoorbereiding en dossier.",
                source_text: "Backoffice (ontvangende partij) — verantwoordelijk voor procesopvolging [step_02_deal_gewonnen]",
                source_file: "step_02_deal_gewonnen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── SYSTEMEN / PRODUCTEN ──────────────────────────────────────────────────
            {
                id: "sys-svn",
                label: "SVN Portaal",
                category: "product",
                description: "Subsidieverstrekking Nationaal — online portaal voor toewijzingsbrief en subsidieaanvraag zonnepanelen.",
                source_text: "Controleer SVN portaal en start chase voor toewijzingsbrief fase [step_ch00_svn_stap1_entry]",
                source_file: "step_ch00_svn_stap1_entry.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "sys-ls",
                label: "Lender & Spender",
                category: "product",
                description: "Externe financieringspartner voor consumenten. Biedt leningen voor zonnepanelen installaties.",
                source_text: "IF financieringsvorm = 'Lender & Spender' THEN step_15_ls_aanvraag_starten [step_05_financieringsvorm_keuze]",
                source_file: "step_05_financieringsvorm_keuze.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "sys-wf",
                label: "Nationaal Warmtefonds",
                category: "product",
                description: "Warmtefonds financiering voor energiebesparende maatregelen. Meerstaps account-activatie en documentencheck.",
                source_text: "IF financieringsvorm = 'Nationaal Warmtefonds' THEN step_25_wf_eerste_call [step_05_financieringsvorm_keuze]",
                source_file: "step_05_financieringsvorm_keuze.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "sys-erp",
                label: "ERP Systeem",
                category: "general",
                description: "Intern ERP pakket voor werkbonnen, facturatie en dossierregistratie.",
                source_text: "Open werkbon in ERP — Zoek klant via e-mail / dossier [step_47_werkvoorbereiding]",
                source_file: "step_47_werkvoorbereiding.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── KERNPROCES: START -> FINANCIERING ────────────────────────────────────
            {
                id: "vlt-01",
                label: "Start Dossier",
                category: "process",
                description: "Startpunt van het Voltera Backoffice proces. Event dat de procesflow triggert bij binnenkomst van een nieuwe deal.",
                source_text: "Startpunt van het Voltera Backoffice proces. Dit is het initiele event dat de procesflow triggert. [step_01_start]",
                source_file: "step_01_start.md",
                role: "start",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-02",
                label: "Deal Gewonnen",
                category: "process",
                description: "Formeel afronden van de verkoop en overdracht naar backoffice. Vereist ondertekende overeenkomst en volledig klantdossier.",
                source_text: "Het formeel afronden van de verkoop en het volledig en correct overdragen van de klant naar het financierings- en backofficeproces. [step_02_deal_gewonnen]",
                source_file: "step_02_deal_gewonnen.md",
                role: "bridge",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-03",
                label: "Annulering Check?",
                category: "compliance",
                description: "Controle of klant wil annuleren voor de financieringsstap. Ja annuleringsproces. Nee financieringskeuze.",
                source_text: "IF annulering_aangevraagd = true THEN step_04 ELSE step_05_financieringsvorm_keuze [step_03_annulering_check]",
                source_file: "step_03_annulering_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-04",
                label: "Annulering Extern",
                category: "compliance",
                description: "Extern annuleringsproces — klant annuleert voor financieringsfase. Chase flow betrokken.",
                source_text: "Chasen flow / Chase flow (Lucidchart) — step_04 [step_04_annuleringsproces_extern]",
                source_file: "step_04_annuleringsproces_extern.md",
                role: "end",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-05",
                label: "Financieringsvorm",
                category: "process",
                description: "Bepaal financieringsvorm: SVN subsidie, Lender & Spender, Nationaal Warmtefonds of eigen middelen. Cruciale vertakking van de pipeline.",
                source_text: "SVN: Subsidie via gemeente. L&S: Externe financiering. WF: Warmtefonds. Eigen middelen: Klant betaalt zelf. [step_05]",
                source_file: "step_05_financieringsvorm_keuze.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            // ── SVN PAD ───────────────────────────────────────────────────────────────
            {
                id: "vlt-06",
                label: "SVN Mogelijk?",
                category: "compliance",
                description: "Check of SVN-financiering mogelijk is voor de klant. Gemeentecheck en productcheck vereist.",
                source_text: "IF svn_mogelijk = true THEN step_07 ELSE step_12 [step_06_svn_mogelijk_check]",
                source_file: "step_06_svn_mogelijk_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-07",
                label: "Toewijzingsbrief",
                category: "process",
                description: "Aanvraag toewijzingsbrief bij SVN via portaal. Noodzakelijk voor opstart subsidietraject. Chase flow actief.",
                source_text: "Toewijzingsbrief aanvragen via SVN portaal. Klant ontvangt bevestiging. [step_07_toewijzingsbrief_aanvragen]",
                source_file: "step_07_toewijzingsbrief_aanvragen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-08",
                label: "Brief Correct?",
                category: "compliance",
                description: "Controle of ontvangen toewijzingsbrief correct en volledig is. Fout opnieuw aanvragen.",
                source_text: "IF brief_correct = true THEN step_09 ELSE step_07 (opnieuw) [step_08_toewijzingsbrief_correct_check]",
                source_file: "step_08_toewijzingsbrief_correct_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-09",
                label: "SVN Aanvraag",
                category: "process",
                description: "Officiele SVN aanvraag starten op basis van goedgekeurde toewijzingsbrief. Klantgegevens en offertedetails invullen.",
                source_text: "SVN aanvraag starten zodra toewijzingsbrief correct is. [step_09_svn_aanvraag_starten]",
                source_file: "step_09_svn_aanvraag_starten.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-10",
                label: "Beoordeling SVN",
                category: "finance",
                description: "Externe SVN beoordeling. Duur: 5-20 werkdagen afhankelijk van gemeente. Single point of failure — externe afhankelijkheid.",
                source_text: "SVN beoordeelt aanvraag. Wachttijd 5-20 werkdagen. [step_10_beoordeling_svn]",
                source_file: "step_10_beoordeling_svn.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-11",
                label: "SVN Geaccepteerd?",
                category: "compliance",
                description: "Uitkomst SVN beoordeling. Ja door naar bouwdepot ondertekening. Nee alternatieve financiering.",
                source_text: "IF svn_geaccepteerd = true THEN step_13 ELSE step_12 [step_11_svn_geaccepteerd_check]",
                source_file: "step_11_svn_geaccepteerd_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-12",
                label: "Andere Fin. (SVN)",
                category: "process",
                description: "Alternatieve financieringsroute na SVN afwijzing. Klant terug naar financieringskeuze of naar top-level alternatief.",
                source_text: "SVN niet mogelijk of afgewezen andere financiering [step_12_andere_financiering_svn_check]",
                source_file: "step_12_andere_financiering_svn_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-13",
                label: "Bouwdepot Tekenen",
                category: "finance",
                description: "Ondertekening bouwdepot overeenkomst met klant na SVN akkoord. Juridisch bindende stap.",
                source_text: "Ondertekening bouwdepot na SVN akkoord. [step_13_ondertekening_bouwdepot]",
                source_file: "step_13_ondertekening_bouwdepot.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-14",
                label: "Check-in Call",
                category: "customer",
                description: "Telefonische check-in met klant na SVN goedkeuring en bouwdepot. Afstemming planning en verwachtingen.",
                source_text: "Check-in call met klant na afronding financiering SVN pad. [step_14_check_in_call]",
                source_file: "step_14_check_in_call.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── L&S PAD ───────────────────────────────────────────────────────────────
            {
                id: "vlt-15",
                label: "L&S Aanvraag",
                category: "process",
                description: "Lender & Spender aanvraag starten. Klant eligibility checken, aanvraagformulier invullen.",
                source_text: "L&S aanvraag starten zodra financieringsvorm = L&S. [step_15_ls_aanvraag_starten]",
                source_file: "step_15_ls_aanvraag_starten.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-16",
                label: "L&S Looptijd",
                category: "compliance",
                description: "Controle gewenste looptijd van de L&S lening. Bepaalt product en rente.",
                source_text: "Looptijd check voor L&S product selectie. [step_16_ls_looptijd_check]",
                source_file: "step_16_ls_looptijd_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-17",
                label: "L&S Gegevens",
                category: "process",
                description: "Klantgegevens invullen in L&S portaal: IBAN, BSN, inkomen, dienstverband, productconfiguratie.",
                source_text: "Klantgegevens invullen in L&S systeem, inclusief bankgegevens en persoonsinformatie. [step_17_ls_gegevens_invullen]",
                source_file: "step_17_ls_gegevens_invullen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-18",
                label: "L&S Bevestigen",
                category: "process",
                description: "Definitieve bevestiging van de L&S aanvraag na alle gegevens compleet. Klant geeft akkoord.",
                source_text: "Definitieve aanvraagbevestiging versturen naar L&S portaal. [step_18_ls_aanvraag_bevestigen]",
                source_file: "step_18_ls_aanvraag_bevestigen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-19",
                label: "L&S Beoordeling",
                category: "finance",
                description: "Externe L&S kredietbeoordeling. Gemiddeld 3-7 werkdagen. Automatisch + handmatig oordeel.",
                source_text: "L&S beoordeelt kredietaanvraag. Doorlooptijd 3-7 werkdagen. [step_19_ls_beoordeling]",
                source_file: "step_19_ls_beoordeling.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-20",
                label: "L&S Goedgekeurd?",
                category: "compliance",
                description: "Uitkomst L&S kredietbeoordeling. Goedgekeurd doorgaan. Afgewezen andere financieringsroute.",
                source_text: "IF ls_goedgekeurd = true THEN doorgaan ELSE step_21 [step_20_ls_goedgekeurd_check]",
                source_file: "step_20_ls_goedgekeurd_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-21",
                label: "Andere Fin. (L&S)",
                category: "process",
                description: "Alternatieve financieringsroute na L&S afwijzing. Check of alternatief beschikbaar.",
                source_text: "L&S afgewezen andere financiering route [step_21_andere_financiering_ls_check]",
                source_file: "step_21_andere_financiering_ls_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-22",
                label: "Alternatief Check",
                category: "compliance",
                description: "Controle of er een alternatieve financieringsroute beschikbaar is voor de klant.",
                source_text: "Alternatief financieringscheck na meerdere afwijzingen [step_22_alternatief_financiering_check]",
                source_file: "step_22_alternatief_financiering_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-23",
                label: "Ander Fin. Mogelijk?",
                category: "compliance",
                description: "Laatste check of er nog een financieringsoptie is. Nee annuleringsroute.",
                source_text: "IF ander_financiering_mogelijk = true THEN verder ELSE annulering [step_23]",
                source_file: "step_23_ander_financiering_mogelijk_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-24",
                label: "Klant Vragen",
                category: "customer",
                description: "Klant beantwoordt aanvullende vragen van financieringspartij of backoffice voor besluitvorming.",
                source_text: "Klant beantwoordt vragen aanvullende informatie voor financieringsbeoordeling [step_24]",
                source_file: "step_24_klant_beantwoordt_vragen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── WARMTEFONDS PAD ──────────────────────────────────────────────────────
            {
                id: "vlt-25",
                label: "Eerste Call (check-in)",
                category: "customer",
                description: "Telefonisch check-in contact wanneer WF account nog niet geactiveerd is. Klant herinneren en begeleiden bij het voltooien van de accountactivatie in het WF portaal.",
                source_text: "Eerste call check-in bij niet geactiveerd WF account — begeleiding activeringsstap [step_25_wf_checkin]",
                source_file: "step_25_wf_eerste_call.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-26",
                label: "WF Account Activeren",
                category: "process",
                description: "Stap 1 WF: Klant activeert WF account online. Backoffice begeleidt het proces via portal.",
                source_text: "WF stap 1 klant account activeren in WF portaal [step_26_wf_stap1_account_activeren]",
                source_file: "step_26_wf_stap1_account_activeren.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-27",
                label: "WF Account Actief?",
                category: "compliance",
                description: "Check of WF account succesvol geactiveerd is. Nee opvolgen klant.",
                source_text: "IF wf_account_geactiveerd = true THEN stap_2 ELSE opvolgen [step_27]",
                source_file: "step_27_wf_account_geactiveerd_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-28",
                label: "WF Klant Opvolgen A",
                category: "customer",
                description: "Klantopvolging bij WF account activatie probleem. Belpogingen en herinneringsmails.",
                source_text: "Klant opvolgen voor WF account activatie, herbeltraject [step_28_wf_klant_opvolgen_a]",
                source_file: "step_28_wf_klant_opvolgen_a.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-29",
                label: "WF Status Check",
                category: "process",
                description: "Stap 2 WF: Controle aanvraagstatus in WF portaal. Beoordelingsresultaat ophalen.",
                source_text: "WF stap 2 status check aanvraag in portaal [step_29_wf_stap2_status_check]",
                source_file: "step_29_wf_stap2_status_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-30",
                label: "WF Status OK?",
                category: "compliance",
                description: "Is de WF aanvraagstatus positief? Nee klant opvolgen B.",
                source_text: "IF wf_status_ok = true THEN stap_3 ELSE opvolgen_b [step_30_wf_status_ok_check]",
                source_file: "step_30_wf_status_ok_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-31",
                label: "WF Klant Opvolgen B",
                category: "customer",
                description: "Klantopvolging bij WF status probleem. Escalatie mogelijk.",
                source_text: "Klant opvolgen bij WF status knelpunt [step_31_wf_klant_opvolgen_b]",
                source_file: "step_31_wf_klant_opvolgen_b.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-32",
                label: "WF Documenten A",
                category: "process",
                description: "Stap 3a WF: Controle of alle benodigde documenten al beschikbaar zijn.",
                source_text: "WF stap 3 controle documenten volledigheid deel A [step_32]",
                source_file: "step_32_wf_stap3_documenten_compleet_a.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-33",
                label: "Documenten Compleet?",
                category: "compliance",
                description: "Zijn alle verplichte documenten aanwezig? Nee document maakproces starten.",
                source_text: "IF documenten_compleet = true THEN check_b ELSE documenten_maken [step_33]",
                source_file: "step_33_wf_documenten_compleet_check_a.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-38",
                label: "Documenten Maken",
                category: "process",
                description: "Ontbrekende documenten aanmaken of opvragen bij klant/leverancier.",
                source_text: "WF stap 3 ontbrekende documenten maken of opvragen [step_38]",
                source_file: "step_38_wf_stap3_documenten_maken.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-39",
                label: "Documenten Check B",
                category: "compliance",
                description: "Definitieve check of documenten nu compleet zijn na maken/opvragen.",
                source_text: "IF documenten_compleet_b = true THEN accountmgmt ELSE opnieuw [step_39]",
                source_file: "step_39_wf_documenten_compleet_check_b.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-40",
                label: "Accountmgmt Call",
                category: "customer",
                description: "Accountmanagement call met klant afstemming voortgang WF aanvraag en verwachtingen.",
                source_text: "Accountmanagement call voor WF traject afstemming [step_40_accountmanagement_call]",
                source_file: "step_40_accountmanagement_call.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-41",
                label: "WF Financieel Oordeel",
                category: "finance",
                description: "Stap 4 WF: Externe financiele beoordeling door Nationaal Warmtefonds. Gemiddeld 10-15 werkdagen.",
                source_text: "WF stap 4 financiele beoordeling door WF extern [step_41_wf_stap4_financiele_beoordeling]",
                source_file: "step_41_wf_stap4_financiele_beoordeling.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-42",
                label: "Aanvullende Vragen?",
                category: "compliance",
                description: "Stelt WF aanvullende vragen? Ja klant laten beantwoorden.",
                source_text: "IF wf_aanvullende_vragen = true THEN klant_vragen ELSE wf_akkoord [step_42]",
                source_file: "step_42_aanvullende_vragen_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-43",
                label: "WF Akkoord?",
                category: "compliance",
                description: "Definitief WF akkoord op financieringsaanvraag. Ja aanbetalingsfactuur. Nee alternatief.",
                source_text: "IF wf_akkoord = true THEN aanbetalingsfactuur ELSE andere_financiering [step_43_wf_akkoord_check]",
                source_file: "step_43_wf_akkoord_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── EIGEN MIDDELEN ────────────────────────────────────────────────────────
            {
                id: "vlt-34",
                label: "Eigen Middelen",
                category: "finance",
                description: "Klant betaalt volledig uit eigen middelen. Geen externe financiering nodig. Direct naar werkvoorbereiding.",
                source_text: "Eigen middelen klant betaalt zelf, geen financieringspartij nodig [step_34_eigen_middelen]",
                source_file: "step_34_eigen_middelen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── ANDERE FINANCIERING TOP ───────────────────────────────────────────────
            {
                id: "vlt-35",
                label: "Andere Financiering?",
                category: "compliance",
                description: "Top-level check na falen alle primaire financieringsroutes. Kan klant nog ergens anders terecht?",
                source_text: "IF andere_financiering_mogelijk = true THEN route ELSE annulering [step_35]",
                source_file: "step_35_andere_financiering_top_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-36",
                label: "Annulering Verwerken A",
                category: "compliance",
                description: "Annulering verwerken na mislukken financieringsroutes. Annuleringsprocedure opstarten.",
                source_text: "Annulering verwerken na financieringsfailure step_36_annulering_verwerken_a",
                source_file: "step_36_annulering_verwerken_a.md",
                role: "end",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-37",
                label: "Klant Opvolgen",
                category: "customer",
                description: "Hoofdlijn klantopvolging. Wordt vanuit meerdere routes aangeroepen. Kernschakel in klantcommunicatie.",
                source_text: "Klant opvolgen hoofdlane meerdere routes leiden hierheen [step_37_klant_opvolgen_hoofd]",
                source_file: "step_37_klant_opvolgen_hoofd.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            // ── NA FINANCIERING AKKOORD ───────────────────────────────────────────────
            {
                id: "vlt-44",
                label: "Aanbetalingsfactuur",
                category: "finance",
                description: "Aanbetalingsfactuur versturen naar klant na financiering akkoord. Eerste financiele transactie.",
                source_text: "Aanbetalingsfactuur versturen na financieringsgoedkeuring [step_44_aanbetalingsfactuur_versturen]",
                source_file: "step_44_aanbetalingsfactuur_versturen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-45",
                label: "Aanbetaling Betaald?",
                category: "finance",
                description: "Is de aanbetaling door de klant ontvangen? Nee factuur opvolgen.",
                source_text: "IF aanbetaling_betaald = true THEN werkvoorbereiding ELSE factuur_opvolgen [step_45]",
                source_file: "step_45_aanbetaling_betaald_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-46",
                label: "Factuur Opvolgen 1",
                category: "finance",
                description: "Opvolging openstaande aanbetalingsfactuur. Herinneringen sturen, telefonisch contact.",
                source_text: "Factuur opvolgen: aanbetaling herinneringen en telefonisch contact [step_46_factuur_opvolgen_aanbetaling]",
                source_file: "step_46_factuur_opvolgen_aanbetaling.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── WERKVOORBEREIDING (KRITIEKE HUB) ─────────────────────────────────────
            {
                id: "vlt-47",
                label: "Werkvoorbereiding",
                category: "process",
                description: "Technische beoordeling installatie op basis van fotos, offerte en productscope. Werkbon aanmaken in ERP. Kritiekste bottleneck van het proces.",
                source_text: "Open werkbon in ERP. Controleer fotos, offerte, productconfiguratie. Technisch akkoord bepalen. Schouw indien nodig. [step_47_werkvoorbereiding]",
                source_file: "step_47_werkvoorbereiding.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-48",
                label: "Technisch Akkoord?",
                category: "compliance",
                description: "Is de installatie technisch haalbaar na werkvoorbereiding? Nee terugkoppeling klant, eventueel nieuwe offerte.",
                source_text: "Technisch akkoord check na werkvoorbereiding [step_48_technisch_akkoord_check]",
                source_file: "step_48_technisch_akkoord_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-49",
                label: "Planning",
                category: "process",
                description: "Installatie inplannen met klant en monteursagenda. Materiaal bestellen, datum bevestigen.",
                source_text: "Planning installatie: monteur, klant, materiaalinschatting, datum [step_49_planning]",
                source_file: "step_49_planning.md",
                role: "bottleneck",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-50",
                label: "Datum Akkoord?",
                category: "customer",
                description: "Klant akkoord met geplande installatiedatum? Nee aanpassen contact of nieuwe afspraak.",
                source_text: "IF installatiedatum_akkoord = true THEN installatie ELSE aanpassen [step_50]",
                source_file: "step_50_installatiedatum_akkoord_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-51",
                label: "Klantcontact Aanpassen",
                category: "customer",
                description: "Klantcontactgegevens of afspraakdetails aanpassen bij planningsprobleem.",
                source_text: "Aanpassen klantcontact bij planningsissue [step_51_aanpassen_klantcontact]",
                source_file: "step_51_aanpassen_klantcontact.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-52",
                label: "Nieuwe Afspraak",
                category: "customer",
                description: "Nieuwe afspraak plannen wanneer oorspronkelijke datum niet akkoord was.",
                source_text: "Nieuwe afspraak plannen [step_52_nieuwe_afspraak_plannen]",
                source_file: "step_52_nieuwe_afspraak_plannen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── INSTALLATIE ───────────────────────────────────────────────────────────
            {
                id: "vlt-53",
                label: "Installatie",
                category: "process",
                description: "Fysieke installatie van zonnepanelen/warmtepomp/batterij bij klant thuis. Monteur voert uit.",
                source_text: "Installatie uitvoeren door monteur op geplande datum [step_53_installatie]",
                source_file: "step_53_installatie.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-54",
                label: "Installatie Geslaagd?",
                category: "compliance",
                description: "Is de installatie succesvol afgerond? Nee service/herstel door monteur.",
                source_text: "IF installatie_geslaagd = true THEN klant_tevreden_check ELSE service_herstel [step_54]",
                source_file: "step_54_installatie_geslaagd_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-55",
                label: "Service/Herstel",
                category: "process",
                description: "Herstel of service na mislukte installatie. Monteur keert terug voor correctie.",
                source_text: "Service herstel installatie monteur keert terug [step_55_service_herstel_installatie]",
                source_file: "step_55_service_herstel_installatie.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-56",
                label: "Monteur Pakt Op",
                category: "process",
                description: "Monteur pakt service of aandachtspunt op. Terugkoppeling na afhandeling.",
                source_text: "Monteur pakt aandachtspunt op en lost op [step_56_monteur_pakt_op]",
                source_file: "step_56_monteur_pakt_op.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── BILLING & AFRONDING ───────────────────────────────────────────────────
            {
                id: "vlt-57",
                label: "Billing Issue?",
                category: "finance",
                description: "Controle op facturatiefouten na installatie. Correctie nodig?",
                source_text: "IF billing_issue = true THEN service_correctie_billing ELSE happy_call [step_57]",
                source_file: "step_57_billing_issue_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-58",
                label: "Billing Correctie",
                category: "finance",
                description: "Correctie van facturatiefouten na installatie. Aanpassing in ERP en communicatie klant.",
                source_text: "Service correctie billing aanpassen factuur in ERP [step_58_service_correctie_billing]",
                source_file: "step_58_service_correctie_billing.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-59",
                label: "Factuur Opvolgen 2",
                category: "finance",
                description: "Opvolging openstaande factuur na billing correctie.",
                source_text: "Factuur opvolgen billing correctie [step_59_factuur_opvolgen_billing]",
                source_file: "step_59_factuur_opvolgen_billing.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-60",
                label: "Happy Call",
                category: "customer",
                description: "Kwaliteitscheck call met klant na installatie. Tevredenheidscheck en afronding dossier.",
                source_text: "Happy call tevredenheidscheck na geslaagde installatie [step_60_happy_call]",
                source_file: "step_60_happy_call.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-61",
                label: "Klant Tevreden?",
                category: "customer",
                description: "Is klant tevreden na happy call? Ja nabetalingsfactuur. Nee actie ondernemen.",
                source_text: "IF klant_tevreden = true THEN nabetalingsfactuur ELSE actie [step_61_klant_tevreden_check]",
                source_file: "step_61_klant_tevreden_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-62",
                label: "Nabetalingsfactuur",
                category: "finance",
                description: "Nabetalingsfactuur versturen naar klant na succesvolle installatie en happy call.",
                source_text: "Nabetalingsfactuur versturen na happy call akkoord [step_62_nabetalingsfactuur_versturen]",
                source_file: "step_62_nabetalingsfactuur_versturen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-63",
                label: "Nabetaling Betaald?",
                category: "finance",
                description: "Is de nabetalingsfactuur ontvangen? Nee factuur opvolgen.",
                source_text: "IF nabetaling_betaald = true THEN thuisbatterij_check ELSE opvolgen [step_63]",
                source_file: "step_63_nabetaling_betaald_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-64",
                label: "Factuur Opvolgen 3",
                category: "finance",
                description: "Opvolging openstaande nabetalingsfactuur.",
                source_text: "Factuur opvolgen: nabetaling [step_64_factuur_opvolgen_nabetaling]",
                source_file: "step_64_factuur_opvolgen_nabetaling.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            // ── UPSELL & AFSLUITING ───────────────────────────────────────────────────
            {
                id: "vlt-65",
                label: "Thuisbatterij Check",
                category: "customer",
                description: "Wordt klant geinteresseerd in thuisbatterij als upsell? Ja energie verkopen.",
                source_text: "IF klant_wil_thuisbatterij = true THEN energie_verkopen ELSE referral [step_65]",
                source_file: "step_65_thuisbatterij_check.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-66",
                label: "Energie Verkopen",
                category: "product",
                description: "Klant doorsturen naar energie verkooppad (Flowchart Next Energy). Upsell kans.",
                source_text: "Flowchart Next Energy (Lucidchart) step_66 [step_66_naar_energie_verkopen]",
                source_file: "step_66_naar_energie_verkopen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-67",
                label: "Referral Sturen",
                category: "customer",
                description: "Referralaanvraag sturen naar tevreden klant. Mond-tot-mondreclame stimuleren.",
                source_text: "Referral sturen naar klant [step_67_referral_sturen]",
                source_file: "step_67_referral_sturen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-68",
                label: "Overige Zaken",
                category: "process",
                description: "Afhandeling van eventuele openstaande administratieve of organisatorische zaken.",
                source_text: "Overige zaken regelen voor dossierafsluiting [step_68_overige_zaken_regelen]",
                source_file: "step_68_overige_zaken_regelen.md",
                role: "normal",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-69",
                label: "Annulering B",
                category: "compliance",
                description: "Tweede annuleringsverwerkingspunt bij mislukken alternatieve financiering of klant wil stoppen.",
                source_text: "Annulering verwerken B na alternatieven uitgeput [step_69_annulering_verwerken_b]",
                source_file: "step_69_annulering_verwerken_b.md",
                role: "end",
                health: 100, kpis: [], measurements: []
            },
            {
                id: "vlt-70",
                label: "Dossier Afgerond",
                category: "process",
                description: "Eindpunt: alle processtappen doorlopen, dossier volledig gesloten. Klant succesvol bediend.",
                source_text: "Eindstap geen volgende stap. Dossier volledig gesloten. [step_70_dossier_afgerond]",
                source_file: "step_70_dossier_afgerond.md",
                role: "end",
                health: 100, kpis: [], measurements: []
            }
        ];
    }

    // =========================================================================
    // EDGES — volledig gebaseerd op Next Steps Map uit Demo MD bestanden
    // =========================================================================
    function _buildEdges() {
        return [
            // Support relaties rollen/systemen
            { from: "rol-closer",    to: "vlt-02",  label: "overdracht",             type: "sequential",  weight: 1 },
            { from: "rol-backoffice",to: "vlt-47",  label: "verantwoordelijk",       type: "sequential",  weight: 1 },
            { from: "sys-erp",       to: "vlt-47",  label: "werkbon aanmaken",       type: "dependency",  weight: 2 },
            { from: "sys-svn",       to: "vlt-07",  label: "portaal",                type: "dependency",  weight: 2 },
            { from: "sys-ls",        to: "vlt-15",  label: "aanvraagportaal",        type: "dependency",  weight: 2 },
            { from: "sys-wf",        to: "vlt-25",  label: "WF portaal",             type: "dependency",  weight: 2 },
            // Kernflow
            { from: "vlt-01", to: "vlt-02",  label: "start",                  type: "sequential",  weight: 3 },
            { from: "vlt-02", to: "vlt-03",  label: "deal gewonnen",           type: "sequential",  weight: 3 },
            { from: "vlt-03", to: "vlt-04",  label: "wil annuleren",           type: "sequential",  weight: 1 },
            { from: "vlt-03", to: "vlt-05",  label: "geen annulering",         type: "sequential",  weight: 3 },
            { from: "vlt-04", to: "vlt-36",  label: "annuleringsproces",       type: "reference",   weight: 1 },
            // SVN pad
            { from: "vlt-05", to: "vlt-06",  label: "SVN route",               type: "sequential",  weight: 2 },
            { from: "vlt-06", to: "vlt-07",  label: "SVN mogelijk",            type: "sequential",  weight: 2 },
            { from: "vlt-06", to: "vlt-12",  label: "SVN niet mogelijk",       type: "sequential",  weight: 1 },
            { from: "vlt-07", to: "vlt-08",  label: "brief ontvangen",         type: "sequential",  weight: 2 },
            { from: "vlt-08", to: "vlt-09",  label: "brief correct",           type: "sequential",  weight: 2 },
            { from: "vlt-08", to: "vlt-07",  label: "brief fout — opnieuw",    type: "feedback",    weight: 1 },
            { from: "vlt-09", to: "vlt-10",  label: "aanvraag ingediend",      type: "sequential",  weight: 2 },
            { from: "vlt-10", to: "vlt-11",  label: "beoordeling klaar",       type: "sequential",  weight: 2 },
            { from: "vlt-11", to: "vlt-13",  label: "SVN akkoord",             type: "sequential",  weight: 2 },
            { from: "vlt-11", to: "vlt-12",  label: "SVN afgewezen",           type: "sequential",  weight: 1 },
            { from: "vlt-12", to: "vlt-35",  label: "andere financiering",     type: "sequential",  weight: 1 },
            { from: "vlt-13", to: "vlt-14",  label: "bouwdepot getekend",      type: "sequential",  weight: 2 },
            { from: "vlt-14", to: "vlt-44",  label: "check-in call klaar",     type: "sequential",  weight: 2 },
            // L&S pad
            { from: "vlt-05", to: "vlt-15",  label: "L&S route",               type: "sequential",  weight: 2 },
            { from: "vlt-15", to: "vlt-16",  label: "aanvraag gestart",        type: "sequential",  weight: 2 },
            { from: "vlt-16", to: "vlt-17",  label: "looptijd gekozen",        type: "sequential",  weight: 2 },
            { from: "vlt-17", to: "vlt-18",  label: "gegevens ingevuld",       type: "sequential",  weight: 2 },
            { from: "vlt-18", to: "vlt-19",  label: "aanvraag bevestigd",      type: "sequential",  weight: 2 },
            { from: "vlt-19", to: "vlt-20",  label: "beoordeling klaar",       type: "sequential",  weight: 2 },
            { from: "vlt-20", to: "vlt-44",  label: "L&S akkoord",             type: "sequential",  weight: 2 },
            { from: "vlt-20", to: "vlt-21",  label: "L&S afgewezen",           type: "sequential",  weight: 1 },
            { from: "vlt-21", to: "vlt-22",  label: "alternatief check",       type: "sequential",  weight: 1 },
            { from: "vlt-22", to: "vlt-23",  label: "mogelijk?",               type: "sequential",  weight: 1 },
            { from: "vlt-22", to: "vlt-24",  label: "klant beantwoordt vragen", type: "sequential", weight: 1 },
            { from: "vlt-23", to: "vlt-35",  label: "naar top alternatief",    type: "reference",   weight: 1 },
            { from: "vlt-24", to: "vlt-19",  label: "vragen beantwoord",       type: "feedback",    weight: 1 },
            // Warmtefonds pad
            { from: "vlt-05", to: "vlt-26",  label: "WF route",                type: "sequential",  weight: 2 },
            { from: "vlt-25", to: "vlt-28",  label: "klant opvolgen WF",        type: "sequential",  weight: 1 },
            { from: "vlt-26", to: "vlt-27",  label: "activatie geprobeerd",    type: "sequential",  weight: 2 },
            { from: "vlt-27", to: "vlt-29",  label: "account actief",          type: "sequential",  weight: 2 },
            { from: "vlt-27", to: "vlt-25",  label: "niet actief — eerste call",type: "sequential",  weight: 1 },
            { from: "vlt-28", to: "vlt-26",  label: "herstart WF stap 1",       type: "feedback",    weight: 1 },
            { from: "vlt-29", to: "vlt-30",  label: "status gecheckt",         type: "sequential",  weight: 2 },
            { from: "vlt-30", to: "vlt-32",  label: "status OK",               type: "sequential",  weight: 2 },
            { from: "vlt-30", to: "vlt-31",  label: "status NOK — opvolgen",   type: "sequential",  weight: 1 },
            { from: "vlt-31", to: "vlt-29",  label: "opvolging hercheck",      type: "feedback",    weight: 1 },
            { from: "vlt-32", to: "vlt-33",  label: "documenten gecheckt",     type: "sequential",  weight: 2 },
            { from: "vlt-33", to: "vlt-40",  label: "compleet",                type: "sequential",  weight: 2 },
            { from: "vlt-33", to: "vlt-38",  label: "niet compleet — maken",   type: "sequential",  weight: 1 },
            { from: "vlt-38", to: "vlt-39",  label: "documenten gemaakt",      type: "sequential",  weight: 2 },
            { from: "vlt-39", to: "vlt-40",  label: "compleet na maken",       type: "sequential",  weight: 2 },
            { from: "vlt-39", to: "vlt-38",  label: "nog niet compleet",       type: "feedback",    weight: 1 },
            { from: "vlt-40", to: "vlt-41",  label: "call gedaan",             type: "sequential",  weight: 2 },
            { from: "vlt-41", to: "vlt-42",  label: "beoordeling gedaan",      type: "sequential",  weight: 2 },
            { from: "vlt-42", to: "vlt-24",  label: "aanvullende vragen",      type: "sequential",  weight: 1 },
            { from: "vlt-42", to: "vlt-43",  label: "geen vragen — akkoord?",  type: "sequential",  weight: 2 },
            { from: "vlt-43", to: "vlt-44",  label: "WF akkoord",              type: "sequential",  weight: 2 },
            { from: "vlt-43", to: "vlt-35",  label: "WF afgewezen",            type: "sequential",  weight: 1 },
            // Eigen middelen
            { from: "vlt-05", to: "vlt-34",  label: "eigen middelen route",    type: "sequential",  weight: 1 },
            { from: "vlt-34", to: "vlt-44",  label: "eigen middelen bevestigd", type: "sequential", weight: 2 },
            // Andere financiering top
            { from: "vlt-35", to: "vlt-37",  label: "klant opvolgen",          type: "sequential",  weight: 1 },
            { from: "vlt-35", to: "vlt-36",  label: "geen alternatief",        type: "sequential",  weight: 1 },
            { from: "vlt-37", to: "vlt-05",  label: "terug naar financiering", type: "feedback",    weight: 1 },
            // Aanbetaling
            { from: "vlt-44", to: "vlt-45",  label: "factuur verstuurd",       type: "sequential",  weight: 2 },
            { from: "vlt-45", to: "vlt-47",  label: "betaald",                 type: "sequential",  weight: 3 },
            { from: "vlt-45", to: "vlt-46",  label: "niet betaald — opvolgen", type: "sequential",  weight: 1 },
            { from: "vlt-46", to: "vlt-45",  label: "opvolging hercheck",      type: "feedback",    weight: 1 },
            // Werkvoorbereiding
            { from: "vlt-47", to: "vlt-48",  label: "technische analyse klaar", type: "sequential", weight: 3 },
            { from: "vlt-48", to: "vlt-49",  label: "technisch akkoord",       type: "sequential",  weight: 3 },
            { from: "vlt-48", to: "vlt-47",  label: "niet akkoord — herwerk",  type: "feedback",    weight: 1 },
            // Planning & installatie
            { from: "vlt-49", to: "vlt-50",  label: "planning klaar",          type: "sequential",  weight: 3 },
            { from: "vlt-50", to: "vlt-53",  label: "datum akkoord",           type: "sequential",  weight: 3 },
            { from: "vlt-50", to: "vlt-51",  label: "datum niet akkoord",      type: "sequential",  weight: 1 },
            { from: "vlt-51", to: "vlt-52",  label: "aanpassing nodig",        type: "sequential",  weight: 1 },
            { from: "vlt-52", to: "vlt-49",  label: "nieuwe afspraak — opnieuw", type: "feedback",  weight: 1 },
            { from: "vlt-53", to: "vlt-54",  label: "installatie uitgevoerd",  type: "sequential",  weight: 3 },
            { from: "vlt-54", to: "vlt-61",  label: "geslaagd — klant check",  type: "sequential",  weight: 3 },
            { from: "vlt-54", to: "vlt-55",  label: "niet geslaagd — herstel", type: "sequential",  weight: 1 },
            { from: "vlt-55", to: "vlt-56",  label: "service nodig",           type: "sequential",  weight: 1 },
            { from: "vlt-56", to: "vlt-54",  label: "herstel hercheck",        type: "feedback",    weight: 1 },
            // Billing & afronding (volgorde conform PDF: install → klant tevreden? → happy call → billing check → nabetaling)
            { from: "vlt-61", to: "vlt-60",  label: "tevreden — happy call",   type: "sequential",  weight: 3 },
            { from: "vlt-61", to: "vlt-58",  label: "niet tevreden — correctie",type: "sequential", weight: 1 },
            { from: "vlt-60", to: "vlt-57",  label: "happy call — billing check",type: "sequential", weight: 2 },
            { from: "vlt-57", to: "vlt-62",  label: "geen billing issue",      type: "sequential",  weight: 3 },
            { from: "vlt-57", to: "vlt-58",  label: "billing correctie nodig", type: "sequential",  weight: 1 },
            { from: "vlt-58", to: "vlt-59",  label: "correctie gedaan",        type: "sequential",  weight: 1 },
            { from: "vlt-59", to: "vlt-60",  label: "factuur correct — retry", type: "sequential",  weight: 1 },
            { from: "vlt-62", to: "vlt-63",  label: "factuur verstuurd",       type: "sequential",  weight: 3 },
            { from: "vlt-63", to: "vlt-65",  label: "nabetaling ontvangen",    type: "sequential",  weight: 3 },
            { from: "vlt-63", to: "vlt-64",  label: "niet betaald — opvolgen", type: "sequential",  weight: 1 },
            { from: "vlt-64", to: "vlt-63",  label: "opvolging hercheck",      type: "feedback",    weight: 1 },
            // Upsell & afsluiting
            { from: "vlt-65", to: "vlt-66",  label: "thuisbatterij interesse", type: "sequential",  weight: 1 },
            { from: "vlt-65", to: "vlt-67",  label: "geen interesse — referral", type: "sequential", weight: 2 },
            { from: "vlt-66", to: "vlt-67",  label: "energie pad doorlopen",   type: "sequential",  weight: 1 },
            { from: "vlt-67", to: "vlt-68",  label: "referral verstuurd",      type: "sequential",  weight: 2 },
            { from: "vlt-68", to: "vlt-70",  label: "overige zaken klaar",     type: "sequential",  weight: 3 },
            { from: "vlt-36", to: "vlt-70",  label: "annulering verwerkt",     type: "reference",   weight: 1 },
            { from: "vlt-69", to: "vlt-70",  label: "annulering B verwerkt",   type: "reference",   weight: 1 },
            { from: "vlt-23", to: "vlt-69",  label: "geen ander alternatief",  type: "sequential",  weight: 1 }
        ];
    }

    // =========================================================================
    // SYSTEEM 1D — KRITIEKE ROUTE BEREKENING (DAG Longest Path)
    // Bellman-Ford variant voor DAGs met topologische sort
    // =========================================================================

    /**
     * findCriticalPath(nodes, edges)
     * Berekent de langste gewogen route van start naar eindnode.
     * Negeert feedback edges om te voorkomen dat cycles de DAG verbreken.
     * @param {Array} nodes
     * @param {Array} edges
     * @returns {{ path: string[], nodesOnPath: Set }}
     */
    function findCriticalPath(nodes, edges) {
        var fwdEdges = edges.filter(function (e) { return e.type !== "feedback"; });

        var adj   = {};
        var inDeg = {};
        nodes.forEach(function (n) { adj[n.id] = []; inDeg[n.id] = 0; });
        fwdEdges.forEach(function (e) {
            if (!adj[e.from]) adj[e.from] = [];
            adj[e.from].push({ to: e.to, weight: e.weight || 1 });
            inDeg[e.to] = (inDeg[e.to] || 0) + 1;
        });

        // Kahn topologische sort
        var queue = [];
        var topoOrder = [];
        Object.keys(inDeg).forEach(function (id) { if (inDeg[id] === 0) queue.push(id); });
        while (queue.length > 0) {
            var cur = queue.shift();
            topoOrder.push(cur);
            (adj[cur] || []).forEach(function (nb) {
                inDeg[nb.to]--;
                if (inDeg[nb.to] === 0) queue.push(nb.to);
            });
        }

        // Longest path via topological order
        var dist = {};
        var prev = {};
        nodes.forEach(function (n) { dist[n.id] = 0; prev[n.id] = null; });
        topoOrder.forEach(function (id) {
            (adj[id] || []).forEach(function (nb) {
                var d = dist[id] + (nb.weight || 1);
                if (d > (dist[nb.to] || 0)) {
                    dist[nb.to] = d;
                    prev[nb.to] = id;
                }
            });
        });

        // Eindpunt met max afstand
        var maxDist = -1, endNode = null;
        nodes.forEach(function (n) {
            if (dist[n.id] > maxDist) { maxDist = dist[n.id]; endNode = n.id; }
        });

        // Reconstrueer pad
        var path = [];
        var c = endNode;
        while (c !== null) { path.unshift(c); c = prev[c]; }

        return { path: path, nodesOnPath: new Set(path) };
    }

    // =========================================================================
    // SYSTEEM 1E — DEMO KNOP — polling + direct save + node intelligence
    // =========================================================================

    function initDemoButton() {
        function _tryAttach() {
            if (document.getElementById("demo-load-btn")) return;
            var toolbar = document.getElementById("ng-toolbar");
            if (!toolbar) { setTimeout(_tryAttach, 200); return; }

            var sep = document.createElement("div");
            sep.className = "ng-tb-sep";
            toolbar.appendChild(sep);

            var btn = document.createElement("button");
            btn.id = "demo-load-btn";
            btn.className = "ng-tb-btn";
            btn.title = "Laad Voltera Demo Graph";
            var icon = document.createElement("i");
            icon.setAttribute("data-lucide", "play-circle");
            btn.appendChild(icon);
            btn.addEventListener("click", _onDemoClick);
            toolbar.appendChild(btn);
            if (window.lucide) window.lucide.createIcons();
        }

        function _onDemoClick() {
            var confirmed = window.confirm(
                "Demo graph laden?\n\n" +
                "Vervangt huidige graph met Voltera Backoffice proces:\n" +
                "67 nodes, 95 edges, kritieke route gemarkeerd.\n\n" +
                "Na laden kun je direct vragen stellen aan de AI chat."
            );
            if (!confirmed) return;
            if (!window.NeuralGraph) { alert("NeuralGraph is nog niet gereed."); return; }
            _executeLoad();
        }

        function _executeLoad() {
            var data = loadDemoGraph();
            window.NeuralGraph.loadData(data);

            fetch("/graph/save", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    nodes: data.nodes,
                    edges: data.edges,
                    meta:  { source_files: ["Demo/steps/*"], critical_path: data.criticalPath }
                })
            })
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                if (window.NeuralGraphUI && window.NeuralGraphUI.showToast) {
                    window.NeuralGraphUI.showToast(
                        "Voltera demo geladen — " + data.nodes.length + " nodes, " + data.edges.length + " edges",
                        "success"
                    );
                }
                if (window.NodeIntelligence) {
                    window.NodeIntelligence.analyzeGraph(data);
                    window.NodeIntelligence.applyAll();
                }
                if (window.NeuralGraphChat && window.NeuralGraphChat.loadSmartQuestions) {
                    setTimeout(function () { window.NeuralGraphChat.loadSmartQuestions(); }, 500);
                }
                document.dispatchEvent(new CustomEvent("demo:loaded", { detail: data }));
            })
            .catch(function (err) {
                console.error("[Demo] Opslaan mislukt:", err);
                if (window.NeuralGraphState && window.NeuralGraphState.markDirty)
                    window.NeuralGraphState.markDirty();
            });
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function () { setTimeout(_tryAttach, 300); });
        } else {
            setTimeout(_tryAttach, 300);
        }
    }

    // =========================================================================
    // SYNTHETISCHE FALLBACK GENERATOR
    // =========================================================================
    var _CATS = ["product","customer","process","compliance","finance"];
    var _PFXS = { product:["Module","Service","Product","Component","System"], customer:["Segment","Client","Account","Partner","Prospect"], process:["Step","Phase","Stage","Flow","Workflow"], compliance:["Regulation","Policy","Rule","Standard","Directive"], finance:["Fund","Budget","Revenue","Cost","Capital"] };
    var _ELBL = ["leidt tot","bevat","verbindt","reguleert","triggert","afhankelijk van"];
    var _DTPL = { product:"Productcomponent {label} met {n} configuraties", customer:"Klantsegment {label} — {n} accounts", process:"Processtap {label}, {n}/dag", compliance:"Regelgeving {label}, {n} entiteiten", finance:"Financieel {label} €{n}K" };

    function _rng(seed) {
        var s = seed >>> 0;
        return function () { s += 0x6D2B79F5; var r = Math.imul(s^(s>>>15),1|s); r^=r+Math.imul(r^(r>>>7),61|r); return ((r^(r>>>14))>>>0)/4294967296; };
    }
    function _pick(a, r) { return a[Math.floor(r()*a.length)]; }
    function _slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,""); }

    function generate(nodeCount, edgeCount) {
        nodeCount = Math.max(2, Math.min(1000, nodeCount||50));
        var tE = edgeCount!=null ? Math.min(edgeCount, nodeCount*(nodeCount-1)/2) : Math.floor(nodeCount*1.5);
        var rand = _rng(nodeCount*31337+(tE||0));
        var nodes=[], edges=[], idSet={}, eSet={};
        for (var i=0;i<nodeCount;i++) {
            var cat=_CATS[i%_CATS.length], lbl=_pick(_PFXS[cat],rand)+" "+(i+1);
            var bid=_slug(lbl), id=idSet[bid]?bid+"_"+i:bid; idSet[id]=true;
            var n=Math.floor(rand()*90)+10;
            nodes.push({id:id,label:lbl,category:cat,description:_DTPL[cat].replace("{label}",lbl).replace("{n}",n),role:"normal",health:100,kpis:[],measurements:[]});
        }
        for (var i2=1;i2<nodeCount;i2++) {
            var j=Math.floor(rand()*i2), key=nodes[j].id+">"+nodes[i2].id;
            if (!eSet[key]) { eSet[key]=true; edges.push({from:nodes[j].id,to:nodes[i2].id,label:_pick(_ELBL,rand),type:"sequential",weight:1}); }
        }
        var att=0;
        while (edges.length<tE && att<tE*4) {
            att++; var a=Math.floor(rand()*nodeCount), b=Math.floor(rand()*nodeCount);
            if (a===b) continue; var k=nodes[a].id+">"+nodes[b].id;
            if (eSet[k]) continue; eSet[k]=true; edges.push({from:nodes[a].id,to:nodes[b].id,label:_pick(_ELBL,rand),type:"sequential",weight:1});
        }
        return {nodes:nodes,edges:edges};
    }

    function load(nodeCount) {
        if (!window.NeuralGraph) return;
        var data = generate(nodeCount, Math.floor(nodeCount*1.6));
        window.NeuralGraph.loadData(data);
        if (window.NeuralGraphState && window.NeuralGraphState.markDirty) window.NeuralGraphState.markDirty();
    }

    function loadDemo() {
        if (!window.NeuralGraph) return;
        var data = loadDemoGraph();
        window.NeuralGraph.loadData(data);
        fetch("/graph/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nodes:data.nodes,edges:data.edges,meta:{source_files:["Demo/steps/*"]}})})
        .then(function(){if(window.NodeIntelligence){window.NodeIntelligence.analyzeGraph(data);window.NodeIntelligence.applyAll();}})
        .catch(function(){if(window.NeuralGraphState&&window.NeuralGraphState.markDirty)window.NeuralGraphState.markDirty();});
        document.dispatchEvent(new CustomEvent("demo:loaded",{detail:data}));
    }

    function _initStats() {
        if (typeof Stats === "undefined") return;
        var stats = new Stats(); stats.showPanel(0); stats.dom.id="ng-stats-panel"; document.body.appendChild(stats.dom);
        function tick(){stats.update();requestAnimationFrame(tick);} requestAnimationFrame(tick);
    }

    document.addEventListener("DOMContentLoaded", function () {
        _initStats();
        window.NeuralGraphTestData = {
            generate: generate, load: load, loadDemo: loadDemo,
            loadDemoGraph: loadDemoGraph, findCriticalPath: findCriticalPath,
            load50: function(){load(50);}, load200: function(){load(200);}, load500: function(){load(500);}
        };
        initDemoButton();
    });

})();
// ✓ testData.js compleet
