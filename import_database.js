const fs = require('fs');
const readline = require('readline');
const path = require('path');

function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str;
  if (!/[ÃÂâ]/.test(str)) return str;
  try {
    const fixed = Buffer.from(str, 'binary').toString('utf8');
    if (!fixed.includes('\ufffd')) {
      return fixed;
    }
  } catch (e) {}
  return str;
}

function parseSqlRow(rowStr) {
  // Strip outer ( and ), or );
  let trimmed = rowStr.trim();
  if (trimmed.startsWith('(')) trimmed = trimmed.substring(1);
  if (trimmed.endsWith(';')) trimmed = trimmed.substring(0, trimmed.length - 1);
  if (trimmed.endsWith(',')) trimmed = trimmed.substring(0, trimmed.length - 1);
  if (trimmed.endsWith(')')) trimmed = trimmed.substring(0, trimmed.length - 1);

  const values = [];
  let currentVal = '';
  let inString = false;
  let stringChar = '';
  let escaped = false;
  let wasString = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escaped) {
      if (char === 'r') {
        currentVal += '\r';
      } else if (char === 'n') {
        currentVal += '\n';
      } else if (char === 't') {
        currentVal += '\t';
      } else if (char === '0') {
        currentVal += '\0';
      } else if (char === 'Z') {
        currentVal += '\x1a';
      } else {
        currentVal += char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === stringChar) {
        if (trimmed[i + 1] === stringChar) {
          currentVal += stringChar;
          i++;
        } else {
          inString = false;
        }
      } else {
        currentVal += char;
      }
      continue;
    }

    if (!wasString && (char === "'" || char === '"')) {
      inString = true;
      wasString = true;
      stringChar = char;
      currentVal = '';
      continue;
    }

    if (char === ',') {
      if (wasString) {
        values.push(fixMojibake(currentVal));
      } else {
        const v = currentVal.trim();
        values.push(v === 'NULL' ? null : v);
      }
      currentVal = '';
      wasString = false;
      continue;
    }

    // Only collect unquoted characters if we haven't already closed a string
    if (!wasString) {
      currentVal += char;
    }
  }

  if (wasString) {
    values.push(fixMojibake(currentVal));
  } else {
    const v = currentVal.trim();
    values.push(v === 'NULL' ? null : v);
  }
  return values;
}

async function runImport() {
  console.log('Avvio parsing del file SQL: Sql749512_1.sql...');
  const sqlPath = path.join(__dirname, 'Sql749512_1.sql');
  const fileStream = fs.createReadStream(sqlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const targetTables = ['accounts', 'clubs', 'chronos', 'members', 'races', 'racerequests', 'racerequests_racetypes', 'news', 'users', 'payments', 'webpages', 'wmembers', 'membertypes', 'fedmembers', 'slugs', 'menus'];
  const extracted = {};
  targetTables.forEach(t => extracted[t] = []);

  let activeTable = null;
  let activeCols = [];
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    const trimmed = line.trim();

    // Check for start of INSERT INTO
    if (trimmed.startsWith('INSERT INTO `')) {
      const match = trimmed.match(/^INSERT INTO `([^`]+)`\s*\(([^)]+)\)/);
      if (match) {
        const tbl = match[1];
        if (targetTables.includes(tbl)) {
          activeTable = tbl;
          activeCols = match[2].split(',').map(c => c.trim().replace(/`/g, ''));
        } else {
          activeTable = null;
          activeCols = [];
        }
      }
      continue;
    }

    // If currently capturing rows for an activeTable
    if (activeTable && trimmed.startsWith('(')) {
      const rowValues = parseSqlRow(trimmed);
      const rowObj = {};
      activeCols.forEach((colName, idx) => {
        rowObj[colName] = rowValues[idx] !== undefined ? rowValues[idx] : null;
      });
      extracted[activeTable].push(rowObj);

      if (trimmed.endsWith(';')) {
        activeTable = null;
        activeCols = [];
      }
    }
  }

  console.log(`\nParsing completato su ${lineCount} righe del dump.`);
  console.log('=== RECORD ESTRATTI DAL DATABASE MYSQL ORIGINALE ===');
  for (const [tbl, list] of Object.entries(extracted)) {
    console.log(`- ${tbl.toUpperCase()}: ${list.length} record`);
  }

  // Post-processing: normalize FISO codes in clubs & decode authentic creation timestamps in racerequests
  if (extracted.clubs) {
    extracted.clubs.forEach(c => {
      if (c.fisoId) {
        c.fisoId = String(c.fisoId).trim().replace(/^0+(?=\d)/, '');
      }
    });
  }

  if (extracted.racerequests) {
    extracted.racerequests.forEach(r => {
      if (!r.created || r.created === '0000-00-00') {
        if (r.code) {
          const ts = parseInt(String(r.code).split('-')[0], 10);
          if (!isNaN(ts) && ts > 1000000000) {
            r.created = new Date(ts * 1000).toISOString().slice(0, 10);
          }
        }
        if (!r.created || r.created === '0000-00-00') {
          r.created = (r.payed_date && r.payed_date !== '0000-00-00') ? r.payed_date : (r.date || null);
        }
      }

      // Calcolo anno_riferimento della richiesta gara
      const dateStr = (r.date && r.date !== '0000-00-00') ? String(r.date).trim() : '';
      const createdStr = (r.created && r.created !== '0000-00-00') ? String(r.created).trim() : '';
      let annoRif = dateStr.length >= 4
        ? parseInt(dateStr.slice(0, 4), 10)
        : (createdStr.length >= 4 ? parseInt(createdStr.slice(0, 4), 10) + 1 : 2027);
      if (dateStr && createdStr && dateStr === createdStr && parseInt(createdStr.slice(5, 7), 10) >= 10 && Number(r.id) > 470) {
        annoRif = annoRif + 1;
      }
      r.anno_riferimento = String(annoRif);
    });
  }

  // Costruzione tabella calendario_gare (da webpages "Calendario*" escluso "Calendario 2023 provvisorio" + richieste gare accettate)
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

  const clubById = {};
  const clubByNorm = {};
  (extracted.clubs || []).forEach(c => {
    clubById[String(c.id)] = c;
    if (c.name) {
      clubByNorm[c.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = c;
    }
  });

  const rtByReqId = {};
  (extracted.racerequests_racetypes || []).forEach(row => {
    const k = String(row.racerequest_id);
    if (!rtByReqId[k]) rtByReqId[k] = [];
    rtByReqId[k].push(String(row.racetype_id));
  });

  function decodeHtmlEntities(str) {
    return String(str || '')
      .replace(/<br\s*\/?>/gi, ' / ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, '&')
      .replace(/&agrave;/gi, 'à')
      .replace(/&egrave;/gi, 'è')
      .replace(/&eacute;/gi, 'é')
      .replace(/&igrave;/gi, 'ì')
      .replace(/&ograve;/gi, 'ò')
      .replace(/&ugrave;/gi, 'ù')
      .replace(/&uuml;/gi, 'ü')
      .replace(/&deg;/gi, '°')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseItalianDateToIso(dStr, fallbackYear) {
    const m = String(dStr || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    return `${fallbackYear}-12-31`;
  }

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

  function formatLocalitaWithProv(r) {
    let w = String(r.where || '').trim();
    if (!w) return '';
    // Normalize existing (xx) at end to uppercase
    const endMatch = w.match(/^(.*?)\s*\(\s*([A-Za-z]{2})\s*\)\s*$/);
    if (endMatch) {
      return `${endMatch[1].trim()} (${endMatch[2].toUpperCase()})`;
    }
    let prov = '';
    if (r.club_id && clubById[String(r.club_id)] && clubById[String(r.club_id)].province) {
      prov = String(clubById[String(r.club_id)].province).trim().toUpperCase();
    }
    if (!prov && r.from) {
      const nf = String(r.from).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clubByNorm[nf] && clubByNorm[nf].province) {
        prov = String(clubByNorm[nf].province).trim().toUpperCase();
      } else {
        for (const [k, c] of Object.entries(clubByNorm)) {
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

  function formatCircuitoTitoli(r) {
    const typesSet = new Set();
    if (r.championships && String(r.championships).trim()) {
      String(r.championships).split(';').map(s => s.trim()).filter(Boolean).forEach(part => {
        if (part === '14') return; // Escludi "Inserimento normale in calendario"
        if (RACE_TYPES_MAP[part]) {
          typesSet.add(RACE_TYPES_MAP[part]);
        } else if (part.toLowerCase() !== 'inserimento normale in calendario') {
          typesSet.add(part);
        }
      });
    }
    const joinIds = rtByReqId[String(r.id)] || [];
    joinIds.forEach(rtId => {
      if (rtId === '14') return;
      if (RACE_TYPES_MAP[rtId]) {
        typesSet.add(RACE_TYPES_MAP[rtId]);
      }
    });
    if (typesSet.size === 0 && r.series && String(r.series).trim()) {
      String(r.series).split(';').map(s => s.trim()).filter(Boolean).forEach(part => {
        if (part !== '14' && part.toLowerCase() !== 'inserimento normale in calendario') {
          typesSet.add(part);
        }
      });
    }
    if (String(r.otherChampionship) === '1' && r.otherChampionshipTxt && String(r.otherChampionshipTxt).trim()) {
      typesSet.add(String(r.otherChampionshipTxt).trim());
    }
    return Array.from(typesSet).join(' / ');
  }

  function formatDistanzaKm(distRaw) {
    if (!distRaw || String(distRaw).trim() === '' || String(distRaw).trim() === '0') return '';
    let s = String(distRaw).trim().replace(/^km\s*/i, '').trim();
    // Se inserito in metri interi (es. 23500 -> 23,5)
    if (/^\d{4,5}$/.test(s)) {
      const kmVal = parseInt(s, 10) / 1000;
      return `Km ${String(kmVal).replace('.', ',')}`;
    }
    // Se ha formato 33.750 o 13.000 (con 3 decimali da metri)
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

  const calendarioGare = [];
  const webpageYearsPopulated = new Set();

  // 1. Estrazione calendari da webpages ("Calendario*" escludendo "Calendario 2023 provvisorio")
  (extracted.webpages || []).forEach(p => {
    const title = String(p.title || '').trim();
    if (!title.toLowerCase().startsWith('calendario')) return;
    if (title.toLowerCase().includes('provvisorio')) return;

    let yearMatch = title.match(/(20\d{2})/);
    if (!yearMatch && p.text) {
      yearMatch = String(p.text).match(/Calendario\s+gare\s+(20\d{2})/i);
    }
    const calYear = yearMatch ? yearMatch[1] : null;
    if (!calYear) return;

    webpageYearsPopulated.add(calYear);
    const trs = String(p.text || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
    let rowIdx = 0;

    trs.forEach(tr => {
      const tds = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
      if (tds.length < 5) return;

      const dataCol = decodeHtmlEntities(tds[0]);
      const manifestazioneCol = decodeHtmlEntities(tds[1]);
      if (!dataCol || !manifestazioneCol) return;

      // In ID 37 (2021) escludi le ultime 2 righe che appartengono all'ottobre 2022
      if (calYear === '2021' && dataCol.includes('/2022')) return;

      const hrefMatch = String(tds[1] || '').match(/href=["']([^"']+)["']/i);
      const url = hrefMatch ? hrefMatch[1].trim() : '';
      const tipologiaCol = decodeHtmlEntities(tds[2]);
      const localitaCol = decodeHtmlEntities(tds[3]);
      const circuitoCol = decodeHtmlEntities(tds[4]);
      const distanzaCol = decodeHtmlEntities(tds[5]);
      const dislivelloCol = decodeHtmlEntities(tds[6]);

      rowIdx++;
      calendarioGare.push({
        id: `cal_wp_${calYear}_${rowIdx}`,
        anno: calYear,
        data: dataCol,
        dataIso: parseItalianDateToIso(dataCol, calYear),
        manifestazione: manifestazioneCol,
        url,
        tipologia: tipologiaCol,
        localita: localitaCol,
        circuitoTitoli: circuitoCol,
        distanza: distanzaCol,
        dislivello: dislivelloCol,
        source: 'webpage',
        racerequest_id: null
      });
    });
  });

  // 2. Popolamento da racerequests accettate (per le annate nuove come 2027 o richieste accettate non già presenti)
  (extracted.racerequests || []).forEach(r => {
    if (r.status !== 'accepted') return;
    const annoRif = String(r.anno_riferimento || '');
    if (!annoRif || Number(annoRif) < 2021) return;

    // Se l'annata è già stata popolata integralmente dalla tabella webpages (2021-2026), evitiamo duplicati
    if (webpageYearsPopulated.has(annoRif)) return;

    calendarioGare.push({
      id: `cal_req_${r.id}`,
      anno: annoRif,
      data: formatIsoToItalianDate(r.date, r.date_end),
      dataIso: (r.date && r.date !== '0000-00-00') ? String(r.date).trim() : `${annoRif}-12-31`,
      manifestazione: String(r.title || '').trim(),
      url: String(r.url || '').trim(),
      tipologia: CATEGORY_RACES_MAP[String(r.categoryrace_id)] || 'Skyrace',
      localita: formatLocalitaWithProv(r),
      circuitoTitoli: formatCircuitoTitoli(r),
      distanza: formatDistanzaKm(r.distance),
      dislivello: formatDislivelloDplus(r.drop_pos),
      source: 'racerequest',
      racerequest_id: String(r.id)
    });
  });

  extracted.calendario_gare = calendarioGare;

  // Save to JSON in data/
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  for (const [tbl, list] of Object.entries(extracted)) {
    const outPath = path.join(dataDir, `mysql_${tbl}.json`);
    fs.writeFileSync(outPath, JSON.stringify(list, null, 2), 'utf-8');
  }
  console.log('\nTutte le tabelle salvate in data/mysql_*.json con successo!');
}

runImport().catch(console.error);
