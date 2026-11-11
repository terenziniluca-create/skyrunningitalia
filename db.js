const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function readJsonFile(name, fallback = []) {
  const p = path.join(DATA_DIR, name);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.error(`Errore lettura ${p}:`, e);
  }
  return fallback;
}

function writeJsonFile(name, data) {
  const p = path.join(DATA_DIR, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

// Load raw MySQL datasets
const rawClubs = readJsonFile('mysql_clubs.json', []);
const rawChronos = readJsonFile('mysql_chronos.json', []);
const rawMembers = readJsonFile('mysql_members.json', []);
const rawRaces = readJsonFile('mysql_races.json', []);
const rawRequests = readJsonFile('mysql_racerequests.json', []);
const rawNews = readJsonFile('mysql_news.json', []);
const rawUsers = readJsonFile('mysql_users.json', []);
const rawAccounts = readJsonFile('mysql_accounts.json', []);
const rawPayments = readJsonFile('mysql_payments.json', []);
const rawPaymentitems = readJsonFile('mysql_paymentitems.json', []);
const rawPaymentinfos = readJsonFile('mysql_paymentinfos.json', []);
const rawPaymentrequests = readJsonFile('mysql_paymentrequests.json', []);
const rawInvoices = readJsonFile('mysql_invoices.json', []);
const rawWebpages = readJsonFile('mysql_webpages.json', []);
const rawWmembers = readJsonFile('mysql_wmembers.json', []);
const rawMembertypes = readJsonFile('mysql_membertypes.json', []);
const rawFedmembers = readJsonFile('mysql_fedmembers.json', []);
const rawSlugs = readJsonFile('mysql_slugs.json', []);
const rawMenus = readJsonFile('mysql_menus.json', []);
const rawSliders = readJsonFile('mysql_sliders.json', []);
const rawContenitori = readJsonFile('contenitori.json', []);

function saveContenitori(data) {
  if (data && data !== rawContenitori) {
    rawContenitori.length = 0;
    rawContenitori.push(...data);
  }
  writeJsonFile('contenitori.json', rawContenitori);
}
const rawNewsletters = readJsonFile('mysql_newsletters.json', []);
const rawQueueNewsletters = readJsonFile('mysql_queuenewsletters.json', []);
const rawNewsletterSettings = readJsonFile('newsletter_settings.json', {
  societa: true,
  presidenti: false,
  vicepresidenti: false,
  consiglieri_segretari: false,
  tesserati: false,
  manual_active: false,
  manual_emails: '',
  scheduled_active: false,
  scheduled_datetime: ''
});
const rawNewsletterConfigs = readJsonFile('newsletter_custom_configs.json', {});
const calendarioGareList = readJsonFile('mysql_calendario_gare.json', []);
const rawPrezzi = readJsonFile('mysql_prezzi.json', []);
const rawPrezziMeta = readJsonFile('quote_prezzi_meta.json', {
  titolo: "QUOTE FISKY 2026",
  anno: 2026,
  note_piede: [
    "* Il Dirigente non è tesserato come atleta. Chi ricopre il ruolo di dirigente e intende partecipare alle gare come atleta, deve avere il doppio tesseramento (Dirigente e Atleta).",
    "*** I Campionati Italiani Skyrace, Skymarathon e Ultra SkyMarathon devono prevedere un montepremi minimo di € 3.000,00 da assegnare in parti uguali ad almeno 5 uomini e 5 donne. Per il Campionato Italiano Vertical il montepremi è ridotto ad € 2.000,00 da assegnare in parti uguali ad almeno 5 atleti uomini e 5 donne. Come da regolamento accedono alla Classifica del Campioanto Italiano ed al relativo montepremi in denaro, unicamente i tesserati FISKY tramite Società affiliata. Un eventuale montepremi in denaro riservato alla classifica assoluta della gara, non potrà essere superiore a quello riservato al Campionato Italiano, né potrà prevedere la premiazione di un numero maggiore di atleti/e rispetto a quanto previsto dal Campionato Italiano"
  ]
});

// Create Slugs lookup dictionary for Webpages
const webpageSlugMap = {};
rawSlugs.forEach(s => {
  if (s.category === 'Webpage') {
    webpageSlugMap[s.item_id] = s.slug;
  }
});

// Attach authentic slug to each webpage
rawWebpages.forEach(p => {
  if (p.title) p.title = p.title.trim();
  if (webpageSlugMap[p.id]) {
    p.slug = webpageSlugMap[p.id];
  } else if (!p.slug) {
    p.slug = p.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
});

// Ensure Informazioni Corsi page exists
if (!rawWebpages.some(p => p.slug === 'informazioni-corsi')) {
  rawWebpages.push({
    id: 999,
    title: 'Informazioni Corsi',
    slug: 'informazioni-corsi',
    text: '<h3><span style="color:#c0392b"><strong>Scuola Nazionale Settore Istruzione Tecnica &quot;Dario Busi&quot;</strong></span></h3>\n<p><strong>Responsabile Nazionale Formazione: Giuliano Gherardi</strong><br />Email: <a href="mailto:formazione@skyrunningitalia.it">formazione@skyrunningitalia.it</a> - <a href="mailto:corsi@skyrunningitalia.it">corsi@skyrunningitalia.it</a></p>\n<hr />\n<h4>Informazioni Generali sui Corsi Federali FISky</h4>\n<p>La Federazione Italiana Skyrunning (F.I.Sky.) organizza su base annuale corsi di qualificazione e aggiornamento continuo per:</p>\n<ul>\n  <li><strong>Istruttori di Skyrunning di 1° e 2° Livello</strong>: abilitazione tecnica all\'insegnamento della disciplina e della sicurezza in ambiente alpino.</li>\n  <li><strong>Allenatori di Skyrunning</strong>: programmazione dell\'allenamento, fisiologia e biomeccanica dello sforzo ad alta quota.</li>\n  <li><strong>Direttori di Percorso (con CONAGAI e Guide Alpine)</strong>: gestione della sicurezza sul tracciato e nei passaggi tecnici esposti.</li>\n  <li><strong>Direttori di Gara</strong>: coordinamento organizzativo, gestione logistica e protocolli di gara.</li>\n  <li><strong>Giudici di Gara</strong>: vigilanza sui regolamenti ISF/FISky, materiali obbligatori e omologazione classifiche.</li>\n</ul>\n<h4>Iscrizioni e Calendario</h4>\n<p>I bandi e le date di svolgimento vengono comunicati tramite i canali ufficiali della Federazione. Per informazioni su requisiti, quote di partecipazione e iscrizioni alle prossime sessioni, contattare la <strong>Segreteria S.I.T.</strong> all\'indirizzo: <a href="mailto:corsi@skyrunningitalia.it">corsi@skyrunningitalia.it</a>.</p>',
    status: 1
  });
}

// Create Club lookup dictionary
const clubMap = {};
rawClubs.forEach(c => {
  clubMap[c.id] = c.name;
});

// Member types code mapping (letter is 4th char in card number: SKY + LETTER + 6-digit progressive)
const typeCodeMap = {
  1: { code: 'D', name: 'Presidente', category: 'Dirigente' },
  2: { code: 'D', name: 'Vicepresidente', category: 'Dirigente' },
  3: { code: 'D', name: 'Consigliere Dirigente (e/o Segretario)', category: 'Dirigente' },
  4: { code: 'D', name: 'Consigliere Dirigente', category: 'Dirigente' },
  5: { code: 'D', name: 'Rappresentante Tecnici', category: 'Dirigente' },
  6: { code: 'A', name: 'Atleta', category: 'Atleta' },
  7: { code: 'T', name: 'Tecnico Istruttore 1° livello', category: 'Tecnico' },
  8: { code: 'T', name: 'Tecnico Istruttore 2° livello', category: 'Tecnico' },
  9: { code: 'T', name: 'Tecnico Allenatore 1° livello', category: 'Tecnico' },
  10: { code: 'T', name: 'Tecnico Allenatore 2° livello', category: 'Tecnico' },
  11: { code: 'J', name: 'Giudice di gara', category: 'Giudice' },
  12: { code: 'D', name: 'Medico Sociale', category: 'Dirigente' },
  13: { code: 'D', name: 'Rappresentante Atleti', category: 'Dirigente' },
  14: { code: 'G', name: 'Direttore di percorso (Guida Alpina)', category: 'Guida Alpina' }
};

// Group affiliations from wmembers by member_id
const wmembersByMember = {};
rawWmembers.forEach(w => {
  const mId = Number(w.member_id);
  if (!wmembersByMember[mId]) wmembersByMember[mId] = [];
  wmembersByMember[mId].push(w);
});

// Group federal roles
const fedmembersByMember = {};
const fedStatusByMember = {};
const fedRecordsByMember = {};
rawFedmembers.forEach(f => {
  const mId = Number(f.member_id);
  if (!fedmembersByMember[mId]) fedmembersByMember[mId] = [];
  fedmembersByMember[mId].push(f.role);
  if (!fedRecordsByMember[mId]) fedRecordsByMember[mId] = [];
  fedRecordsByMember[mId].push(f);
  if (f.stato) {
    fedStatusByMember[mId] = f.stato;
  }
});

// Create User & Account lookup dictionaries
const userById = {};
rawUsers.forEach(u => {
  userById[String(u.id)] = u;
});

const accountByUser = {};
rawAccounts.forEach(a => {
  accountByUser[String(a.user_id)] = a;
});

// Format Clubs
const currentSeasonYear = new Date().getFullYear();
const clubsList = rawClubs.map(c => {
  const u = userById[String(c.user_id)] || {};
  const a = accountByUser[String(c.user_id)] || { current: 0, total: 0, payed: 0 };
  const currentCredit = typeof a.current === 'number' ? a.current : (parseFloat(a.current) || 0);

  let lastYear = null;
  if (c.affiliate_years) {
    const years = String(c.affiliate_years).split(';').map(y => parseInt(y.trim())).filter(y => !isNaN(y));
    if (years.length > 0) lastYear = Math.max(...years);
  }
  if (!lastYear && c.affiliate_expire && c.affiliate_expire !== '0000-00-00') {
    lastYear = parseInt(String(c.affiliate_expire).slice(0, 4));
  }
  const isAffiliato = Boolean(Number(c.affiliation_complete) === 1);
  const isAttiva = Boolean(isAffiliato && lastYear !== null && lastYear >= currentSeasonYear);

  const numId = Number(c.id);
  const codiceSocieta = numId > 0 && numId < 10000 ? String(10000 + numId) : String(c.id);

  return {
    id: `club_${c.id}`,
    rawId: String(c.id),
    codice: codiceSocieta,
    codiceFiso: c.fisoId ? String(c.fisoId).trim().replace(/^0+(?=\d)/, '') : '',
    role: 'societa',
    nome: c.name,
    denominazione: c.name,
    ragioneSociale: c.r_name || 'ASD',
    formaGiuridica: c.r_name || 'ASD',
    username: u.username || '',
    email: u.email || c.email || '',
    email2: c.email2 || '',
    userId: c.user_id || u.id || '',
    credito: currentCredit,
    totalAccount: a.total || 0,
    payedAccount: a.payed || 0,
    codiceFiscale: c.cf || '',
    partitaIva: c.pi || '',
    legaleRappresentante: c.contact || c.r_name || 'Presidente ASD',
    sede: `${c.city || ''} (${c.province || ''})`,
    address: c.address || '',
    street_number: c.street_number || '',
    city: c.city || '',
    province: c.province || '',
    region: c.region || '',
    cap: c.cap || '',
    rName: c.r_name || 'ASD',
    web: c.web || '',
    cell1: c.cell1 || '',
    cell2: c.cell2 || '',
    telefono: c.cell1 || c.cell2 || '',
    contact: c.contact || '',
    c_cell1: c.c_cell1 || '',
    c_email: c.c_email || '',
    coni_certificate: c.coni_certificate || '0',
    certificate: c.certificate || '',
    cf_certificate: c.cf_certificate || '',
    association_articles: c.association_articles || '',
    statute_modification: c.statute_modification || '',
    statute: c.statute || '',
    id_president: c.id_president || '',
    election_act: c.election_act || '',
    affiliation_form: c.affiliation_form || '',
    comment: c.comment || '',
    profileCompleted: c.profileCompleted !== undefined ? Boolean(c.profileCompleted) : (String(c.is_new) !== '1'),
    affiliateBegin: c.affiliate_begin,
    affiliateExpire: c.affiliate_expire || '',
    affiliateYears: c.affiliate_years || '',
    lastYear,
    isAttiva,
    statoAffiliazione: isAttiva ? `Attiva ${currentSeasonYear}` : (!isAffiliato && lastYear !== null && lastYear >= currentSeasonYear ? 'Non affiliata' : `Scaduta ${lastYear || 'N/D'}`),
    affiliato: isAffiliato,
    affiliation_complete: c.affiliation_complete,
    status: c.status == 1 ? 'attivo' : 'attivo'
  };
});

// Format Chronos
const chronosList = rawChronos.map(ch => ({
  id: `crono_${ch.id}`,
  rawId: String(ch.id),
  codice: String(ch.id),
  role: 'crono',
  nome: ch.name,
  ragioneSociale: ch.name,
  codiceFiscale: ch.cf || '',
  partitaIva: ch.pi || '',
  referenteTecnico: ch.contact || 'Referente Crono',
  contact: ch.contact || '',
  c_cell1: ch.c_cell1 || '',
  c_email: ch.c_email || '',
  address: ch.address || '',
  street_number: ch.street_number || '',
  cap: ch.cap || '',
  city: ch.city || '',
  province: ch.province || '',
  region: ch.region || '',
  sede: `${ch.city || ''} (${ch.province || ''})`,
  email: ch.email || '',
  email2: ch.email2 || '',
  cell1: ch.cell1 || '',
  telefono: ch.cell1 || ch.c_cell1 || '',
  web: ch.web || '',
  userId: ch.user_id || '',
  comment: ch.comment || '',
  profileCompleted: ch.profileCompleted !== undefined ? Boolean(ch.profileCompleted) : true,
  status: 'attivo'
}));

// Format Race Requests (extracted directly from imported database mysql_racerequests.json)
const rawRequestTypesJoin = readJsonFile('mysql_racerequests_racetypes.json', []);

const CATEGORY_RACES_MAP = {
  '1': 'Skyrace',
  '2': 'Vertical kilometer',
  '3': 'UltraSkyMarathon',
  '4': 'SkyTrail',
  '5': 'Combinata (VK e Sky)',
  '6': 'SkyMarathon',
  '7': 'SkySpeed',
  '8': 'SkyScraper Running',
  '9': 'Sky Snow',
  '10': 'Skyrun'
};

const RACE_TYPES_MAP = {
  '1': 'Skytrail Associata',
  '2': 'Campionato Italiano Assoluto',
  '3': 'Campionato Italiano Giovanile',
  '4': 'Campionato Italiano Master',
  '5': 'Campionato Regionale',
  '6': 'SNS - Skyrunner National Series',
  '7': 'SCC',
  '8': 'Circuito SWS - Skyrunner World Series',
  '9': 'Campionati Italiani Assoluti e di categoria',
  '10': 'Coppa Italia Skyrunning',
  '11': 'Coppa Italia Skysnow',
  '12': 'Coppa Italia Vertical',
  '13': 'Coppa Italia delle Alpi (Sky Climb)',
  '14': 'Inserimento normale in calendario',
  '15': 'COPPA ITALIA GIOVANI / YOUTH',
  '16': 'Gara internazionale'
};

const racetypesByRequestId = {};
rawRequestTypesJoin.forEach(row => {
  const rrId = String(row.racerequest_id);
  if (!racetypesByRequestId[rrId]) racetypesByRequestId[rrId] = [];
  racetypesByRequestId[rrId].push(String(row.racetype_id));
});

const clubObjById = {};
const clubObjByNormName = {};
rawClubs.forEach(c => {
  clubObjById[String(c.id)] = c;
  if (c.name) {
    clubObjByNormName[c.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = c;
  }
});

const PROV_TO_REGION = {
  AG: 'Sicilia', AL: 'Piemonte', AN: 'Marche', AO: "Valle d'Aosta", AR: 'Toscana', AP: 'Marche', AT: 'Piemonte',
  AV: 'Campania', BA: 'Puglia', BT: 'Puglia', BL: 'Veneto', BN: 'Campania', BG: 'Lombardia', BI: 'Piemonte',
  BO: 'Emilia-Romagna', BZ: 'Trentino-Alto Adige', BS: 'Lombardia', BR: 'Puglia', CA: 'Sardegna', CL: 'Sicilia',
  CB: 'Molise', CI: 'Sardegna', CE: 'Campania', CT: 'Sicilia', CZ: 'Calabria', CH: 'Abruzzo', CO: 'Lombardia',
  CS: 'Calabria', CR: 'Lombardia', KR: 'Calabria', CN: 'Piemonte', EN: 'Sicilia', FM: 'Marche', FE: 'Emilia-Romagna',
  FI: 'Toscana', FG: 'Puglia', FC: 'Emilia-Romagna', FR: 'Lazio', GE: 'Liguria', GO: 'Friuli-Venezia Giulia',
  GR: 'Toscana', IM: 'Liguria', IS: 'Molise', SP: 'Liguria', AQ: 'Abruzzo', LT: 'Lazio', LE: 'Puglia',
  LC: 'Lombardia', LI: 'Toscana', LO: 'Lombardia', LU: 'Toscana', MC: 'Marche', MN: 'Lombardia', MS: 'Toscana',
  MT: 'Basilicata', VS: 'Sardegna', ME: 'Sicilia', MI: 'Lombardia', MO: 'Emilia-Romagna', MB: 'Lombardia',
  NA: 'Campania', NO: 'Piemonte', NU: 'Sardegna', OG: 'Sardegna', OT: 'Sardegna', OR: 'Sardegna', PD: 'Veneto',
  PA: 'Sicilia', PR: 'Emilia-Romagna', PV: 'Lombardia', PG: 'Umbria', PU: 'Marche', PE: 'Abruzzo', PC: 'Emilia-Romagna',
  PI: 'Toscana', PT: 'Toscana', PN: 'Friuli-Venezia Giulia', PZ: 'Basilicata', PO: 'Toscana', RG: 'Sicilia',
  RA: 'Emilia-Romagna', RC: 'Calabria', RE: 'Emilia-Romagna', RI: 'Lazio', RN: 'Emilia-Romagna', RM: 'Lazio',
  RO: 'Veneto', SA: 'Campania', SS: 'Sardegna', SV: 'Liguria', SI: 'Toscana', SR: 'Sicilia', SO: 'Lombardia',
  TA: 'Puglia', TE: 'Abruzzo', TR: 'Umbria', TO: 'Piemonte', TP: 'Sicilia', TN: 'Trentino-Alto Adige',
  TV: 'Veneto', TS: 'Friuli-Venezia Giulia', UD: 'Friuli-Venezia Giulia', VA: 'Lombardia', VE: 'Veneto',
  VB: 'Piemonte', VCO: 'Piemonte', VC: 'Piemonte', VR: 'Veneto', VV: 'Calabria', VI: 'Veneto', VT: 'Lazio', SU: 'Sardegna'
};

const CITY_TO_REGION = {
  paluzza: 'Friuli-Venezia Giulia', alagna: 'Piemonte', tires: 'Trentino-Alto Adige', castelnuovonigra: 'Piemonte',
  nembro: 'Lombardia', ceresole: 'Piemonte', azzano: 'Toscana', villacidro: 'Sardegna', rumo: 'Trentino-Alto Adige',
  crodo: 'Piemonte', lecco: 'Lombardia', courmayeur: "Valle d'Aosta", gressoney: "Valle d'Aosta", bormio: 'Lombardia',
  livigno: 'Lombardia', canazei: 'Trentino-Alto Adige', cortina: 'Veneto', limone: 'Piemonte', premana: 'Lombardia',
  pasturo: 'Lombardia', valmalenco: 'Lombardia', aprica: 'Lombardia', schilpario: 'Lombardia', bergamo: 'Lombardia',
  sondrio: 'Lombardia', trento: 'Trentino-Alto Adige', bolzano: 'Trentino-Alto Adige', belluno: 'Veneto',
  udine: 'Friuli-Venezia Giulia', verbania: 'Piemonte', biella: 'Piemonte', torino: 'Piemonte', cuneo: 'Piemonte',
  aosta: "Valle d'Aosta", genova: 'Liguria', savona: 'Liguria', imperia: 'Liguria', parma: 'Emilia-Romagna',
  modena: 'Emilia-Romagna', bologna: 'Emilia-Romagna', lucca: 'Toscana', massa: 'Toscana', perugia: 'Umbria',
  terni: 'Umbria', aquila: 'Abruzzo', gransasso: 'Abruzzo', teramo: 'Abruzzo', chieti: 'Abruzzo', pescara: 'Abruzzo',
  domodossola: 'Piemonte', montescheno: 'Piemonte', rasura: 'Lombardia', talamona: 'Lombardia', bellagio: 'Lombardia',
  carvico: 'Lombardia', serina: 'Lombardia', vezzadoglio: 'Lombardia', sauzedoulx: 'Piemonte', canneroriviera: 'Piemonte',
  isoladelba: 'Toscana', marciana: 'Toscana', sordevolo: 'Piemonte', campodolcino: 'Lombardia', fraciscio: 'Lombardia',
  valbondione: 'Lombardia', vione: 'Lombardia', marradi: 'Toscana', firenzuola: 'Toscana', covigliaio: 'Toscana',
  brumano: 'Lombardia', carateurio: 'Lombardia', cortenogolgi: 'Lombardia', sottoilmonte: 'Lombardia', villaditirano: 'Lombardia'
};

// Normalizza la regione di appartenenza di un tesserato: nome canonico (case-insensitive)
// e fallback sulla sigla di provincia quando la regione non è indicata.
const CANONICAL_REGIONS = Array.from(new Set(Object.values(PROV_TO_REGION)));
const normRegionKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
const CANONICAL_REGION_BY_KEY = {};
CANONICAL_REGIONS.forEach(r => { CANONICAL_REGION_BY_KEY[normRegionKey(r)] = r; });
Object.assign(CANONICAL_REGION_BY_KEY, {
  trentino: 'Trentino-Alto Adige', altoadige: 'Trentino-Alto Adige', trentinoaltoadigesudtirol: 'Trentino-Alto Adige',
  friuli: 'Friuli-Venezia Giulia', valledaosta: "Valle d'Aosta", valleedaoste: "Valle d'Aosta", emilia: 'Emilia-Romagna'
});
function resolveMemberRegion(region, province) {
  const raw = String(region || '').trim();
  if (raw) return CANONICAL_REGION_BY_KEY[normRegionKey(raw)] || raw;
  const p = String(province || '').trim().toUpperCase();
  return PROV_TO_REGION[p] || '';
}

function resolveRaceRegion(r) {
  if (r.region && String(r.region).trim()) return String(r.region).trim();
  if (r.regione && String(r.regione).trim()) return String(r.regione).trim();
  if (r.club_id && clubObjById[String(r.club_id)] && clubObjById[String(r.club_id)].region) {
    return clubObjById[String(r.club_id)].region;
  }
  const normFrom = (r.from || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normFrom) {
    if (clubObjByNormName[normFrom] && clubObjByNormName[normFrom].region) {
      return clubObjByNormName[normFrom].region;
    }
    for (const [k, c] of Object.entries(clubObjByNormName)) {
      if (k.length > 5 && (normFrom.includes(k) || k.includes(normFrom)) && c.region) {
        return c.region;
      }
    }
  }
  const w = (r.where || '').trim();
  const m = w.match(/[\(\-\s]([A-Za-z]{2,3})[\)\s\-]|[\(]([A-Za-z]{2,3})[\)]$/);
  if (m) {
    const p = (m[1] || m[2]).toUpperCase();
    if (PROV_TO_REGION[p]) return PROV_TO_REGION[p];
  }
  const wl = w.toLowerCase().replace(/[^a-z]/g, '');
  for (const [ck, reg] of Object.entries(CITY_TO_REGION)) {
    if (wl.includes(ck)) return reg;
  }
  return w || '';
}

function resolveRaceTypes(r) {
  const typesSet = new Set();
  const codesSet = new Set();

  if (r.championships && String(r.championships).trim()) {
    String(r.championships).split(';').map(s => s.trim()).filter(Boolean).forEach(part => {
      if (RACE_TYPES_MAP[part]) {
        typesSet.add(RACE_TYPES_MAP[part]);
        codesSet.add(part);
      } else {
        typesSet.add(part);
        codesSet.add(part);
      }
    });
  }

  const joinIds = racetypesByRequestId[String(r.id)] || [];
  joinIds.forEach(rtId => {
    if (RACE_TYPES_MAP[rtId]) {
      typesSet.add(RACE_TYPES_MAP[rtId]);
      codesSet.add(rtId);
    }
  });

  if (typesSet.size === 0 && r.series && String(r.series).trim()) {
    String(r.series).split(';').map(s => s.trim()).filter(Boolean).forEach(part => {
      typesSet.add(part);
      codesSet.add(part);
    });
  }

  if (String(r.otherChampionship) === '1' && r.otherChampionshipTxt && String(r.otherChampionshipTxt).trim()) {
    typesSet.add(String(r.otherChampionshipTxt).trim());
  }

  if (typesSet.size === 0) {
    typesSet.add('Inserimento normale in calendario');
    codesSet.add('14');
  }

  return {
    list: Array.from(typesSet),
    codes: Array.from(codesSet),
    label: Array.from(typesSet).join(', ')
  };
}

function buildRaceRequestObj(r) {
  let stato = 'in_attesa';
  let statoGara = 'nuova';
  let statoLabel = 'Nuova';
  if (r.status === 'accepted' || r.status === 'approvata' || r.status === 'accettata') {
    stato = 'approvata';
    statoGara = 'accettata';
    statoLabel = 'Accettata';
  } else if (r.status === 'rejected' || r.status === 'respinta' || r.status === 'rifiutata') {
    stato = 'respinta';
    statoGara = 'rifiutata';
    statoLabel = 'Rifiutata';
  }

  const canonicalClub = (r.club_id && clubMap[r.club_id] && String(clubMap[r.club_id]).trim())
    ? String(clubMap[r.club_id]).trim()
    : '';
  const promotore = canonicalClub
    || ((r.from && String(r.from).trim())
      ? String(r.from).trim()
      : (r.contact && String(r.contact).trim() ? String(r.contact).trim() : 'Non specificato'));

  let codeCreatedDate = '';
  if (r.code) {
    const ts = parseInt(String(r.code).split('-')[0], 10);
    if (!isNaN(ts) && ts > 1000000000) {
      codeCreatedDate = new Date(ts * 1000).toISOString().slice(0, 10);
    }
  }

  const dataInserimento = (r.created && r.created !== '0000-00-00')
    ? String(r.created).trim()
    : (codeCreatedDate || ((r.payed_date && r.payed_date !== '0000-00-00') ? String(r.payed_date).trim() : (r.date || '')));

  let annoRiferimento = '';
  if (r.anno_riferimento && /^\d{4}$/.test(String(r.anno_riferimento).trim())) {
    annoRiferimento = String(r.anno_riferimento).trim();
  } else if (r.date && r.date !== '0000-00-00' && String(r.date).length >= 4) {
    let yr = parseInt(String(r.date).slice(0, 4), 10);
    if (dataInserimento && String(r.date).trim() === dataInserimento && parseInt(dataInserimento.slice(5, 7), 10) >= 10 && Number(r.id) > 470) {
      yr += 1;
    }
    annoRiferimento = String(yr);
  } else if (dataInserimento && dataInserimento.length >= 4) {
    annoRiferimento = String(parseInt(dataInserimento.slice(0, 4), 10) + 1);
  } else {
    annoRiferimento = '2027';
  }
  const anno = annoRiferimento;

  const rtInfo = resolveRaceTypes(r);
  const specialita = CATEGORY_RACES_MAP[String(r.categoryrace_id)] || r.specialita || 'Skyrace';
  const regione = resolveRaceRegion(r);

  let montepremi = '';
  if (r.price && String(r.price).trim() !== '' && String(r.price).trim() !== '0') {
    montepremi = String(r.price).trim();
  } else if (r.money_price && String(r.money_price).trim() !== '0' && String(r.money_price).trim() !== '1') {
    montepremi = String(r.money_price).trim();
  } else if (String(r.nature_price) === '1') {
    montepremi = 'Premi in natura';
  } else {
    montepremi = r.price !== undefined && r.price !== null && String(r.price).trim() !== '' ? String(r.price).trim() : '0';
  }

  const isPayed = String(r.payed) === '1';
  const isFree = String(r.free) === '1';
  const payedDate = (r.payed_date && r.payed_date !== '0000-00-00') ? String(r.payed_date).trim() : '';
  let pagatoLabel = 'No (0)';
  if (isPayed && isFree) {
    pagatoLabel = 'Sì - Gratuito (1)';
  } else if (isPayed) {
    pagatoLabel = payedDate ? `Sì (${payedDate})` : 'Sì (1)';
  } else if (isFree) {
    pagatoLabel = 'Gratuito (Esente)';
  } else {
    pagatoLabel = 'No (0)';
  }

  return {
    id: `req_${r.id}`,
    rawId: String(r.id),
    protocollo: r.code || `FISKY-REQ-${r.id}`,
    anno,
    annoRiferimento,
    anno_riferimento: annoRiferimento,
    dataInserimento,
    created: r.created || '',
    nomeGara: (r.title || '').trim(),
    title: (r.title || '').trim(),
    description: r.description || '',
    promotore,
    societaNome: promotore,
    societa: promotore,
    societaId: String(r.club_id || '0'),
    organizzatoreNome: promotore,
    from: r.from || '',
    club_id: String(r.club_id || '0'),
    localita: (r.where || '').trim(),
    where: (r.where || '').trim(),
    regione,
    dataGara: r.date || '',
    date: r.date || '',
    date_end: (r.date_end && r.date_end !== '0000-00-00') ? r.date_end : '',
    disciplina: specialita,
    specialita,
    categoryrace_id: String(r.categoryrace_id || '1'),
    tipoRichiesta: r.tipologia_richiesta || rtInfo.label,
    tipoRichiestaList: r.tipologia_richiesta ? [r.tipologia_richiesta] : rtInfo.list,
    tipoRichiestaCodes: rtInfo.codes,
    tipologia_richiesta: r.tipologia_richiesta || '',
    championships: r.championships || '',
    series: r.series || '',
    otherChampionship: r.otherChampionship || '0',
    otherChampionshipTxt: r.otherChampionshipTxt || '',
    altriCircuiti: (r.otherChampionship === '1' || r.otherChampionship === 'Si' || r.otherChampionship === 'Sì') ? 'Si' : 'No',
    montepremi,
    price: r.price || '',
    money_price: r.money_price || '0',
    nature_price: r.nature_price || '0',
    payed: String(r.payed ?? '0'),
    free: String(r.free ?? '0'),
    payed_date: payedDate,
    pagatoLabel,
    baseraceprice: r.baseraceprice || '',
    statusRaw: r.status || 'new',
    stato,
    statoGara,
    statoLabel,
    dislivelloDplus: Number(r.drop_pos) || 0,
    dislivelloDminus: Number(r.drop_neg) || 0,
    sviluppoKm: r.distance || '0',
    distanzaKm: r.distance || '0',
    quotaMax: Number(r.max_height) || 0,
    quotaMassima: Number(r.max_height) || 0,
    maxAtleti: Number(r.max_atlete) || 0,
    maxPartecipanti: Number(r.max_atlete) || 0,
    percentualeAsfalto: r.asfalto_perc || '',
    percentualeSentiero: r.sentiero_perc || '',
    tipologieSentiero: r.sentiero_tipi || '',
    referenteNome: r.contact || '',
    referenteEmail: r.email || '',
    referenteEmailContatto: r.c_emal || '',
    referenteTelefono: r.c_tel || r.telephone || '',
    racedirector: r.racedirector || '',
    direttoreGara: r.racedirector || '',
    racejudge: r.racejudge || '',
    giudiceGara: r.racejudge || '',
    edition: r.edition || '',
    edizione: r.edition || '',
    aziendaCrono: r.chrono || r.timing || '',
    url: r.url || '',
    sitoWeb: r.url || '',
    emailUfficiale: r.email || '',
    telephone: r.telephone || '',
    conditions_accepted: Boolean(r.conditions_accepted),
    condizioniAccettate: Boolean(r.conditions_accepted),
    subscription_url: r.subscription_url || '',
    subscription_start: (r.subscription_start && r.subscription_start !== '0000-00-00') ? r.subscription_start : '',
    subscription_end: (r.subscription_end && r.subscription_end !== '0000-00-00') ? r.subscription_end : '',
    subscription_price: r.subscription_price || '0.00',
    pasta_party: String(r.pasta_party || '0'),
    shower_free: String(r.shower_free || '0'),
    race_refresh: String(r.race_refresh || '0'),
    parking: String(r.parking || '0'),
    medical_assistance: String(r.medical_assistance || '0'),
    board: String(r.board || '0'),
    room: String(r.room || '0'),
    race_bib: String(r.race_bib || '0'),
    photoshoot: String(r.photoshoot || '0'),
    tv_broadcast: String(r.tv_broadcast || '0'),
    press_officer: String(r.press_officer || '0'),
    other_services_txt: r.other_services_txt || '',
    other_benefits_txt: r.other_benefits_txt || '',
    mountain_trail: String(r.mountain_trail || '0'),
    scree_trail: String(r.scree_trail || '0'),
    snowfield_trail: String(r.snowfield_trail || '0'),
    rocks_trail: String(r.rocks_trail || '0'),
    cordate_trail: String(r.cordate_trail || '0'),
    railways_trail: String(r.railways_trail || '0'),
    tecnical_trail: String(r.tecnical_trail || '0'),
    dataRichiesta: dataInserimento,
    raw: { ...r }
  };
}

const raceRequestsList = rawRequests.map(buildRaceRequestObj);

// ================= CALENDARIO GARE HELPERS ================= //

const CITY_TO_PROV = {
  vezzadoglio: 'BS', sauzedoulx: 'TO', paluzza: 'UD', talamona: 'SO', genga: 'AN',
  bellagio: 'CO', aquila: 'AQ', preturo: 'AQ', cannero: 'VB', carvico: 'BG',
  serina: 'BG', marciana: 'LI', isoladelba: 'LI', villaditirano: 'SO', valmadrera: 'LC',
  moscheta: 'FI', firenzuola: 'FI', covigliaio: 'FI', vione: 'BS', verbania: 'VB',
  alagna: 'VC', acquasanta: 'GE', mele: 'GE', genova: 'GE', piossasco: 'TO',
  tires: 'BZ', castelnuovonigra: 'TO', rasura: 'SO', mandello: 'LC', carateurio: 'CO',
  foppolo: 'BG', carona: 'BG', nembro: 'BG', villeneuve: 'AO', pasturo: 'LC',
  resinelli: 'LC', fraciscio: 'SO', campodolcino: 'SO', sondrio: 'SO', ceresole: 'TO',
  azzano: 'LU', teglio: 'SO', pratovalentino: 'SO', villacidro: 'SU', valmasino: 'SO',
  filorera: 'SO', cavalese: 'TN', cortenogolgi: 'BS', sellanevea: 'UD', domodossola: 'VB',
  sanpellegrinoterme: 'BG', carenno: 'LC', rumo: 'TN', crodo: 'VB', brumano: 'BG',
  lecco: 'LC', vedeseta: 'BG', sestofiorentino: 'FI', torino: 'TO', misurina: 'BL',
  cutigliano: 'PT', doganaccia: 'PT', montescheno: 'VB', villadiserio: 'BG', villasulserio: 'BG',
  sottoilmonte: 'BG', marradi: 'FI', valbondione: 'BG', sordevolo: 'BI', courmayeur: 'AO',
  gressoney: 'AO', bormio: 'SO', livigno: 'SO', canazei: 'TN', cortina: 'BL',
  limone: 'BS', premana: 'LC', valmalenco: 'SO', aprica: 'SO', schilpario: 'BG',
  bergamo: 'BG', trento: 'TN', bolzano: 'BZ', belluno: 'BL', udine: 'UD',
  biella: 'BI', cuneo: 'CN', aosta: 'AO', savona: 'SV', imperia: 'IM',
  parma: 'PR', modena: 'MO', bologna: 'BO', lucca: 'LU', massa: 'MS',
  perugia: 'PG', terni: 'TR', teramo: 'TE', chieti: 'CH', pescara: 'PE'
};

function formatIsoToItalianDate(isoStr, isoEndStr) {
  if (!isoStr || isoStr === '0000-00-00') return '';
  const parts = String(isoStr).trim().split('-');
  if (parts.length !== 3) return String(isoStr);
  const d1 = `${parts[2]}/${parts[1]}/${parts[0]}`;
  if (isoEndStr && isoEndStr !== '0000-00-00' && isoEndStr !== isoStr && !String(isoEndStr).startsWith('2030')) {
    const p2 = String(isoEndStr).trim().split('-');
    if (p2.length === 3 && p2[0] === parts[0]) {
      return `${d1} / ${p2[2]}/${p2[1]}/${p2[0]}`;
    }
  }
  return d1;
}

function resolveRaceLocalitaWithProvince(r) {
  let w = String(r.where || '').trim();
  if (!w) return '';
  const endMatch = w.match(/^(.*?)\s*\(\s*([A-Za-z]{2})\s*\)\s*$/);
  if (endMatch) {
    return `${endMatch[1].trim()} (${endMatch[2].toUpperCase()})`;
  }
  let prov = '';
  if (r.club_id && clubObjById[String(r.club_id)] && clubObjById[String(r.club_id)].province) {
    prov = String(clubObjById[String(r.club_id)].province).trim().toUpperCase();
  }
  if (!prov && r.from) {
    const nf = String(r.from).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clubObjByNormName[nf] && clubObjByNormName[nf].province) {
      prov = String(clubObjByNormName[nf].province).trim().toUpperCase();
    } else {
      for (const [k, c] of Object.entries(clubObjByNormName)) {
        if (k.length > 5 && (nf.includes(k) || k.includes(nf)) && c.province) {
          prov = String(c.province).trim().toUpperCase();
          break;
        }
      }
    }
  }
  if (!prov) {
    const dashMatch = w.match(/[\-\s]([A-Z]{2})(?:[\s\-]|$)/);
    if (dashMatch) prov = dashMatch[1].toUpperCase();
  }
  if (!prov) {
    const wl = w.toLowerCase().replace(/[^a-z]/g, '');
    for (const [ck, pCode] of Object.entries(CITY_TO_PROV)) {
      if (wl.includes(ck)) {
        prov = pCode;
        break;
      }
    }
  }
  if (prov && prov.length === 2) {
    return `${w} (${prov})`;
  }
  return w;
}

function formatDistanzaKm(distRaw) {
  if (!distRaw || String(distRaw).trim() === '' || String(distRaw).trim() === '0') return '';
  let s = String(distRaw).trim().replace(/^km\s*/i, '').trim();
  if (/^\d{4,5}$/.test(s)) {
    const kmVal = parseInt(s, 10) / 1000;
    return `Km ${String(kmVal).replace('.', ',')}`;
  }
  if (/^\d+\.\d{3}$/.test(s)) {
    const num = parseFloat(s);
    return `Km ${String(num).replace('.', ',')}`;
  }
  return `Km ${s.replace('.', ',')}`;
}

function formatDislivelloDplus(dropRaw) {
  if (!dropRaw || String(dropRaw).trim() === '' || String(dropRaw).trim() === '0') return '';
  let s = String(dropRaw).trim().replace(/^d\s*\+\s*/i, '').replace(/m$/i, '').trim();
  const n = parseInt(s.replace(/\./g, ''), 10);
  if (!isNaN(n) && n > 0) {
    return `D + ${n.toLocaleString('it-IT')}`;
  }
  return `D + ${s}`;
}

function buildCalendarEntryFromRaceRequest(r) {
  const reqObj = buildRaceRequestObj(r);
  const rtList = (reqObj.tipoRichiestaList || []).filter(
    lbl => lbl && lbl.toLowerCase() !== 'inserimento normale in calendario'
  );
  const circuitoTitoli = rtList.join(' / ');

  return {
    id: `cal_req_${r.id}`,
    anno: String(reqObj.annoRiferimento || reqObj.anno),
    data: formatIsoToItalianDate(r.date, r.date_end),
    dataIso: (r.date && r.date !== '0000-00-00') ? String(r.date).trim() : `${reqObj.annoRiferimento}-12-31`,
    manifestazione: String(r.title || '').trim(),
    url: String(r.url || '').trim(),
    tipologia: CATEGORY_RACES_MAP[String(r.categoryrace_id)] || r.specialita || 'Skyrace',
    localita: resolveRaceLocalitaWithProvince(r),
    circuitoTitoli,
    distanza: formatDistanzaKm(r.distance),
    dislivello: formatDislivelloDplus(r.drop_pos),
    source: 'racerequest',
    racerequest_id: String(r.id)
  };
}

function syncRaceRequestToCalendar(r) {
  if (!r || !r.id) return;
  const reqIdStr = String(r.id);
  const isAccepted = r.status === 'accepted' || r.status === 'approvata' || r.status === 'accettata';

  const existingIdx = calendarioGareList.findIndex(c => String(c.racerequest_id) === reqIdStr || c.id === `cal_req_${reqIdStr}`);

  if (isAccepted) {
    const entry = buildCalendarEntryFromRaceRequest(r);
    if (existingIdx !== -1) {
      calendarioGareList[existingIdx] = entry;
    } else {
      // Check if an identical race by year and normalized title exists from webpage import
      const normTitle = entry.manifestazione.toLowerCase().replace(/[^a-z0-9]/g, '');
      const wpIdx = calendarioGareList.findIndex(
        c => String(c.anno) === String(entry.anno) &&
             c.manifestazione.toLowerCase().replace(/[^a-z0-9]/g, '') === normTitle &&
             c.dataIso === entry.dataIso
      );
      if (wpIdx !== -1) {
        calendarioGareList[wpIdx] = { ...entry, id: calendarioGareList[wpIdx].id };
      } else {
        calendarioGareList.push(entry);
      }
    }
    writeJsonFile('mysql_calendario_gare.json', calendarioGareList);
  } else if (existingIdx !== -1) {
    calendarioGareList.splice(existingIdx, 1);
    writeJsonFile('mysql_calendario_gare.json', calendarioGareList);
  }
}

function removeRaceRequestFromCalendar(rawId) {
  const reqIdStr = String(rawId);
  const idx = calendarioGareList.findIndex(c => String(c.racerequest_id) === reqIdStr || c.id === `cal_req_${reqIdStr}`);
  if (idx !== -1) {
    calendarioGareList.splice(idx, 1);
    writeJsonFile('mysql_calendario_gare.json', calendarioGareList);
  }
}

// Format Members, Athletes, Dirigenti, Guide, Delegati Regionali, and Giudici di Gara
const today = new Date();
const membersList = [];
const atletiList = [];
const dirigentiList = [];
const guideList = [];
const delegatiList = [];
const giudiciList = [];

function isValidExpireDate(d) {
  return Boolean(d && d !== '0000-00-00' && !String(d).startsWith('1970'));
}

function computeTesseraStatus(expireDateStr) {
  if (!isValidExpireDate(expireDateStr)) return 'scaduta';
  const expYear = parseInt(String(expireDateStr).slice(0, 4), 10);
  if (isNaN(expYear) || expYear < currentSeasonYear) return 'scaduta';
  return 'attiva';
}

function getCategoryReferenceYear(customYear) {
  const y = Number(customYear);
  return (!isNaN(y) && y >= 2020 && y <= 2100) ? y : new Date().getFullYear();
}

const CF_MONTH_MAP = {
  A: '01', B: '02', C: '03', D: '04', E: '05', H: '06',
  L: '07', M: '08', P: '09', R: '10', S: '11', T: '12'
};

function resolveBirthAndGender(dataNascita, sesso, codiceFiscale, customRefYear) {
  const refYear = getCategoryReferenceYear(customRefYear);
  const maxPlausibleBirthYear = refYear - 10; // Soglia dinamica (es. 2016 nel 2026, 2017 nel 2027, ecc.)
  const cfPivotYY = maxPlausibleBirthYear % 100;

  const cf = String(codiceFiscale || '').trim().toUpperCase();
  let gender = 'M';
  const s = String(sesso || '').trim().toUpperCase();
  if (s.startsWith('F')) {
    gender = 'F';
  } else if (s.startsWith('M')) {
    gender = 'M';
  } else if (cf.length >= 11 && /^\d{2}$/.test(cf.slice(9, 11))) {
    const cfDay = parseInt(cf.slice(9, 11), 10);
    if (cfDay > 40) gender = 'F';
  }

  let birthYear = null;
  let normalizedBirthDate = (dataNascita && dataNascita !== '0000-00-00') ? String(dataNascita).trim() : '';

  if (normalizedBirthDate) {
    if (/^\d{4}-\d{2}-\d{2}/.test(normalizedBirthDate)) {
      birthYear = parseInt(normalizedBirthDate.slice(0, 4), 10);
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalizedBirthDate)) {
      birthYear = parseInt(normalizedBirthDate.slice(6, 10), 10);
    } else {
      const parsed = new Date(normalizedBirthDate);
      if (!isNaN(parsed.getTime())) {
        birthYear = parsed.getFullYear();
      }
    }
  }

  // Fallback o correzione da Codice Fiscale se l'anno di nascita è mancante o anomalo (es. > maxPlausibleBirthYear o < 1920)
  if (!birthYear || isNaN(birthYear) || birthYear > maxPlausibleBirthYear || birthYear < 1920) {
    if (cf.length >= 11 && /^[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}/.test(cf)) {
      const yy = parseInt(cf.slice(6, 8), 10);
      const mm = CF_MONTH_MAP[cf.charAt(8)];
      let ddNum = parseInt(cf.slice(9, 11), 10);
      if (ddNum > 40) ddNum -= 40;
      const dd = String(ddNum).padStart(2, '0');
      if (!isNaN(yy)) {
        birthYear = yy <= cfPivotYY ? (2000 + yy) : (1900 + yy);
        if (mm && ddNum >= 1 && ddNum <= 31) {
          normalizedBirthDate = `${birthYear}-${mm}-${dd}`;
        }
      }
    } else if (cf.length >= 8 && /^[A-Z]{6}\d{2}/.test(cf)) {
      const yy = parseInt(cf.slice(6, 8), 10);
      if (!isNaN(yy)) {
        birthYear = yy <= cfPivotYY ? (2000 + yy) : (1900 + yy);
      }
    } else if (/^\d{11}$/.test(cf)) {
      // es. PESEL estero (AAMMGG...)
      const yy = parseInt(cf.slice(0, 2), 10);
      const mm = cf.slice(2, 4);
      const dd = cf.slice(4, 6);
      if (!isNaN(yy)) {
        birthYear = yy <= cfPivotYY ? (2000 + yy) : (1900 + yy);
        normalizedBirthDate = `${birthYear}-${mm}-${dd}`;
      }
    }
  }

  return { birthYear, gender, normalizedBirthDate, refYear };
}

/**
 * Calcola dinamicamente la Categoria Atleta in base all'età al 31 dicembre dell'anno di riferimento (default: anno solare corrente):
 * - Youth A: 15, 16 anni (nati dal 1 Gennaio [refYear-16] al 31 Dicembre [refYear-15]; include eventuali under 15)
 * - Youth B: 17, 18 anni (nati dal 1 Gennaio [refYear-18] al 31 Dicembre [refYear-17])
 * - Youth C: 19, 20 anni (nati dal 1 Gennaio [refYear-20] al 31 Dicembre [refYear-19])
 * - U23: 21, 22, 23 anni (dal 1 Gennaio [refYear-23] al 31 dicembre [refYear-21])
 * - Senior: dai 24 ai 39 anni (dal 1 Gennaio [refYear-39] al 31 dicembre [refYear-24])
 * - Master: M/F 40 (40-44 anni), M/F 45 (45-49), M/F 50 (50-54), M/F 55 (55-59), M/F 60 (60-64), M/F 65 (dai 65 anni e successivi)
 */
function computeAthleteCategory(dataNascita, sesso, codiceFiscale, customRefYear) {
  const { birthYear, gender, refYear } = resolveBirthAndGender(dataNascita, sesso, codiceFiscale, customRefYear);
  if (!birthYear || isNaN(birthYear) || birthYear > refYear || birthYear < 1910) {
    return 'Senior';
  }

  const age = refYear - birthYear;
  const mf = gender === 'F' ? 'F' : 'M';

  if (age <= 16) return 'Youth A';        // 15, 16 anni (refYear-16 .. refYear-15)
  if (age <= 18) return 'Youth B';        // 17, 18 anni (refYear-18 .. refYear-17)
  if (age <= 20) return 'Youth C';        // 19, 20 anni (refYear-20 .. refYear-19)
  if (age <= 23) return 'U23';            // 21, 22, 23 anni (refYear-23 .. refYear-21)
  if (age <= 39) return 'Senior';         // 24-39 anni (refYear-39 .. refYear-24)
  if (age <= 44) return `Master ${mf} 40`; // 40-44 anni (refYear-44 .. refYear-40)
  if (age <= 49) return `Master ${mf} 45`; // 45-49 anni (refYear-49 .. refYear-45)
  if (age <= 54) return `Master ${mf} 50`; // 50-54 anni (refYear-54 .. refYear-50)
  if (age <= 59) return `Master ${mf} 55`; // 55-59 anni (refYear-59 .. refYear-55)
  if (age <= 64) return `Master ${mf} 60`; // 60-64 anni (refYear-64 .. refYear-60)
  return `Master ${mf} 65`;                // >= 65 anni (<= refYear-65)
}

const ATHLETE_CATEGORIES_ORDER_2026 = [
  'Youth A',
  'Youth B',
  'Youth C',
  'U23',
  'Senior',
  'Master F 40',
  'Master M 40',
  'Master F 45',
  'Master M 45',
  'Master F 50',
  'Master M 50',
  'Master F 55',
  'Master M 55',
  'Master F 60',
  'Master M 60',
  'Master F 65',
  'Master M 65'
];

function getAthleteCategoryParams2026(categoria, customRefYear) {
  const refYear = getCategoryReferenceYear(customRefYear);
  const cat = String(categoria || 'Senior').trim();
  if (cat === 'Youth A') {
    return {
      annoRiferimento: refYear,
      categoria: 'Youth A',
      fasciaEta: `15, 16 anni (nati dal 1 Gennaio ${refYear - 16} al 31 Dicembre ${refYear - 15})`,
      tutelaGenitoriale: 'Richiesto consenso di chi esercita la tutela genitoriale',
      quotaMaxSlm: 3000,
      quotaRule: 'Le gare per questa categoria NON devono superare quote di 3000 m s.l.m.',
      verticalKilometer: 'Distanza da 2 a 5 km - Dislivello positivo: min 500 mt. - max 700 mt.',
      sky: 'Distanze da 6 a 10 km - Dislivello positivo: min. 400 mt. - max 960 mt.',
      regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
    };
  }
  if (cat === 'Youth B') {
    return {
      annoRiferimento: refYear,
      categoria: 'Youth B',
      fasciaEta: `17, 18 anni (nati dal 1 Gennaio ${refYear - 18} al 31 Dicembre ${refYear - 17})`,
      tutelaGenitoriale: 'Richiesto consenso di chi esercita la tutela genitoriale (per i minorenni)',
      quotaMaxSlm: 3000,
      quotaRule: 'Le gare per questa categoria NON devono superare quote di 3000 m s.l.m.',
      verticalKilometer: 'Distanza da 2 a 5 km - Dislivello positivo: min 640 mt. - max 1.000 mt.',
      sky: 'Distanze da 8 a 12 km - Dislivello positivo: min. 640 mt. - max 960 mt.',
      regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
    };
  }
  if (cat === 'Youth C') {
    return {
      annoRiferimento: refYear,
      categoria: 'Youth C',
      fasciaEta: `19, 20 anni (nati dal 1 Gennaio ${refYear - 20} al 31 Dicembre ${refYear - 19})`,
      tutelaGenitoriale: null,
      quotaMaxSlm: null,
      quotaRule: 'Parametri gare come da regolamenti ufficiali FISky',
      regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
    };
  }
  if (cat === 'U23') {
    return {
      annoRiferimento: refYear,
      categoria: 'U23',
      fasciaEta: `21, 22, 23 anni (dal 1 Gennaio ${refYear - 23} al 31 dicembre ${refYear - 21})`,
      tutelaGenitoriale: null,
      quotaMaxSlm: null,
      quotaRule: 'Parametri gare come da regolamenti ufficiali FISky',
      regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
    };
  }
  if (cat === 'Senior') {
    return {
      annoRiferimento: refYear,
      categoria: 'Senior',
      fasciaEta: `dai 24 ai 39 anni (dal 1 Gennaio ${refYear - 39} al 31 dicembre ${refYear - 24})`,
      tutelaGenitoriale: null,
      quotaMaxSlm: null,
      quotaRule: 'Parametri gare come da regolamenti ufficiali FISky',
      regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
    };
  }
  // Master M/F 40..65 calcolati dinamicamente sull'anno di riferimento
  const masterRanges = {
    '40': `40-44 anni (nati dal ${refYear - 44} al ${refYear - 40})`,
    '45': `45-49 anni (nati dal ${refYear - 49} al ${refYear - 45})`,
    '50': `50-54 anni (nati dal ${refYear - 54} al ${refYear - 50})`,
    '55': `55-59 anni (nati dal ${refYear - 59} al ${refYear - 55})`,
    '60': `60-64 anni (nati dal ${refYear - 64} al ${refYear - 60})`,
    '65': `dai 65 anni e successivi (nati nel ${refYear - 65} e precedenti)`
  };
  const ageBracketMatch = cat.match(/(40|45|50|55|60|65)/);
  const ageBracket = ageBracketMatch ? ageBracketMatch[1] : '';
  return {
    annoRiferimento: refYear,
    categoria: cat,
    fasciaEta: masterRanges[ageBracket] || `Categoria Master (in base all'età al 31 dicembre ${refYear})`,
    tutelaGenitoriale: null,
    quotaMaxSlm: null,
    quotaRule: 'Parametri gare come da regolamenti ufficiali FISky',
    regolamentoUrl: 'https://www.skyrunningitalia.it/pages/Discipline'
  };
}

let lastComputedCategoryYear = new Date().getFullYear();

function ensureCurrentYearCategories(customRefYear) {
  const targetYear = getCategoryReferenceYear(customRefYear);
  if (targetYear === lastComputedCategoryYear) return targetYear;
  lastComputedCategoryYear = targetYear;
  const updateItem = (item) => {
    const newCat = computeAthleteCategory(item.dataNascita, item.sesso, item.codiceFiscale, targetYear);
    item.categoria = newCat;
    item.parametriCategoria = getAthleteCategoryParams2026(newCat, targetYear);
  };
  membersList.forEach(updateItem);
  atletiList.forEach(updateItem);
  dirigentiList.forEach(updateItem);
  guideList.forEach(updateItem);
  delegatiList.forEach(updateItem);
  giudiciList.forEach(updateItem);
  return targetYear;
}

// Criterio di estrazione mirata per le sole Figure Dirigenziali della Federazione
// Include esclusivamente: Presidenza, Segreteria Generale, Consiglio Nazionale, Dirigenza Nazionale
// Esclude espressamente qualifiche destinate ad altri elenchi specifici: Giudici di Gara, Delegati Regionali, Guide, Tecnici, ecc.
function isDirigenteFederaleRole(role) {
  if (!role) return false;
  const r = String(role).toLowerCase().trim();
  if (
    r.includes('delegato') || 
    r.includes('giudice') || 
    r.includes('gug') || 
    r.includes('g.u.g') || 
    r.includes('guida') || 
    r.includes('tecnico') || 
    r.includes('allenatore') || 
    r.includes('istruttore') || 
    r.includes('revisori') || 
    r.includes('appello') || 
    r.includes('procuratore') || 
    r.includes('parchi') || 
    r.includes('studi e ricerca') || 
    r.includes('biologia') || 
    r.includes('medico')
  ) {
    return false;
  }
  if (
    r.includes('presidente') || 
    r.includes('segretar') || 
    r.includes('consiglie') || 
    r.includes('dirigente')
  ) {
    return true;
  }
  return false;
}

rawMembers.forEach(m => {
  const idNum = Number(m.id);
  const progressivo = String(idNum).padStart(6, '0');
  const affiliations = wmembersByMember[idNum] || [];
  const fedRoles = fedmembersByMember[idNum] || [];
  const federalDirRoles = fedRoles.filter(isDirigenteFederaleRole);

  const roles = new Set();
  const rolesSocietari = new Set();
  const rolesFederali = new Set();
  let hasAthlete = false;
  let hasDirigente = false;
  let hasFederalDirigente = false;
  let hasGuida = false;
  let hasTecnico = false;
  let dirigenteRole = '';
  let effectiveClubId = m.club_id;
  let maxExpireAll = isValidExpireDate(m.affiliate_expire) ? m.affiliate_expire : '';
  let maxExpireAtleta = '';
  let maxExpireDirigente = '';
  let maxExpireGuida = '';
  let maxExpireTecnico = '';
  let latestClubDate = '';

  // Process historical & annual affiliations (Ruoli Societari)
  affiliations.forEach(w => {
    const tInfo = typeCodeMap[w.membertype_id];
    const wValid = String(w.is_valid) !== '0';
    const wExp = isValidExpireDate(w.affiliate_expire) ? w.affiliate_expire : '';

    if (tInfo) {
      roles.add(tInfo.name);
      rolesSocietari.add(tInfo.name);
      if (tInfo.code === 'A') {
        hasAthlete = true;
        if (wValid && wExp && (!maxExpireAtleta || wExp > maxExpireAtleta)) maxExpireAtleta = wExp;
      }
      if (tInfo.code === 'D') {
        hasDirigente = true;
        if (!dirigenteRole || (wValid && wExp && wExp >= maxExpireDirigente)) dirigenteRole = tInfo.name;
        if (wValid && wExp && (!maxExpireDirigente || wExp > maxExpireDirigente)) maxExpireDirigente = wExp;
      }
      if (tInfo.code === 'G') {
        hasGuida = true;
        if (wValid && wExp && (!maxExpireGuida || wExp > maxExpireGuida)) maxExpireGuida = wExp;
      }
      if (tInfo.code === 'T') {
        hasTecnico = true;
        if (wValid && wExp && (!maxExpireTecnico || wExp > maxExpireTecnico)) maxExpireTecnico = wExp;
      }
    }

    if (wValid && wExp && (!maxExpireAll || wExp > maxExpireAll)) {
      maxExpireAll = wExp;
    }

    if (w.club_id && w.club_id !== '0' && !isNaN(Number(w.club_id))) {
      if (!latestClubDate || (wExp && wExp >= latestClubDate)) {
        effectiveClubId = w.club_id;
        if (wExp) latestClubDate = wExp;
      }
    }
  });

  // Check fedmembers & Federal Identity (Ruoli Federali FISky)
  const isFederalFigure = (fedRoles.length > 0) || (m.code && m.code.startsWith('FISKY'));
  hasFederalDirigente = (federalDirRoles.length > 0);

  if (isFederalFigure) {
    fedRoles.forEach(r => {
      roles.add(r);
      rolesFederali.add(r);
    });
    if (federalDirRoles.length > 0) {
      hasDirigente = true;
      dirigenteRole = federalDirRoles[0];
    }
  }

  // If no wmembers record, fall back to m.membertype_id or default to Athlete
  if (affiliations.length === 0 && !isFederalFigure) {
    const tInfo = typeCodeMap[m.membertype_id];
    if (tInfo) {
      roles.add(tInfo.name);
      rolesSocietari.add(tInfo.name);
      if (tInfo.code === 'D') {
        hasDirigente = true;
        dirigenteRole = tInfo.name;
      } else if (tInfo.code === 'G') {
        hasGuida = true;
      } else if (tInfo.code === 'T') {
        hasTecnico = true;
      } else {
        hasAthlete = true;
      }
    } else {
      hasAthlete = true;
      roles.add('Atleta');
      rolesSocietari.add('Atleta');
    }
  }

  // Authentic card numbers aligned to original FISky standard:
  // SKY + [Tipo] + 6-digit progressive. The progressivo remains identical across types!
  const cardAtleta = `SKYA${progressivo}`;
  const cardDirigente = `SKYD${progressivo}`;
  const cardGuida = hasGuida ? `SKYG${progressivo}` : null;
  const cardTecnico = hasTecnico ? `SKYT${progressivo}` : null;

  // Primary card: federal dirigente FISKY takes precedence for federal figures, otherwise SKYA
  const primaryCard = hasFederalDirigente ? cardDirigente : (hasAthlete ? cardAtleta : (cardDirigente || cardGuida || cardTecnico || cardAtleta));

  const socNome = clubMap[effectiveClubId] || 'Atleta Individuale / Libero';
  const effClubNum = Number(effectiveClubId);
  const societaCodice = effClubNum > 0 ? (effClubNum < 10000 ? String(10000 + effClubNum) : String(effectiveClubId)) : '';

  // Compute tesseramento status based on season renewal expiration
  const statoTessera = computeTesseraStatus(maxExpireAll);
  const ultimoAnnoTesseramento = isValidExpireDate(maxExpireAll) ? parseInt(String(maxExpireAll).slice(0, 4), 10) : null;
  const dataTesseramento = (m.created && m.created !== '0000-00-00') ? String(m.created).trim() : '';

  const storicoTesseramenti = affiliations.map(w => {
    const tInfo = typeCodeMap[w.membertype_id];
    return {
      id: w.id,
      ruolo: tInfo ? tInfo.name : 'Atleta',
      codiceRuolo: tInfo ? tInfo.code : 'A',
      societaId: w.club_id || '',
      societaNome: clubMap[w.club_id] || 'Atleta Individuale / Libero',
      dataInizio: (w.affiliate_begin && w.affiliate_begin !== '0000-00-00') ? w.affiliate_begin : '',
      dataScadenza: (w.affiliate_expire && w.affiliate_expire !== '0000-00-00') ? w.affiliate_expire : '',
      pagato: String(w.payed) === '1',
      gratuito: String(w.free) === '1',
      valido: String(w.is_valid) !== '0',
      fisoId: w.fisoId || '',
      code: w.code || ''
    };
  });

  const birthAndGender = resolveBirthAndGender(m.birthday, m.gender, m.cf);
  const computedCategoria = computeAthleteCategory(m.birthday, m.gender, m.cf);

  const hasAffiliations = affiliations.length > 0;
  const hasClub = Boolean(effectiveClubId && effectiveClubId !== '0' && Number(effectiveClubId) > 0);
  const hasExpire = isValidExpireDate(m.affiliate_expire) || isValidExpireDate(maxExpireAll);
  // Include sia chi è associato a una società sportiva, sia gli atleti liberi / individuali con tesseramento
  const isAssociato = Boolean(hasAffiliations || hasClub || hasExpire || isFederalFigure);

  const memberObj = {
    id: `mem_${m.id}`,
    rawId: idNum,
    progressivo,
    numeroTessera: primaryCard,
    numeroTesseraAtleta: cardAtleta,
    numeroTesseraDirigente: cardDirigente,
    numeroTesseraGuida: cardGuida,
    numeroTesseraTecnico: cardTecnico,
    nome: m.name,
    cognome: m.surname,
    codiceFiscale: m.cf || '',
    partitaIva: m.pi || '',
    dataNascita: birthAndGender.normalizedBirthDate || m.birthday || '',
    luogoNascita: m.birthplace || '',
    sesso: birthAndGender.gender,
    categoria: computedCategoria,
    parametriCategoria: getAthleteCategoryParams2026(computedCategoria),
    titoloTecnico: m.title_certificate || '',
    titoloVerificatoPer: (m.title_verified_for && String(m.title_verified_for) !== '0')
      ? (typeCodeMap[m.title_verified_for] ? typeCodeMap[m.title_verified_for].name : String(m.title_verified_for))
      : '',
    titoloScadenza: (m.title_expire && m.title_expire !== '0000-00-00') ? m.title_expire : '',
    certificatoMedicoScadenza: (m.mc_expire && m.mc_expire !== '0000-00-00') ? m.mc_expire : '',
    assicurazione: String(m.assurance) === '1',
    assicurazioneScadenza: (m.assurance_expire && m.assurance_expire !== '0000-00-00') ? m.assurance_expire : '',
    dataTesseramento,
    created: dataTesseramento,
    statoTessera,
    ultimoAnnoTesseramento,
    societaId: effectiveClubId,
    societaCodice,
    societaNome: socNome,
    email: m.email || '',
    telefono: m.telephone || '',
    indirizzo: m.address || '',
    civico: m.street_number || '',
    cap: m.cap || '',
    citta: m.city || '',
    provincia: m.province || '',
    regione: m.region || '',
    newsletter: String(m.newsletter) === '1',
    codiceUnivoco: m.code || '',
    userId: m.user_id || '',
    comment: m.comment || '',
    profileCompleted: m.profileCompleted !== undefined ? Boolean(m.profileCompleted) : true,
    ruoli: Array.from(roles),
    ruoliSocietari: Array.from(rolesSocietari),
    ruoliFederali: Array.from(rolesFederali),
    affiliateExpire: maxExpireAll || '',
    isAssociato,
    statoAssociazione: isAssociato ? 'associato' : 'non_associato',
    statoAssociazioneLabel: isAssociato ? 'Associato' : 'Non associato',
    storicoTesseramenti
  };

  membersList.push(memberObj);

  // Athletes dataset
  if (hasAthlete) {
    const expAtl = maxExpireAtleta || (affiliations.length === 0 ? maxExpireAll : '');
    atletiList.push({
      ...memberObj,
      numeroTessera: cardAtleta,
      tipoTessera: 'Atleta Agonista FISky',
      affiliateExpire: expAtl,
      ultimoAnnoTesseramento: isValidExpireDate(expAtl) ? parseInt(String(expAtl).slice(0, 4), 10) : null,
      statoTessera: computeTesseraStatus(expAtl)
    });
  }

  // Figure Dirigenziali della Federazione (Codice "FISKY" + Progressivo numerico di 6 cifre)
  // ESTRAZIONE ESCLUSIVA: solo le figure dirigenziali della Federazione (Presidenza, Consiglio, Segreteria, Dirigenza)
  // Giudici di Gara e Delegati Regionali sono esclusi (estratti nei rispettivi elenchi dedicati)
  if (hasFederalDirigente) {
    const cardFed = (m.code && m.code.startsWith('FISKY')) ? m.code : `FISKY${progressivo}`;
    const expDir = maxExpireDirigente || maxExpireAll || '2027-12-31';
    let fedRoleLabel = (federalDirRoles.length > 0) ? federalDirRoles[0] : (dirigenteRole || 'Dirigente Federale');
    fedRoleLabel = fedRoleLabel.replace(/&deg;/g, '°');
    const fedStato = m.stato || fedStatusByMember[idNum] || (m.in_carica === false ? 'Non più in carica' : 'In Carica');
    const isInCarica = (fedStato === 'In Carica');
    dirigentiList.push({
      ...memberObj,
      codice: cardFed,
      numeroTessera: cardFed,
      numeroTesseraDirigente: cardFed,
      nominativo: `${m.surname || ''} ${m.name || ''}`.trim(),
      ruoloDirigenziale: fedRoleLabel,
      ruoloFederale: fedRoleLabel,
      ruoliFederali: federalDirRoles.length > 0 ? federalDirRoles : [fedRoleLabel],
      stato: fedStato,
      statoCarica: fedStato,
      inCarica: isInCarica,
      tipoTessera: 'Dirigente Federale FISky',
      societaNome: 'Federazione Italiana Skyrunning (FISky)',
      societaCodice: 'FISKY-FED',
      affiliateExpire: expDir,
      ultimoAnnoTesseramento: isValidExpireDate(expDir) ? parseInt(String(expDir).slice(0, 4), 10) : (isInCarica ? 2026 : 2021),
      statoTessera: isInCarica ? 'attiva' : 'scaduta'
    });
  }

  // Guide Alpine & Direttori di Percorso dataset
  if (hasGuida) {
    const expGui = maxExpireGuida || maxExpireAll;
    guideList.push({
      ...memberObj,
      numeroTessera: cardGuida,
      regione: resolveMemberRegion(memberObj.regione, memberObj.provincia),
      qualificaGuida: 'Direttore di percorso (Guida Alpina)',
      tipoTessera: 'Tessera Guida / Ufficiale di Percorso',
      affiliateExpire: expGui,
      ultimoAnnoTesseramento: isValidExpireDate(expGui) ? parseInt(String(expGui).slice(0, 4), 10) : null,
      statoTessera: computeTesseraStatus(expGui)
    });
  }

  // Delegati Regionali FISky dataset
  const delegatoRecords = (fedRecordsByMember[idNum] || []).filter(f => (f.role || '').toLowerCase().includes('delegat'));
  const hasDelegatoRole = delegatoRecords.length > 0 || (m.title_certificate && m.title_certificate.toLowerCase().includes('delegat'));
  if (hasDelegatoRole) {
    const fRec = delegatoRecords[0] || {};
    const qualifica = fRec.role || m.title_certificate || 'Delegato Regionale';
    let reg = qualifica.replace(/Delegato Regionale\s*/i, '').trim();
    if (reg === 'Valle d Aosta') reg = "Valle d'Aosta";
    else if (reg === 'Trentino Alto Adige') reg = 'Trentino-Alto Adige';
    else if (reg === 'Friuli Venezia Giulia') reg = 'Friuli-Venezia Giulia';
    else if (reg === 'Emilia Romagna') reg = 'Emilia-Romagna';
    if (!reg) reg = resolveMemberRegion(memberObj.regione, memberObj.provincia);

    const isInCarica = (fRec.in_carica !== false && fRec.stato !== 'Non più in carica');
    const cardDel = (m.code && m.code.startsWith('FISKY')) ? m.code : `FISKY${progressivo}`;
    const expDel = maxExpireAll || (isInCarica ? '2026-12-31' : '2021-12-31');

    delegatiList.push({
      ...memberObj,
      fedId: fRec.id || null,
      codice: cardDel,
      numeroTessera: cardDel,
      numeroTesseraDelegato: cardDel,
      nominativo: `${m.surname || ''} ${m.name || ''}`.trim(),
      qualifica: qualifica,
      ruoloFederale: qualifica,
      regione: reg,
      stato: isInCarica ? 'In Carica' : 'Non più in carica',
      statoCarica: isInCarica ? 'In Carica' : 'Non più in carica',
      inCarica: isInCarica,
      tipoTessera: 'Delegato Regionale FISky',
      societaNome: 'Federazione Italiana Skyrunning (FISky)',
      affiliateExpire: expDel,
      ultimoAnnoTesseramento: isValidExpireDate(expDel) ? parseInt(String(expDel).slice(0, 4), 10) : (isInCarica ? 2026 : 2021),
      statoTessera: isInCarica ? 'attiva' : 'scaduta'
    });
  }

  // Giudici di Gara FISky dataset - Include solo ed esclusivamente figure con nomina ufficiale in fedmembers o affiliazione wmembers
  const giudiceFedRecords = (fedRecordsByMember[idNum] || []).filter(f => {
    const r = (f.role || '').toLowerCase().trim();
    return r === 'giudice di gara';
  });
  const hasGiudiceWmem = affiliations.some(w => String(w.membertype_id) === '11');
  const hasGiudiceMembertype = (String(m.membertype_id) === '11');

  if (giudiceFedRecords.length > 0 || hasGiudiceWmem || hasGiudiceMembertype) {
    const fRec = giudiceFedRecords[0] || null;
    let qualifica = 'Giudice di gara';

    const isInCarica = fRec ? (fRec.in_carica !== false && fRec.stato !== 'Non più in carica') : true;
    // Standard federale ufficiale FISky per i Giudici di Gara: prefisso SKYJ + 6 cifre
    const cardGiu = `SKYJ${progressivo}`;
    const expGiu = maxExpireAll || (isInCarica ? '2026-12-31' : '2021-12-31');

    giudiciList.push({
      ...memberObj,
      fedId: fRec ? fRec.id : null,
      codice: cardGiu,
      numeroTessera: cardGiu,
      numeroTesseraGiudice: cardGiu,
      nominativo: `${m.surname || ''} ${m.name || ''}`.trim(),
      qualifica: qualifica,
      ruoloFederale: qualifica,
      regione: resolveMemberRegion(memberObj.regione, memberObj.provincia),
      stato: isInCarica ? 'In Carica' : 'Non più in carica',
      statoCarica: isInCarica ? 'In Carica' : 'Non più in carica',
      inCarica: isInCarica,
      tipoTessera: 'Giudice di Gara FISky',
      societaNome: memberObj.societaNome || 'Federazione Italiana Skyrunning (FISky)',
      affiliateExpire: expGiu,
      ultimoAnnoTesseramento: isValidExpireDate(expGiu) ? parseInt(String(expGiu).slice(0, 4), 10) : (isInCarica ? 2026 : 2021),
      statoTessera: isInCarica ? 'attiva' : 'scaduta'
    });
  }
});

// Lookup dictionaries by user_id for clubs, chronos, and members
const clubByUserId = {};
rawClubs.forEach(c => {
  if (c.user_id) clubByUserId[String(c.user_id)] = c;
});

const chronoByUserId = {};
rawChronos.forEach(ch => {
  if (ch.user_id) chronoByUserId[String(ch.user_id)] = ch;
});

const memberByUserId = {};
rawMembers.forEach(m => {
  if (m.user_id && String(m.user_id) !== '0') memberByUserId[String(m.user_id)] = m;
});

function computeUtenteDisplayLabel(userObj) {
  if (!userObj) return '';
  const uid = String(userObj.rawId || userObj.id || '').replace(/^u_/, '');
  const role = userObj.role || 'singolo';
  const club = (userObj.clubRawId && rawClubs.find(c => String(c.id) === String(userObj.clubRawId))) || clubByUserId[uid];
  const chrono = (userObj.chronoRawId && rawChronos.find(c => String(c.id) === String(userObj.chronoRawId))) || chronoByUserId[uid];
  const member = (userObj.memberRawId && rawMembers.find(m => String(m.id) === String(userObj.memberRawId))) || memberByUserId[uid];

  const uName = String(userObj.firstName || userObj.name || '').trim();
  const uSurname = String(userObj.lastName || userObj.surname || '').trim();

  if (role === 'societa') {
    const denom = (club && club.name ? String(club.name).trim() : '') ||
                  String(userObj.ragioneSociale || userObj.denominazione || '').trim() ||
                  uName ||
                  uSurname ||
                  String(userObj.nome || userObj.username || '').trim();
    return denom;
  }

  if (role === 'crono') {
    const denomCrono = (chrono && chrono.name ? String(chrono.name).trim() : '') ||
                       String(userObj.aziendaCrono || userObj.ragioneSociale || userObj.denominazione || '').trim();
    if (denomCrono) return denomCrono;
    if (uSurname && uName) {
      return uSurname.toLowerCase() === uName.toLowerCase() ? uSurname : `${uSurname} ${uName}`.trim();
    }
    return uSurname || uName || String(userObj.nome || userObj.username || '').trim();
  }

  // Persona (singolo / admin): Cognome Nome
  let cognome = (member && member.surname ? String(member.surname).trim() : '') || uSurname;
  let nome = (member && member.name ? String(member.name).trim() : '') || uName;

  if (!cognome && !nome && userObj.nome) {
    const full = String(userObj.nome).trim();
    const parts = full.split(/\s+/);
    if (parts.length === 2 && userObj.id && String(userObj.id).startsWith('usr_')) {
      nome = parts[0];
      cognome = parts[1];
    } else {
      return full;
    }
  }

  if (cognome && nome) {
    return cognome.toLowerCase() === nome.toLowerCase() ? cognome : `${cognome} ${nome}`.trim();
  }
  return cognome || nome || String(userObj.nome || userObj.username || '').trim();
}

// Format Users
const usersList = rawUsers.map(u => {
  const uid = String(u.id);
  const gId = Number(u.group_id);
  const isDefaultAdmin = String(u.username || '').toLowerCase() === 'admin';
  const club = clubByUserId[uid];
  const chrono = chronoByUserId[uid];
  const member = memberByUserId[uid];

  let role = 'singolo';
  if (gId === 1 || gId === 5 || isDefaultAdmin) role = 'admin';
  else if (gId === 2 || club) role = 'societa';
  else if (gId === 4 || chrono) role = 'crono';

  const baseObj = {
    id: `u_${u.id}`,
    rawId: String(u.id),
    username: u.username || '',
    password: isDefaultAdmin ? 'admin2026!' : (u.password ? (u.password.length === 40 ? 'Fisky2026*' : u.password) : 'Fisky2026*'),
    name: u.name || '',
    surname: u.surname || '',
    firstName: (member && member.name) || u.name || '',
    lastName: (member && member.surname) || u.surname || '',
    ragioneSociale: role === 'societa'
      ? ((club && club.name) || u.name || '')
      : (role === 'crono' ? ((chrono && chrono.name) || '') : ''),
    clubRawId: club ? String(club.id) : undefined,
    chronoRawId: chrono ? String(chrono.id) : undefined,
    memberRawId: member ? String(member.id) : undefined,
    email: u.email || (club && club.email) || (chrono && chrono.email) || (member && member.email) || (isDefaultAdmin ? 'segreteria@skyrunningitalia.it' : ''),
    role,
    group_id: String(u.group_id || '3'),
    status: u.status == 1 ? 'attivo' : 'sospeso',
    created: u.created || '',
    modified: u.modified || ''
  };

  const utenteLabel = computeUtenteDisplayLabel(baseObj);
  baseObj.utente = utenteLabel;
  baseObj.nome = utenteLabel || (isDefaultAdmin ? 'Segreteria Federale FISky' : u.username);

  return baseObj;
});

// Add our default admin guarantee
if (!usersList.some(u => u.username === 'admin')) {
  usersList.unshift({
    id: 'usr_admin',
    username: 'admin',
    password: 'admin2026!',
    utente: 'Segreteria Federale FISky',
    nome: 'Segreteria Federale FISky',
    email: 'segreteria@skyrunningitalia.it',
    role: 'admin',
    status: 'attivo'
  });
}

// Load any dynamic additions stored in local JSON files
const dynamicUsers = readJsonFile('users.json', []);
dynamicUsers.forEach(u => {
  const exIdx = usersList.findIndex(ex => ex.username && u.username && ex.username.toLowerCase() === u.username.toLowerCase());
  if (exIdx !== -1) {
    const merged = { ...usersList[exIdx], ...u };
    merged.utente = computeUtenteDisplayLabel(merged);
    merged.nome = merged.utente || merged.nome;
    usersList[exIdx] = merged;
  } else {
    const newDyn = { ...u };
    newDyn.utente = computeUtenteDisplayLabel(newDyn);
    newDyn.nome = newDyn.utente || newDyn.nome;
    usersList.unshift(newDyn);
  }
});

// Ensure 'admin' user always has role 'admin' and standard password 'admin2026!'
usersList.forEach(u => {
  if (u.username && u.username.toLowerCase() === 'admin') {
    u.role = 'admin';
    u.password = 'admin2026!';
    u.status = 'attivo';
    if (!u.utente) u.utente = u.nome || 'Fisky';
  }
});

// ================= LOG OPERAZIONI (AUDIT & FRONTEND REQUESTS LOG) ================= //
function formatIsoToItalianDateTime(isoStr) {
  try {
    const d = isoStr ? new Date(isoStr) : new Date();
    if (isNaN(d.getTime())) return String(isoStr || '');
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) {
    return String(isoStr || '');
  }
}

let operationsLogList = readJsonFile('operations_log.json', []);

if (!Array.isArray(operationsLogList) || operationsLogList.length === 0) {
  const sentEmails = readJsonFile('sent_emails_log.json', []);
  const seedLogs = [];
  let seq = 1;

  // Seed historical system initialization & recent real operations
  seedLogs.push({
    id: `log_${seq}`,
    logNumber: seq++,
    timestamp: '2026-11-05T14:30:00.000Z',
    dataOra: formatIsoToItalianDateTime('2026-11-05T14:30:00.000Z'),
    origine: 'admin',
    categoria: 'Amministrazione Sistema',
    azione: 'Importazione e Sincronizzazione Database Federale',
    operatore: 'admin (Segreteria Federale FISky)',
    ruolo: 'admin',
    ruoloLabel: 'Amministratore',
    ruoloOperatore: 'admin',
    oggetto: 'Database MySQL FISky (Sql749512_1.sql)',
    dettagli: `Importazione integrale di ${clubsList.length} società sportive, ${membersList.length} anagrafiche tesserati, ${raceRequestsList.length} richieste gare e ${calendarioGareList.length} gare a calendario ufficiale.`,
    ip: '127.0.0.1',
    metodo: 'SYSTEM INIT',
    esito: 'OK'
  });

  // Seed recent race requests from database
  const recentRaces = [...raceRequestsList]
    .sort((a, b) => String(a.dataInserimento || '').localeCompare(String(b.dataInserimento || '')))
    .slice(-5);

  recentRaces.forEach(r => {
    const ts = r.dataInserimento && /^\d{4}-\d{2}-\d{2}$/.test(r.dataInserimento)
      ? `${r.dataInserimento}T10:15:00.000Z`
      : '2026-11-06T10:15:00.000Z';
    seedLogs.push({
      id: `log_${seq}`,
      logNumber: seq++,
      timestamp: ts,
      dataOra: formatIsoToItalianDateTime(ts),
      origine: 'frontend',
      categoria: 'Richiesta Inserimento Gara',
      azione: 'Nuova Richiesta Inserimento Gara in Calendario',
      operatore: r.promotore || 'Società Organizzatrice',
      ruolo: 'societa',
      ruoloLabel: 'Società Sportiva',
      ruoloOperatore: 'societa',
      oggetto: `${r.nomeGara} (ID #${r.rawId} - Anno ${r.annoRiferimento})`,
      dettagli: `Richiesta inserimento gara "${r.nomeGara}" a ${r.localita} (${r.regione}) per il ${r.dataGara}. Specialità: ${r.specialita}, Tipo: ${r.tipoRichiesta}. Stato attuale: ${r.statoLabel}.`,
      ip: '127.0.0.1',
      metodo: 'POST /api/richieste-gare',
      esito: 'OK'
    });
  });

  // Seed from sent_emails_log.json (real frontend registrations)
  sentEmails.slice().reverse().forEach(em => {
    const ts = em.sentAt || new Date().toISOString();
    const rCode = (em.role || '').toLowerCase().includes('societ') ? 'societa' : ((em.role || '').toLowerCase().includes('crono') ? 'crono' : 'singolo');
    const rLabel = rCode === 'societa' ? 'Società Sportiva' : (rCode === 'crono' ? 'Azienda Cronometraggio' : 'Tesserato Singolo');
    seedLogs.push({
      id: `log_${seq}`,
      logNumber: seq++,
      timestamp: ts,
      dataOra: formatIsoToItalianDateTime(ts),
      origine: 'frontend',
      categoria: 'Richiesta Registrazione',
      azione: `Richiesta di Registrazione (${em.role || 'Utente'})`,
      operatore: `${em.username} (${em.nome})`,
      ruolo: rCode,
      ruoloLabel: rLabel,
      ruoloOperatore: rCode,
      oggetto: `${em.nome} (Codice assegnato: ${em.codiceAssegnato})`,
      dettagli: `Registrazione completata dal frontend per "${em.nome}". Username attribuito: ${em.username}, Email: ${em.to}, Codice progressivo: ${em.codiceAssegnato}. Credenziali inviate via email.`,
      ip: '127.0.0.1',
      metodo: 'POST /api/auth/register',
      esito: 'OK'
    });
  });

  // Check if SkyGiotto also completed profile
  const giottoUser = dynamicUsers.find(u => u.username === 'SkyGiotto' && u.profileCompleted);
  if (giottoUser) {
    const ts = '2026-11-07T07:05:10.000Z';
    seedLogs.push({
      id: `log_${seq}`,
      logNumber: seq++,
      timestamp: ts,
      dataOra: formatIsoToItalianDateTime(ts),
      origine: 'frontend',
      categoria: 'Anagrafica Utente',
      azione: 'Aggiornamento Anagrafica Società Sportiva',
      operatore: `${giottoUser.username} (${giottoUser.nome})`,
      ruolo: 'societa',
      ruoloLabel: 'Società Sportiva',
      ruoloOperatore: 'societa',
      oggetto: `Società: ${giottoUser.nome} (Cod. ${giottoUser.codiceSocieta || '10297'})`,
      dettagli: `Salvataggio e validazione dei dati anagrafici obbligatori al primo accesso per la società "${giottoUser.nome}" (Email: ${giottoUser.email}, Tel: ${giottoUser.telefono || '-'}).`,
      ip: '127.0.0.1',
      metodo: 'PUT /api/profile/societa',
      esito: 'OK'
    });
  }

  // Sort descending by timestamp (newest first)
  operationsLogList = seedLogs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  writeJsonFile('operations_log.json', operationsLogList);
}

function appendOperationLog(entry = {}) {
  try {
    const nowIso = entry.timestamp || new Date().toISOString();
    const maxNum = operationsLogList.reduce((max, item) => Math.max(max, Number(item.logNumber) || 0), 0);
    const nextNum = maxNum + 1;
    const ruoloVal = String(entry.ruolo || entry.ruoloOperatore || 'pubblico').trim();
    const ruoloLbl = String(entry.ruoloLabel || entry.ruolo || entry.ruoloOperatore || 'Utente Frontend').trim();

    const logItem = {
      id: `log_${nextNum}_${Date.now()}`,
      logNumber: nextNum,
      timestamp: nowIso,
      dataOra: formatIsoToItalianDateTime(nowIso),
      origine: entry.origine === 'admin' ? 'admin' : 'frontend',
      categoria: String(entry.categoria || 'Sistema').trim(),
      azione: String(entry.azione || 'Operazione eseguita').trim(),
      operatore: String(entry.operatore || 'Visitatore / Utente').trim(),
      ruolo: ruoloVal,
      ruoloLabel: ruoloLbl,
      ruoloOperatore: ruoloVal,
      oggetto: String(entry.oggetto || '-').trim(),
      dettagli: String(entry.dettagli || '').trim(),
      ip: String(entry.ip || '127.0.0.1').trim(),
      metodo: String(entry.metodo || '').trim(),
      esito: entry.esito === 'ERRORE' ? 'ERRORE' : 'OK'
    };

    operationsLogList.unshift(logItem);
    // Keep up to 5000 entries in JSON
    if (operationsLogList.length > 5000) {
      operationsLogList.length = 5000;
    }
    writeJsonFile('operations_log.json', operationsLogList);

    // Also append a formatted text line to data/operations.log
    const logLine = `[${logItem.dataOra}] [#${logItem.logNumber}] [${logItem.origine.toUpperCase()}] [${logItem.categoria}] [${logItem.esito}] Operatore: ${logItem.operatore} (${logItem.ruoloOperatore}) | Azione: ${logItem.azione} | Oggetto: ${logItem.oggetto} | Dettagli: ${logItem.dettagli} | IP: ${logItem.ip} | ${logItem.metodo}\n`;
    fs.appendFileSync(path.join(DATA_DIR, 'operations.log'), logLine, 'utf-8');

    return logItem;
  } catch (err) {
    console.error('Errore durante la scrittura del log operazione:', err);
    return null;
  }
}

function isFormatValidEmail(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(s);
}

function resolveNewsletterRecipients(config = {}) {
  const cfg = { ...rawNewsletterSettings, ...config };
  const emails = new Set();
  const descParts = [];

  const activeClubs = clubsList.filter(c => c.isAttiva);
  const activeClubRawIds = new Set(activeClubs.map(c => String(c.rawId)));

  // Se manuale è attivo ed esclude tutti gli altri
  if (cfg.manual_active) {
    const rawList = String(cfg.manual_emails || '')
      .split(/[\r\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const valid = [];
    const invalid = [];
    rawList.forEach(e => {
      if (isFormatValidEmail(e)) {
        valid.push(e.toLowerCase());
      } else {
        invalid.push(e);
      }
    });
    valid.forEach(e => emails.add(e));
    return {
      recipients: Array.from(emails),
      total: emails.size,
      targetDesc: `Inserimento Manuale (${emails.size} indirizzi)`,
      invalidEmails: invalid,
      isManual: true,
      optionsUsed: { manual: true, count: emails.size }
    };
  }

  // Se tutti i tesserati è attivo: "Tutti i tesserati tramite società e liberi" attivi per la stagione in corso
  if (cfg.tesserati) {
    membersList.filter(m => m.statoTessera === 'attiva').forEach(m => {
      if (isFormatValidEmail(m.email)) emails.add(m.email.trim().toLowerCase());
    });
    atletiList.filter(a => a.statoTessera === 'attiva').forEach(a => {
      if (isFormatValidEmail(a.email)) emails.add(a.email.trim().toLowerCase());
    });
    return {
      recipients: Array.from(emails),
      total: emails.size,
      targetDesc: `Tutti i tesserati tramite società e liberi (${emails.size} destinatari)`,
      invalidEmails: [],
      isTesserati: true,
      optionsUsed: { tesserati: true, count: emails.size }
    };
  }

  // Helper per verificare se un membro/tesserato è in carica/attivo per la stagione in corso
  function isMemberActiveForSeason(m) {
    return m.statoTessera === 'attiva' ||
           (m.affiliateExpire && m.affiliateExpire >= '2026-01-01') ||
           (m.ultimoAnnoTesseramento && m.ultimoAnnoTesseramento >= 2026);
  }

  // Scelte multiple ammesse tra: Società affiliate, Presidenti, Vicepresidenti, Consiglieri/Segretari
  if (cfg.societa) {
    activeClubs.forEach(c => {
      const prefEmail = (c.email && isFormatValidEmail(c.email))
        ? c.email.trim().toLowerCase()
        : ((c.c_email && isFormatValidEmail(c.c_email)) ? c.c_email.trim().toLowerCase() : (c.email2 && isFormatValidEmail(c.email2) ? c.email2.trim().toLowerCase() : null));
      if (prefEmail) emails.add(prefEmail);
    });
    descParts.push('Indirizzi mail di riferimento delle società affiliate');
  }

  if (cfg.presidenti) {
    activeClubs.forEach(c => {
      const socMembers = membersList.filter(m => String(m.societaId) === String(c.rawId) && isMemberActiveForSeason(m));
      const pres = socMembers.find(m => (m.ruoliSocietari || []).some(r => r.toLowerCase().includes('president') && !r.toLowerCase().includes('vice')));
      if (pres && pres.email && isFormatValidEmail(pres.email)) {
        emails.add(pres.email.trim().toLowerCase());
      } else if (c.c_email && isFormatValidEmail(c.c_email)) {
        emails.add(c.c_email.trim().toLowerCase());
      } else if (c.email && isFormatValidEmail(c.email)) {
        emails.add(c.email.trim().toLowerCase());
      }
    });
    descParts.push('Tutti i presidenti delle società affiliate');
  }

  if (cfg.vicepresidenti) {
    activeClubs.forEach(c => {
      const socMembers = membersList.filter(m => String(m.societaId) === String(c.rawId) && isMemberActiveForSeason(m));
      const vp = socMembers.find(m => (m.ruoliSocietari || []).some(r => r.toLowerCase().includes('vicepresident')));
      if (vp && vp.email && isFormatValidEmail(vp.email)) {
        emails.add(vp.email.trim().toLowerCase());
      }
    });
    descParts.push('Tutti i vicepresidenti delle società affiliate');
  }

  if (cfg.consiglieri_segretari) {
    activeClubs.forEach(c => {
      const socMembers = membersList.filter(m => String(m.societaId) === String(c.rawId) && isMemberActiveForSeason(m));
      socMembers.forEach(m => {
        const ruoli = m.ruoliSocietari || [];
        if (ruoli.some(r => r.toLowerCase().includes('consigliere') || r.toLowerCase().includes('segretar'))) {
          if (m.email && isFormatValidEmail(m.email)) {
            emails.add(m.email.trim().toLowerCase());
          }
        }
      });
    });
    descParts.push('Tutti i consiglieri/segretari delle società affiliate');
  }

  return {
    recipients: Array.from(emails),
    total: emails.size,
    targetDesc: descParts.length ? descParts.join(' + ') : 'Nessun destinatario selezionato',
    invalidEmails: [],
    isManual: false,
    optionsUsed: {
      societa: !!cfg.societa,
      presidenti: !!cfg.presidenti,
      vicepresidenti: !!cfg.vicepresidenti,
      consiglieri_segretari: !!cfg.consiglieri_segretari
    }
  };
}

function saveNewsletters() {
  writeJsonFile('mysql_newsletters.json', rawNewsletters);
}

function saveQueueNewsletters() {
  writeJsonFile('mysql_queuenewsletters.json', rawQueueNewsletters);
}

function saveNewsletterSettings(settings) {
  Object.assign(rawNewsletterSettings, settings);
  writeJsonFile('newsletter_settings.json', rawNewsletterSettings);
  return rawNewsletterSettings;
}

function saveNewsletterCustomConfig(id, config) {
  rawNewsletterConfigs[String(id)] = config;
  writeJsonFile('newsletter_custom_configs.json', rawNewsletterConfigs);
  return config;
}

function deleteNewsletterCustomConfig(id) {
  delete rawNewsletterConfigs[String(id)];
  writeJsonFile('newsletter_custom_configs.json', rawNewsletterConfigs);
}

function getNewsletterConfig(id) {
  if (id && rawNewsletterConfigs[String(id)]) {
    return { ...rawNewsletterConfigs[String(id)], isCustom: true };
  }
  return { ...rawNewsletterSettings, isCustom: false };
}

console.log('=== DATABASE ADAPTER FISKY INIZIALIZZATO ===');
console.log(`- Società Sportive: ${clubsList.length}`);
console.log(`- Aziende Cronometristi: ${chronosList.length}`);
console.log(`- Persone in Anagrafe: ${membersList.length}`);
console.log(`- Atleti Tesserati (SKYA): ${atletiList.length}`);
console.log(`- Figure Dirigenziali della Federazione (FISKY): ${dirigentiList.length}`);
console.log(`- Guide Percorso (SKYG): ${guideList.length}`);
console.log(`- Delegati Regionali: ${delegatiList.length}`);
console.log(`- Giudici di Gara: ${giudiciList.length}`);
console.log(`- Richieste Gare: ${raceRequestsList.length} (Nuove: ${raceRequestsList.filter(r => r.statoGara === 'nuova').length})`);
console.log(`- Calendario Gare Ufficiale: ${calendarioGareList.length} gare a calendario`);
console.log(`- Utenti Registrati: ${usersList.length}`);
function getPrezzi() {
  return rawPrezzi;
}

function getPrezziMeta() {
  return rawPrezziMeta;
}

function savePrezzi(list) {
  rawPrezzi.length = 0;
  rawPrezzi.push(...list);
  writeJsonFile('mysql_prezzi.json', rawPrezzi);
  return rawPrezzi;
}

function updatePrezzo(id, updates) {
  const idx = rawPrezzi.findIndex(p => String(p.id) === String(id) || String(p.code) === String(id));
  if (idx === -1) return null;
  
  const current = rawPrezzi[idx];
  Object.assign(current, updates, {
    updated_at: new Date().toISOString()
  });
  
  if (updates.prezzo !== undefined) {
    const num = parseFloat(updates.prezzo);
    if (!isNaN(num)) {
      current.prezzo = num;
      if (num === 0 && (current.prezzo_tipo === 'gratuito' || String(updates.prezzo_tipo).toLowerCase() === 'gratuito')) {
        current.prezzo_formatted = 'Gratuito';
      } else {
        current.prezzo_formatted = num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
      }
    }
  }
  
  writeJsonFile('mysql_prezzi.json', rawPrezzi);
  return current;
}

function savePrezziMeta(meta) {
  Object.assign(rawPrezziMeta, meta);
  writeJsonFile('quote_prezzi_meta.json', rawPrezziMeta);
  return rawPrezziMeta;
}

console.log(`- Notizie Storiche: ${rawNews.length}`);
console.log(`- Newsletter in Archivio: ${rawNewsletters.length}`);
console.log(`- Invii Newsletter Tracciati: ${rawQueueNewsletters.length}`);
console.log(`- Log Operazioni Tracciate: ${operationsLogList.length}`);
console.log(`- Quote Prezzi Tabella: ${rawPrezzi.length}`);

module.exports = {
  rawPrezzi,
  rawPrezziMeta,
  getPrezzi,
  getPrezziMeta,
  savePrezzi,
  updatePrezzo,
  savePrezziMeta,
  rawClubs,
  rawChronos,
  rawMembers,
  rawUsers,
  clubsList,
  chronosList,
  membersList,
  atletiList,
  dirigentiList,
  guideList,
  delegatiList,
  giudiciList,
  rawRequests,
  raceRequestsList,
  buildRaceRequestObj,
  calendarioGareList,
  buildCalendarEntryFromRaceRequest,
  syncRaceRequestToCalendar,
  removeRaceRequestFromCalendar,
  CATEGORY_RACES_MAP,
  RACE_TYPES_MAP,
  computeAthleteCategory,
  getAthleteCategoryParams2026,
  ensureCurrentYearCategories,
  getCategoryReferenceYear,
  ATHLETE_CATEGORIES_ORDER_2026,
  usersList,
  computeUtenteDisplayLabel,
  rawNews,
  rawNewsletters,
  rawQueueNewsletters,
  rawNewsletterSettings,
  saveNewsletters,
  saveQueueNewsletters,
  saveNewsletterSettings,
  saveNewsletterCustomConfig,
  deleteNewsletterCustomConfig,
  getNewsletterConfig,
  resolveNewsletterRecipients,
  isFormatValidEmail,
  rawPayments,
  rawPaymentitems,
  rawPaymentinfos,
  rawPaymentrequests,
  rawInvoices,
  rawAccounts,
  accountByUser,
  rawWebpages,
  rawMenus,
  rawSliders,
  rawContenitori,
  saveContenitori,
  rawSlugs,
  operationsLogList,
  appendOperationLog,
  formatIsoToItalianDateTime,
  rawFedmembers,
  rawWmembers,
  resolveMemberRegion,
  CANONICAL_REGIONS,
  writeJsonFile
};
