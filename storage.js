const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ATLETI_FILE = path.join(DATA_DIR, 'atleti.json');
const GARE_FILE = path.join(DATA_DIR, 'richieste_gare.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, defaultValue = []) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const data = fs.readFileSync(file, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error(`Errore lettura ${file}:`, err);
    return defaultValue;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// Generate automatic password: e.g. "Sky#7x9Q2"
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  let pwd = 'Sky#';
  for (let i = 0; i < 6; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

// Generate clean username from name/ragione sociale
function generateUsername(role, name) {
  const prefix = {
    societa: 'soc',
    singolo: 'atl',
    crono: 'crono',
    admin: 'admin'
  }[role] || 'usr';

  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10);
  const random = Math.floor(100 + Math.random() * 900);
  return `${prefix}_${clean || 'utente'}${random}`;
}

// Initial seed if empty
function initSeeds() {
  const users = readJson(USERS_FILE, []);
  if (users.length === 0) {
    const defaultUsers = [
      {
        id: 'usr_admin',
        username: 'admin',
        password: 'admin2026!',
        role: 'admin',
        nome: 'Segreteria Federale FISky',
        email: 'segreteria@skyrunningitalia.it',
        telefono: '0862.1960234',
        status: 'attivo',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_soc_1',
        username: 'soc_valetudo',
        password: 'Sky#Soc2026',
        role: 'societa',
        nome: 'ASD Valetudo Skyrunning Italia',
        ragioneSociale: 'ASD Valetudo Skyrunning Italia',
        codiceFiscale: '91029380164',
        partitaIva: '02819200165',
        codiceAffiliazione: 'FISKY-BG-001',
        legaleRappresentante: 'Giorgio Pesenti',
        sede: 'Almenno San Salvatore (BG)',
        email: 'info@valetudoskyrunning.it',
        telefono: '348.5521478',
        status: 'attivo',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_atl_1',
        username: 'atl_rossi',
        password: 'Sky#Atl2026',
        role: 'singolo',
        nome: 'Marco Rossi',
        codiceFiscale: 'RSSMRC92M15A944B',
        dataNascita: '1992-08-15',
        ruoloSportivo: 'Atleta Agonista',
        indirizzo: 'Via Delle Cime 12, Lecco (LC)',
        email: 'marco.rossi@example.com',
        telefono: '333.1234567',
        tesseraNumero: 'FISKY-26-1042',
        scadenzaCertificato: '2027-04-15',
        status: 'attivo',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_crono_1',
        username: 'crono_alps',
        password: 'Sky#Crono2026',
        role: 'crono',
        nome: 'Wedosport Alps Timing',
        ragioneSociale: 'Wedosport S.r.l.',
        partitaIva: '01827460012',
        referenteTecnico: 'Roberto Brambilla',
        email: 'timing@wedosport.net',
        telefono: '011.9876543',
        sistemiRilevamento: ['Chip RFID a transponder attivo', 'Live Web Tracking', 'Backup fotocellula'],
        status: 'attivo',
        createdAt: new Date().toISOString()
      }
    ];
    writeJson(USERS_FILE, defaultUsers);
  }

  const atleti = readJson(ATLETI_FILE, []);
  if (atleti.length === 0) {
    const defaultAtleti = [
      {
        id: 'atl_001',
        societaId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nome: 'Christian',
        cognome: 'Minoggio',
        codiceFiscale: 'MNGCRS84D12C933H',
        dataNascita: '1984-04-12',
        sesso: 'M',
        categoria: 'Master M 40',
        numeroTessera: 'FISKY-26-0812',
        tipoTessera: 'Agonistica Nazionale',
        certificatoMedicoScadenza: '2027-02-28',
        statoTessera: 'attiva',
        email: 'c.minoggio@example.com',
        telefono: '340.1122334',
        createdAt: new Date().toISOString()
      },
      {
        id: 'atl_002',
        societaId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nome: 'Giulia',
        cognome: 'Murada',
        codiceFiscale: 'MRDGLI98H45L174X',
        dataNascita: '1998-07-05',
        sesso: 'F',
        categoria: 'Senior',
        numeroTessera: 'FISKY-26-0945',
        tipoTessera: 'Agonistica Nazionale',
        certificatoMedicoScadenza: '2026-12-15',
        statoTessera: 'attiva',
        email: 'giulia.murada@example.com',
        telefono: '349.8877665',
        createdAt: new Date().toISOString()
      },
      {
        id: 'atl_003',
        societaId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nome: 'Luca',
        cognome: 'Del Pero',
        codiceFiscale: 'DLPLCU97A14E507V',
        dataNascita: '1997-01-14',
        sesso: 'M',
        categoria: 'Senior',
        numeroTessera: 'FISKY-26-1120',
        tipoTessera: 'Agonistica Nazionale',
        certificatoMedicoScadenza: '2026-11-20',
        statoTessera: 'in_scadenza',
        email: 'luca.delpero@example.com',
        telefono: '338.4455667',
        createdAt: new Date().toISOString()
      },
      {
        id: 'atl_004',
        societaId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nome: 'Martina',
        cognome: 'Cumerlato',
        codiceFiscale: 'CMRMTN95B58L157K',
        dataNascita: '1995-02-18',
        sesso: 'F',
        categoria: 'Senior',
        numeroTessera: 'FISKY-26-1340',
        tipoTessera: 'Agonistica Nazionale',
        certificatoMedicoScadenza: '2026-09-01',
        statoTessera: 'scaduta',
        email: 'martina.cumerlato@example.com',
        telefono: '339.7711223',
        createdAt: new Date().toISOString()
      }
    ];
    writeJson(ATLETI_FILE, defaultAtleti);
  }

  const gare = readJson(GARE_FILE, []);
  if (gare.length === 0) {
    const defaultGare = [
      {
        id: 'gara_001',
        protocollo: 'FISKY-REQ-2026-001',
        userId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nomeGara: 'Grigne Skymarathon - Trofeo Scaccabarozzi',
        disciplina: 'SkyMarathon',
        circuito: 'CRAZY Skyrunning Italy Cup',
        dataGara: '2027-09-19',
        localita: 'Pasturo (LC)',
        regione: 'Lombardia',
        dislivelloDplus: 3900,
        sviluppoKm: 42.5,
        quotaMax: 2410,
        quotaMin: 650,
        referenteNome: 'Giorgio Pesenti',
        referenteEmail: 'gare@valetudoskyrunning.it',
        referenteTelefono: '348.5521478',
        aziendaCrono: 'Wedosport Alps Timing',
        regolamentoUrl: 'Regolamento_Grigne_2026.pdf',
        note: 'Gara inserita a calendario nazionale con passaggio sul Rifugio Brioschi.',
        stato: 'approvata',
        dataRichiesta: new Date().toISOString()
      },
      {
        id: 'gara_002',
        protocollo: 'FISKY-REQ-2026-002',
        userId: 'usr_soc_1',
        societaNome: 'ASD Valetudo Skyrunning Italia',
        nomeGara: 'Resegone Vertical Night',
        disciplina: 'Vertical',
        circuito: 'CRAZY Vertical Italy Cup',
        dataGara: '2027-06-12',
        localita: 'Lecco (LC)',
        regione: 'Lombardia',
        dislivelloDplus: 1050,
        sviluppoKm: 3.8,
        quotaMax: 1875,
        quotaMin: 825,
        referenteNome: 'Paolo Beria',
        referenteEmail: 'resegone.vertical@example.com',
        referenteTelefono: '335.8899112',
        aziendaCrono: 'Wedosport Alps Timing',
        regolamentoUrl: 'Regolamento_Resegone_Vertical.pdf',
        note: 'Gara serale con arrivo al Rifugio Azzoni.',
        stato: 'in_attesa',
        dataRichiesta: new Date().toISOString()
      }
    ];
    writeJson(GARE_FILE, defaultGare);
  }
}

initSeeds();

module.exports = {
  readJson,
  writeJson,
  generatePassword,
  generateUsername,
  USERS_FILE,
  ATLETI_FILE,
  GARE_FILE
};
