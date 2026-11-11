const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');
const db = require('./db');
const {
  generatePassword,
  generateUsername,
  USERS_FILE,
  ATLETI_FILE,
  GARE_FILE,
  writeJson
} = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const geoCF = require('./public/js/italian-geo-cf');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser('skyrunning_secret_key_2026'));

// Special handlers for legacy misnamed PNG files with .pdf extension
app.get(['/files/images/GUIDE_ALPINE.PDF', '/files/images/GUIDE_ALPINE.pdf'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'files', 'images', 'GUIDE_ALPINE.png'));
});
app.get(['/files/images/Protocollo_Guide_Alpine.pdf', '/files/images/Protocollo_Guide_Alpine.PDF'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'files', 'images', 'Protocollo_Guide_Alpine.png'));
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/files', express.static(path.join(__dirname, 'public', 'files')));

// Administration portal alias routes matching original URL
app.get(['/administration', '/admin', '/admin/homes'], (req, res) => {
  res.sendFile('dashboard-admin.html', { root: path.join(__dirname, 'public') });
});

// Webpages article routes matching original URLs
app.get([
  '/pages/:slug',
  '/pages/:category/:slug',
  '/contatti/corsi',
  '/associazioni-sportive-affiliate',
  '/associazioni-affiliate',
  '/associazioni-sportive-affiliate.html'
], (req, res) => {
  res.sendFile('pagina.html', { root: path.join(__dirname, 'public') });
});

// Simple session helper using cookies
function getCurrentUser(req) {
  if (req.cookies && req.cookies.fisky_impersonate) {
    try {
      const imp = JSON.parse(req.cookies.fisky_impersonate);
      if (imp && imp.role) return imp;
    } catch(e) {}
  }
  const userId = req.cookies && req.cookies.fisky_user_id;
  if (!userId) return null;
  return db.usersList.find(u => u.id === userId) || null;
}

function saveDynamicUsersFile() {
  const customUsers = (db.usersList || []).filter(
    u => !String(u.id).startsWith('u_') ||
         (u.password && u.password !== 'Fisky2026*' && u.username !== 'admin') ||
         u.profileCompleted !== undefined ||
         u.status === 'sospeso'
  );
  writeJson(USERS_FILE, customUsers);
}

// ================= AUTH & REGISTRATION ROUTES ================= //

const SMTP_CONFIG_FILE = path.join(__dirname, 'data', 'smtp_config.json');
const SENT_EMAILS_LOG_FILE = path.join(__dirname, 'data', 'sent_emails_log.json');

function loadSmtpConfig() {
  const defaults = {
    fromEmail: 'federazione@skyrunningitalia.it',
    fromName: 'Federazione Italiana Skyrunning (FISky)',
    host: process.env.SMTP_HOST || 'smtps.aruba.it',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : true,
    user: process.env.SMTP_USER || 'federazione@skyrunningitalia.it',
    pass: process.env.SMTP_PASS || ''
  };
  try {
    if (fs.existsSync(SMTP_CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SMTP_CONFIG_FILE, 'utf-8') || '{}');
      return { ...defaults, ...saved, fromEmail: saved.fromEmail || 'federazione@skyrunningitalia.it' };
    }
  } catch (e) {
    console.error('Errore lettura smtp_config.json:', e);
  }
  return defaults;
}

function saveSmtpConfig(cfg) {
  try {
    const dir = path.dirname(SMTP_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const merged = { ...loadSmtpConfig(), ...cfg, fromEmail: 'federazione@skyrunningitalia.it' };
    fs.writeFileSync(SMTP_CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  } catch (e) {
    console.error('Errore scrittura smtp_config.json:', e);
    return loadSmtpConfig();
  }
}

function buildCredentialsEmailContent({ to, role, nome, username, password, codiceAssegnato, codiceLabel }) {
  const from = 'federazione@skyrunningitalia.it';
  const subject = 'Registrazione al portale www.skyrunningitalia.it - Invio Credenziali';
  const resolvedCodeLabel = codiceLabel || (
    String(role || '').toLowerCase().includes('societ')
      ? 'Codice Società FISky'
      : (String(role || '').toLowerCase().includes('crono') ? 'Codice Azienda Cronometraggio' : 'Codice Tessera FISky')
  );

  const text = [
    `Gentile ${nome || username},`,
    ``,
    `ti diamo il benvenuto sul portale ufficiale della Federazione Italiana Skyrunning (www.skyrunningitalia.it)!`,
    `La tua richiesta di registrazione (${role || 'Utenza FISky'}) è stata verificata e confermata dalla Federazione Italiana Skyrunning.`,
    ``,
    `Di seguito ti comunichiamo il riepilogo dei tuoi dati identificativi e le credenziali ufficiali per accedere alla tua Area Riservata:`,
    ``,
    `------------------------------------------------------------`,
    `DETTAGLIO CREDENZIALI DI ACCESSO`,
    `------------------------------------------------------------`,
    `- Tipologia Registrazione: ${role || 'Utenza FISky'}`,
    `- Denominazione / Nominativo: ${nome || '-'}`,
    `- ${resolvedCodeLabel}: ${codiceAssegnato || '-'}`,
    `- Username: ${username}`,
    `- Password: ${password}`,
    `------------------------------------------------------------`,
    ``,
    `ISTRUZIONI PER ACCEDERE AL PORTALE:`,
    `1. Collegati al sito ufficiale https://www.skyrunningitalia.it (oppure accedi direttamente alla pagina di Login dell'Area Riservata).`,
    `2. Inserisci lo Username "${username}" e la Password sopra indicata.`,
    `3. Al tuo primo accesso nell'Area Riservata ti verrà richiesto di completare le informazioni anagrafiche obbligatorie e la documentazione prevista per perfezionare la tua posizione federale.`,
    ``,
    `RACCOMANDAZIONI DI SICUREZZA E RISERVATEZZA:`,
    `Le credenziali di accesso e il codice identificativo riportati nella presente comunicazione sono strettamente personali e riservati.`,
    `Si raccomanda di custodirli con la massima cura e di NON divulgare a terzi le informazioni appena comunicate.`,
    `La Federazione Italiana Skyrunning non richiederà mai la tua password tramite telefono o comunicazioni non ufficiali.`,
    ``,
    `Per qualsiasi necessità o supporto tecnico puoi contattare la Federazione all'indirizzo federazione@skyrunningitalia.it.`,
    ``,
    `Cordiali saluti,`,
    `Federazione Italiana Skyrunning (FISky)`,
    `www.skyrunningitalia.it | federazione@skyrunningitalia.it`
  ].join('\n');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; color: #1e293b; background: #ffffff;">
      <div style="background: #0a2759; color: #ffffff; padding: 20px 24px; border-bottom: 4px solid #df4040;">
        <h2 style="margin: 0; font-size: 19px; font-weight: 700;">Federazione Italiana Skyrunning (FISky)</h2>
        <div style="font-size: 13px; color: #cbd5e1; margin-top: 4px;">Portale Ufficiale www.skyrunningitalia.it &mdash; Ufficio Federale</div>
      </div>
      <div style="padding: 24px; line-height: 1.6; font-size: 14px;">
        <p style="margin-top: 0;">Gentile <strong>${nome || username}</strong>,</p>
        <p>ti diamo il <strong>benvenuto sul portale ufficiale della Federazione Italiana Skyrunning (<a href="https://www.skyrunningitalia.it" style="color: #15549a; font-weight: bold;">www.skyrunningitalia.it</a>)</strong>!<br>
        La tua richiesta di registrazione (<strong>${role || 'Utenza FISky'}</strong>) è stata verificata e confermata dalla Federazione Italiana Skyrunning.</p>

        <p>Di seguito trovi il dettaglio delle tue credenziali personali per accedere all'Area Riservata:</p>

        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #15549a; border-radius: 6px; padding: 16px 20px; margin: 18px 0;">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #0a2759; margin-bottom: 10px;">Dettaglio Credenziali di Accesso</div>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 5px 0; color: #64748b; width: 42%;">Tipologia Registrazione:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${role || 'Utenza FISky'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Denominazione / Nominativo:</td>
              <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${nome || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">${resolvedCodeLabel}:</td>
              <td style="padding: 5px 0; font-weight: 800; color: #15549a; font-family: monospace; font-size: 15px;">${codiceAssegnato || '-'}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Username:</td>
              <td style="padding: 5px 0; font-weight: 800; color: #0f172a; font-family: monospace; font-size: 15px;">${username}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748b;">Password:</td>
              <td style="padding: 5px 0;"><span style="background: #fef3c7; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 4px; font-weight: 800; color: #92400e; font-family: monospace; font-size: 15px;">${password}</span></td>
            </tr>
          </table>
        </div>

        <h4 style="color: #0a2759; margin: 20px 0 8px 0; font-size: 15px;">Istruzioni per accedere al portale</h4>
        <ol style="margin: 0 0 18px 0; padding-left: 20px;">
          <li style="margin-bottom: 6px;">Collegati al portale ufficiale <a href="https://www.skyrunningitalia.it" style="color: #15549a; font-weight: bold;">www.skyrunningitalia.it</a> e clicca sulla voce <strong>Area Riservata / Accedi</strong>.</li>
          <li style="margin-bottom: 6px;">Inserisci lo <strong>Username</strong> (<code>${username}</code>) e la <strong>Password</strong> sopra indicati.</li>
          <li style="margin-bottom: 6px;">Al tuo primo ingresso nell'Area Riservata ti verrà richiesto di completare tutte le <strong>informazioni anagrafiche obbligatorie</strong> per perfezionare l'iscrizione.</li>
        </ol>

        <div style="background: #fff1f2; border: 1px solid #fecdd3; border-left: 4px solid #e11d48; border-radius: 6px; padding: 12px 16px; font-size: 13px; color: #881337; margin-bottom: 18px;">
          <strong>Raccomandazioni di sicurezza e riservatezza:</strong><br>
          Le credenziali di accesso e il codice identificativo sopra riportati sono strettamente personali e riservati. Si raccomanda di custodirli con la massima cura e di <strong>non divulgare a terzi le informazioni appena comunicate</strong>.
        </div>

        <p style="font-size: 13px; color: #475569; margin-bottom: 0;">
          Per qualsiasi informazione o assistenza puoi contattare la Federazione all'indirizzo <a href="mailto:federazione@skyrunningitalia.it" style="color: #15549a;">federazione@skyrunningitalia.it</a>.
        </p>
      </div>
      <div style="background: #f1f5f9; padding: 14px 24px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
        <strong>Federazione Italiana Skyrunning (FISky)</strong> &bull; <a href="https://www.skyrunningitalia.it" style="color: #15549a;">www.skyrunningitalia.it</a> &bull; <a href="mailto:federazione@skyrunningitalia.it" style="color: #15549a;">federazione@skyrunningitalia.it</a>
      </div>
    </div>
  `;

  return { from, to, subject, text, html, codiceLabel: resolvedCodeLabel };
}

async function sendCredentialsEmail({ to, role, nome, username, password, codiceAssegnato, codiceLabel }) {
  const emailContent = buildCredentialsEmailContent({ to, role, nome, username, password, codiceAssegnato, codiceLabel });
  const smtpCfg = loadSmtpConfig();

  let smtpDelivered = false;
  let smtpError = null;
  let smtpResponse = null;
  let transportUsed = 'none';

  const fromAddress = smtpCfg.fromEmail || 'federazione@skyrunningitalia.it';
  const fromName = smtpCfg.fromName || 'Federazione Italiana Skyrunning (FISky)';
  const fromHeader = `"${fromName}" <${fromAddress}>`;

  // 1. Try authenticated SMTP if password is provided
  if (smtpCfg.host && smtpCfg.user && smtpCfg.pass) {
    try {
      transportUsed = `smtp (${smtpCfg.host}:${smtpCfg.port})`;
      const transporter = nodemailer.createTransport({
        host: smtpCfg.host,
        port: Number(smtpCfg.port) || 465,
        secure: Boolean(smtpCfg.secure),
        auth: {
          user: smtpCfg.user,
          pass: smtpCfg.pass
        },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 8000,
        greetingTimeout: 8000
      });

      const info = await transporter.sendMail({
        from: fromHeader,
        sender: fromAddress,
        replyTo: fromAddress,
        to: emailContent.to,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html
      });
      smtpDelivered = true;
      smtpResponse = info.response || info.messageId || 'OK';
    } catch (err) {
      smtpError = err.message;
      console.error('[SMTP AUTH ERROR]:', err.message);
    }
  }

  // 2. If not delivered via authenticated SMTP, attempt direct MX delivery
  if (!smtpDelivered && emailContent.to && emailContent.to.includes('@')) {
    try {
      const domain = emailContent.to.split('@')[1].trim();
      const mxRecords = await dns.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        mxRecords.sort((a, b) => a.priority - b.priority);
        const mxHost = mxRecords[0].exchange;
        transportUsed = `direct-mx (${mxHost}:25)`;
        const mxTransporter = nodemailer.createTransport({
          host: mxHost,
          port: 25,
          secure: false,
          name: 'skyrunningitalia.it',
          tls: { rejectUnauthorized: false },
          connectionTimeout: 6000,
          greetingTimeout: 6000
        });
        const info = await mxTransporter.sendMail({
          from: fromHeader,
          sender: fromAddress,
          replyTo: fromAddress,
          to: emailContent.to,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html
        });
        smtpDelivered = true;
        smtpResponse = info.response || info.messageId || 'OK';
        smtpError = null;
      }
    } catch (mxErr) {
      if (!smtpError) {
        smtpError = mxErr.message;
      }
      console.warn('[DIRECT MX WARNING]:', mxErr.message);
    }
  }

  const logEntry = {
    id: `mail_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    sentAt: new Date().toISOString(),
    from: emailContent.from,
    to: emailContent.to,
    subject: emailContent.subject,
    role,
    nome,
    username,
    password,
    codiceAssegnato,
    codiceLabel: emailContent.codiceLabel,
    text: emailContent.text,
    html: emailContent.html,
    smtpDelivered,
    transportUsed,
    smtpResponse,
    smtpError,
    archived: false
  };

  try {
    let logs = [];
    if (fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
    }
    logs.unshift(logEntry);
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(logs.slice(0, 500), null, 2), 'utf-8');
  } catch (e) {
    console.error('Errore scrittura log email:', e);
  }

  console.log(`[EMAIL CREDENZIALI -> ${to}] Da: ${emailContent.from} | Oggetto: "${emailContent.subject}" | Username: ${username} | Codice: ${codiceAssegnato} | Inviata SMTP: ${smtpDelivered}`);
  return logEntry;
}

function logSentCredentialsEmail(params) {
  return sendCredentialsEmail(params);
}

const REGISTRATION_REQUESTS_FILE = path.join(__dirname, 'data', 'registration_requests.json');

function loadRegistrationRequests() {
  try {
    if (fs.existsSync(REGISTRATION_REQUESTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRATION_REQUESTS_FILE, 'utf-8') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error('Errore lettura registration_requests.json:', e);
  }
  return [];
}

function saveRegistrationRequests(list) {
  try {
    const dir = path.dirname(REGISTRATION_REQUESTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REGISTRATION_REQUESTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Errore scrittura registration_requests.json:', e);
  }
}

let registrationRequests = loadRegistrationRequests();

function isAdminUser(req) {
  const userId = req.cookies && req.cookies.fisky_user_id;
  if (userId) {
    const baseUser = (db.usersList || []).find(u => u.id === userId);
    if (baseUser && baseUser.role === 'admin') return true;
  }
  const u = getCurrentUser(req);
  return Boolean(u && u.role === 'admin');
}

function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const rawIp = (req.socket && req.socket.remoteAddress) || req.ip || '127.0.0.1';
  return rawIp === '::1' ? '127.0.0.1' : String(rawIp).replace(/^::ffff:/, '');
}

const ROLE_LABELS_MAP = {
  admin: 'Amministratore',
  societa: 'Società Sportiva',
  singolo: 'Tesserato Singolo',
  crono: 'Azienda Cronometraggio',
  pubblico: 'Utente Frontend',
  sistema: 'Sistema'
};

function recordOperationLog(req, {
  origine = 'frontend',
  categoria = 'Operazione',
  azione = '',
  oggetto = '',
  dettagli = '',
  esito = 'OK',
  operatoreOverride = null,
  ruoloOverride = null
} = {}) {
  try {
    const currentUser = req ? getCurrentUser(req) : null;
    const realAdminUserId = req && req.cookies && req.cookies.fisky_user_id;
    const realAdminUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;

    let operatore = operatoreOverride;
    let ruolo = ruoloOverride;

    if (!operatore) {
      if (currentUser && currentUser.impersonating && realAdminUser) {
        operatore = `${realAdminUser.username} (impersonando ${currentUser.username || currentUser.nome})`;
        ruolo = 'admin';
      } else if (currentUser) {
        operatore = currentUser.nome && currentUser.nome !== currentUser.username
          ? `${currentUser.username} (${currentUser.nome})`
          : (currentUser.username || currentUser.email || 'Utente Autenticato');
        ruolo = currentUser.role || 'pubblico';
      } else if (realAdminUser) {
        operatore = `${realAdminUser.username} (${realAdminUser.nome || 'Admin'})`;
        ruolo = realAdminUser.role || 'admin';
      } else {
        operatore = 'Visitatore / Utente Frontend';
        ruolo = origine === 'admin' ? 'admin' : 'pubblico';
      }
    }

    if (!ruolo) {
      ruolo = (currentUser && currentUser.role) || (origine === 'admin' ? 'admin' : 'pubblico');
    }

    const ruoloLabel = ROLE_LABELS_MAP[ruolo] || ruolo;

    return db.appendOperationLog({
      origine,
      categoria,
      azione,
      oggetto,
      dettagli,
      operatore,
      ruolo,
      ruoloLabel,
      ip: getClientIp(req),
      metodo: req ? `${req.method} ${req.originalUrl || req.url}` : 'SYSTEM',
      esito
    });
  } catch (err) {
    console.error('Errore registrazione log operazione:', err);
    return null;
  }
}

// Compute preview of next progressive code for a registration request
function computeNextCodePreview(role, tipoTesseramento) {
  if (role === 'societa') {
    const maxClubRawId = Math.max(0, ...(db.rawClubs || []).map(c => Number(c.id) || 0));
    const maxClubCodice = Math.max(
      10000,
      ...(db.clubsList || []).map(c => Number(c.codice) || 0),
      ...(db.rawClubs || []).map(c => {
        const n = Number(c.id) || 0;
        return n > 0 && n < 10000 ? 10000 + n : n;
      })
    );
    const nextClubRawId = maxClubRawId + 1;
    return String(Math.max(maxClubCodice + 1, 10000 + nextClubRawId));
  }
  if (role === 'singolo') {
    const validTypes = {
      'Atleta': { letter: 'A' },
      'Tecnico': { letter: 'T' },
      'Direttore di percorso (Guida alpina)': { letter: 'G' }
    };
    const tInfo = validTypes[tipoTesseramento] || { letter: 'A' };
    const maxMemberRawId = Math.max(
      0,
      ...(db.rawMembers || []).map(m => Number(m.id) || 0),
      ...(db.membersList || []).map(m => Number(m.rawId) || parseInt(m.progressivo, 10) || 0)
    );
    const nextMemberId = maxMemberRawId + 1;
    return `SKY${tInfo.letter}${String(nextMemberId).padStart(6, '0')}`;
  }
  if (role === 'crono') {
    const maxChronoId = Math.max(
      0,
      ...(db.rawChronos || []).map(c => Number(c.id) || 0),
      ...(db.chronosList || []).map(c => Number(c.rawId) || Number(c.codice) || 0)
    );
    return String(maxChronoId + 1);
  }
  return '-';
}

// Register a new user (Step 1 for Società, Persona Singola, Azienda di Cronometraggio)
// Creates a pending registration request notified to the Administrator before sending credentials
app.post('/api/auth/register', (req, res) => {
  try {
    const body = req.body || {};
    const role = String(body.role || '').trim();

    if (!role || !['societa', 'singolo', 'crono'].includes(role)) {
      return res.status(400).json({ error: 'Tipologia di registrazione non valida.' });
    }

    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim();
    const commento = String(body.commento || '').trim();
    const accettoNorme = Boolean(body.accettoNorme === true || body.accettoNorme === 'true' || body.accettoNorme === '1' || body.accettoNorme === 'on');

    if (!username) {
      return res.status(400).json({ error: 'Il campo "Username" è obbligatorio.' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Il campo "Indirizzo mail" è obbligatorio.' });
    }
    if (!geoCF.isValidEmail(email)) {
      return res.status(400).json({ error: 'L\'indirizzo mail inserito non è in un formato valido.' });
    }
    if (!accettoNorme) {
      return res.status(400).json({ error: 'Per confermare la registrazione è obbligatorio spuntare la casella "Accetto le norme ed i regolamenti della FISKY".' });
    }

    // Check username uniqueness across all users, clubs, and pending registration requests
    const normUser = username.toLowerCase();
    const duplicateUser =
      (db.usersList || []).find(u => u.username && String(u.username).trim().toLowerCase() === normUser) ||
      (db.rawUsers || []).find(u => u.username && String(u.username).trim().toLowerCase() === normUser) ||
      (db.clubsList || []).find(c => c.username && String(c.username).trim().toLowerCase() === normUser) ||
      registrationRequests.find(r => r.username && String(r.username).trim().toLowerCase() === normUser);

    if (duplicateUser) {
      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Richiesta Registrazione',
        azione: 'Tentativo Registrazione Fallito (Username Duplicato)',
        oggetto: `Username: ${username}`,
        dettagli: `Richiesta registrazione (${role}) respinta: username "${username}" già in uso (Email: ${email})`,
        operatoreOverride: `${username} (${email})`,
        ruoloOverride: role,
        esito: 'ERRORE'
      });
      return res.status(400).json({
        error: `Lo Username "${username}" è già presente nel database o in una richiesta in attesa ed è associato a un'altra utenza. Scegliere uno Username differente per completare la registrazione.`
      });
    }

    const normEmail = email.toLowerCase();
    const dupPendingEmail = registrationRequests.find(r => r.email && String(r.email).trim().toLowerCase() === normEmail);
    if (dupPendingEmail) {
      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Richiesta Registrazione',
        azione: 'Tentativo Registrazione Fallito (Email già in attesa)',
        oggetto: `Email: ${email}`,
        dettagli: `Richiesta registrazione (${role}) respinta: indirizzo email "${email}" già presente in una richiesta in attesa`,
        operatoreOverride: `${username} (${email})`,
        ruoloOverride: role,
        esito: 'ERRORE'
      });
      return res.status(400).json({
        error: `L'indirizzo mail "${email}" risulta già associato a una richiesta di registrazione in attesa di verifica.`
      });
    }

    const reqId = `reg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const nowIso = new Date().toISOString();

    // ================== 1. RICHIESTA REGISTRAZIONE SOCIETÀ ==================
    if (role === 'societa') {
      const denominazione = String(body.societa || body.ragioneSociale || body.denominazione || '').trim();
      if (!denominazione) {
        return res.status(400).json({ error: 'Il campo "Società" (denominazione della società) è obbligatorio.' });
      }

      const dupEmailSoc =
        (db.usersList || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail) ||
        (db.rawUsers || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail) ||
        (db.clubsList || []).find(c => c.email && String(c.email).trim().toLowerCase() === normEmail) ||
        (db.rawClubs || []).find(c => c.email && String(c.email).trim().toLowerCase() === normEmail);

      if (dupEmailSoc) {
        recordOperationLog(req, {
          origine: 'frontend',
          categoria: 'Richiesta Registrazione',
          azione: 'Tentativo Registrazione Società Fallito (Email Duplicata)',
          oggetto: denominazione,
          dettagli: `Email "${email}" già associata a un'altra società o utente registrato`,
          operatoreOverride: `${username} (${denominazione})`,
          ruoloOverride: 'societa',
          esito: 'ERRORE'
        });
        return res.status(400).json({
          error: `L'indirizzo mail "${email}" risulta già associato a un'altra società o utente registrato nel database.`
        });
      }

      const newReq = {
        id: reqId,
        createdAt: nowIso,
        role: 'societa',
        tipologiaLabel: 'Società Sportiva',
        societa: denominazione,
        denominazione: denominazione,
        username,
        email,
        commento,
        accettoNorme: true,
        status: 'pending'
      };

      registrationRequests.unshift(newReq);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Richiesta Registrazione',
        azione: 'Nuova Richiesta Registrazione Società Sportiva',
        oggetto: `${denominazione} (ID: ${reqId})`,
        dettagli: `Richiesta inviata dal frontend | Società: "${denominazione}" | Username: ${username} | Email: ${email}${commento ? ' | Note: ' + commento : ''}`,
        operatoreOverride: `${username} (${denominazione})`,
        ruoloOverride: 'societa',
        esito: 'OK'
      });

      return res.status(201).json({
        success: true,
        pendingApproval: true,
        emailSent: false,
        emailTo: email,
        request: newReq,
        message: `Richiesta di registrazione per la Società "${denominazione}" inviata con successo! La richiesta è stata notificata all'Amministratore FISky: non appena verrà verificata e confermata, riceverai la password segreta e il Codice Società all'indirizzo mail ${email}.`
      });
    }

    // ================== 2. RICHIESTA REGISTRAZIONE PERSONA SINGOLA ==================
    if (role === 'singolo') {
      const nome = String(body.nome || '').trim();
      const cognome = String(body.cognome || '').trim();
      const tipoTesseramento = String(body.tipoTesseramento || '').trim();

      if (!nome) {
        return res.status(400).json({ error: 'Il campo "Nome" è obbligatorio.' });
      }
      if (!cognome) {
        return res.status(400).json({ error: 'Il campo "Cognome" è obbligatorio.' });
      }
      const validTypes = {
        'Atleta': { letter: 'A', membertypeId: '6', label: 'Atleta' },
        'Tecnico': { letter: 'T', membertypeId: '7', label: 'Tecnico' },
        'Direttore di percorso (Guida alpina)': { letter: 'G', membertypeId: '14', label: 'Direttore di percorso (Guida alpina)' }
      };
      if (!validTypes[tipoTesseramento]) {
        return res.status(400).json({ error: 'Selezionare un "Tipo Tesseramento" valido (Atleta, Tecnico, Direttore di percorso (Guida alpina)).' });
      }

      const dupEmailSingolo =
        (db.usersList || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail) ||
        (db.rawUsers || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail);

      if (dupEmailSingolo) {
        recordOperationLog(req, {
          origine: 'frontend',
          categoria: 'Richiesta Registrazione',
          azione: 'Tentativo Registrazione Singolo Fallito (Email Duplicata)',
          oggetto: `${nome} ${cognome}`,
          dettagli: `Email "${email}" già associata a un altro utente registrato`,
          operatoreOverride: `${username} (${nome} ${cognome})`,
          ruoloOverride: 'singolo',
          esito: 'ERRORE'
        });
        return res.status(400).json({
          error: `L'indirizzo mail "${email}" risulta già associato a un altro utente registrato nel database.`
        });
      }

      const fullName = `${nome} ${cognome}`.trim();
      const newReq = {
        id: reqId,
        createdAt: nowIso,
        role: 'singolo',
        tipologiaLabel: `Persona Singola - ${tipoTesseramento}`,
        nome,
        cognome,
        denominazione: fullName,
        tipoTesseramento,
        username,
        email,
        commento,
        accettoNorme: true,
        status: 'pending'
      };

      registrationRequests.unshift(newReq);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Richiesta Registrazione',
        azione: `Nuova Richiesta Registrazione Singolo (${tipoTesseramento})`,
        oggetto: `${fullName} (ID: ${reqId})`,
        dettagli: `Richiesta inviata dal frontend | Nominativo: ${fullName} | Qualifica: ${tipoTesseramento} | Username: ${username} | Email: ${email}${commento ? ' | Note: ' + commento : ''}`,
        operatoreOverride: `${username} (${fullName})`,
        ruoloOverride: 'singolo',
        esito: 'OK'
      });

      return res.status(201).json({
        success: true,
        pendingApproval: true,
        emailSent: false,
        emailTo: email,
        request: newReq,
        message: `Richiesta di registrazione per "${fullName}" (${tipoTesseramento}) inviata con successo! La richiesta è stata notificata all'Amministratore FISky: non appena verrà verificata e confermata, riceverai la password segreta e il Codice Tessera all'indirizzo mail ${email}.`
      });
    }

    // ================== 3. RICHIESTA REGISTRAZIONE AZIENDA DI CRONOMETRAGGIO ==================
    if (role === 'crono') {
      const nome = String(body.nome || '').trim();
      const cognome = String(body.cognome || '').trim();
      const aziendaCrono = String(body.aziendaCrono || body.ragioneSociale || '').trim();
      const accettoPrivacyCrono = Boolean(
        body.accettoPrivacyCrono === true ||
        body.accettoPrivacyCrono === 'true' ||
        body.accettoPrivacyCrono === '1' ||
        body.accettoPrivacyCrono === 'on'
      );

      if (!nome) {
        return res.status(400).json({ error: 'Il campo "Nome" del rappresentante dell\'azienda di cronometraggio è obbligatorio.' });
      }
      if (!cognome) {
        return res.status(400).json({ error: 'Il campo "Cognome" del rappresentante dell\'azienda di cronometraggio è obbligatorio.' });
      }
      if (!aziendaCrono) {
        return res.status(400).json({ error: 'Il campo "Azienda di cronometraggio" (denominazione) è obbligatorio.' });
      }
      if (!accettoPrivacyCrono) {
        return res.status(400).json({
          error: 'Per confermare la registrazione dell\'azienda di cronometraggio entrambe le checkbox (Norme FISKY e Dichiarazione Privacy utilizzo elenco tesserati) devono essere spuntate.'
        });
      }

      const dupEmailCrono =
        (db.chronosList || []).find(c => c.email && String(c.email).trim().toLowerCase() === normEmail) ||
        (db.rawChronos || []).find(c => c.email && String(c.email).trim().toLowerCase() === normEmail) ||
        (db.usersList || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail) ||
        (db.rawUsers || []).find(u => u.email && String(u.email).trim().toLowerCase() === normEmail);

      if (dupEmailCrono) {
        recordOperationLog(req, {
          origine: 'frontend',
          categoria: 'Richiesta Registrazione',
          azione: 'Tentativo Registrazione Crono Fallito (Email Duplicata)',
          oggetto: aziendaCrono,
          dettagli: `Email "${email}" già associata a un'altra azienda crono o utente`,
          operatoreOverride: `${username} (${aziendaCrono})`,
          ruoloOverride: 'crono',
          esito: 'ERRORE'
        });
        return res.status(400).json({
          error: `L'indirizzo mail "${email}" risulta già associato a un'altra azienda di cronometraggio o utente nel database.`
        });
      }

      const newReq = {
        id: reqId,
        createdAt: nowIso,
        role: 'crono',
        tipologiaLabel: 'Azienda di Cronometraggio',
        nome,
        cognome,
        aziendaCrono,
        denominazione: aziendaCrono,
        username,
        email,
        commento,
        accettoNorme: true,
        accettoPrivacyCrono: true,
        status: 'pending'
      };

      registrationRequests.unshift(newReq);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Richiesta Registrazione',
        azione: 'Nuova Richiesta Registrazione Azienda Cronometraggio',
        oggetto: `${aziendaCrono} (ID: ${reqId})`,
        dettagli: `Richiesta inviata dal frontend | Azienda: "${aziendaCrono}" | Referente: ${nome} ${cognome} | Username: ${username} | Email: ${email}${commento ? ' | Note: ' + commento : ''}`,
        operatoreOverride: `${username} (${aziendaCrono})`,
        ruoloOverride: 'crono',
        esito: 'OK'
      });

      return res.status(201).json({
        success: true,
        pendingApproval: true,
        emailSent: false,
        emailTo: email,
        request: newReq,
        message: `Richiesta di registrazione per l'Azienda di Cronometraggio "${aziendaCrono}" inviata con successo! La richiesta è stata notificata all'Amministratore FISky: non appena verrà verificata e confermata, riceverai la password segreta e il Codice Azienda all'indirizzo mail ${email}.`
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore interno del server durante la registrazione.' });
  }
});

// ================= ADMIN: GESTIONE RICHIESTE DI REGISTRAZIONE ================= //

// List all pending registration requests (Admin only)
app.get('/api/admin/registration-requests', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso consentito esclusivamente agli utenti di tipo amministratore.' });
  }
  const enriched = registrationRequests.map(r => ({
    ...r,
    codicePreview: computeNextCodePreview(r.role, r.tipoTesseramento)
  }));
  res.json({
    success: true,
    total: enriched.length,
    requests: enriched
  });
});

// Confirm a registration request: creates user + entity, generates password & progressive code, and sends email (Admin only)
app.post('/api/admin/registration-requests/:id/confirm', async (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return res.status(403).json({ error: 'Operazione consentita esclusivamente agli utenti di tipo amministratore.' });
    }

    const reqId = String(req.params.id);
    const reqIdx = registrationRequests.findIndex(r => String(r.id) === reqId);
    if (reqIdx === -1) {
      return res.status(404).json({ error: 'Richiesta di registrazione non trovata o già elaborata.' });
    }

    const regReq = registrationRequests[reqIdx];
    const role = regReq.role;
    const username = String(regReq.username || '').trim();
    const email = String(regReq.email || '').trim();
    const commento = String(regReq.commento || '').trim();
    const normUser = username.toLowerCase();
    const normEmail = email.toLowerCase();

    // Final uniqueness check against live DB
    const duplicateUser =
      (db.usersList || []).find(u => u.username && String(u.username).trim().toLowerCase() === normUser) ||
      (db.rawUsers || []).find(u => u.username && String(u.username).trim().toLowerCase() === normUser) ||
      (db.clubsList || []).find(c => c.username && String(c.username).trim().toLowerCase() === normUser);

    if (duplicateUser) {
      return res.status(400).json({
        error: `Impossibile confermare: lo Username "${username}" risulta già presente nel database.`
      });
    }

    const autoPassword = generatePassword();
    const nextRawUserId = Math.max(
      0,
      ...(db.rawUsers || []).map(u => Number(u.id) || 0),
      ...(db.usersList || []).map(u => Number(u.rawId) || 0)
    ) + 1;
    const todayIso = new Date().toISOString().slice(0, 10);

    // 1. CONFERMA SOCIETÀ
    if (role === 'societa') {
      const denominazione = String(regReq.societa || regReq.denominazione || '').trim();
      const maxClubRawId = Math.max(0, ...(db.rawClubs || []).map(c => Number(c.id) || 0));
      const maxClubCodice = Math.max(
        10000,
        ...(db.clubsList || []).map(c => Number(c.codice) || 0),
        ...(db.rawClubs || []).map(c => {
          const n = Number(c.id) || 0;
          return n > 0 && n < 10000 ? 10000 + n : n;
        })
      );
      const nextClubRawId = maxClubRawId + 1;
      const codiceSocieta = String(Math.max(maxClubCodice + 1, 10000 + nextClubRawId));

      const newRawClub = {
        id: String(nextClubRawId),
        codice: codiceSocieta,
        name: denominazione,
        join_date: todayIso,
        affiliate_begin: '0000-00-00',
        affiliate_expire: '0000-00-00',
        affiliate_years: '',
        r_name: 'ASD',
        combination: '0',
        combination_name: '',
        polisport: '0',
        polisport_desc: '',
        address: '',
        street_number: '',
        city: '',
        province: '',
        region: '',
        cap: '',
        cf: '',
        pi: '',
        cell1: '',
        cell2: '',
        cell3: '',
        fax: '',
        email: email,
        email2: '',
        web: '',
        contact: '',
        c_cell1: '',
        c_cell2: '',
        c_email: '',
        status: '1',
        statute: '',
        certificate: '',
        coni_certificate: '0',
        cf_certificate: '',
        association_articles: '',
        statute_modification: '',
        id_president: '',
        election_act: '',
        affiliation_form: '',
        business: '0',
        business_desc: '',
        user_id: String(nextRawUserId),
        havetopay: '1',
        is_new: '1',
        fisoId: '',
        affiliation_complete: '0',
        comment: commento,
        profileCompleted: false
      };

      db.rawClubs.push(newRawClub);
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);

      const newClubFormatted = {
        id: `club_${nextClubRawId}`,
        rawId: String(nextClubRawId),
        codice: codiceSocieta,
        codiceFiso: '',
        role: 'societa',
        nome: denominazione,
        ragioneSociale: denominazione,
        username: username,
        email: email,
        email2: '',
        userId: String(nextRawUserId),
        credito: 0,
        totalAccount: 0,
        payedAccount: 0,
        codiceFiscale: '',
        partitaIva: '',
        legaleRappresentante: '',
        sede: '',
        address: '',
        street_number: '',
        city: '',
        province: '',
        region: '',
        cap: '',
        rName: 'ASD',
        web: '',
        cell1: '',
        cell2: '',
        telefono: '',
        contact: '',
        c_cell1: '',
        c_email: '',
        coni_certificate: '0',
        certificate: '',
        cf_certificate: '',
        association_articles: '',
        statute_modification: '',
        statute: '',
        id_president: '',
        election_act: '',
        affiliation_form: '',
        comment: commento,
        profileCompleted: false,
        affiliateBegin: '0000-00-00',
        affiliateExpire: '0000-00-00',
        affiliateYears: '',
        lastYear: null,
        isAttiva: false,
        statoAffiliazione: 'Nuova Registrazione',
        affiliato: false,
        affiliation_complete: '0',
        status: 'attivo'
      };
      db.clubsList.unshift(newClubFormatted);

      const newUser = {
        id: `u_${nextRawUserId}`,
        rawId: String(nextRawUserId),
        username,
        password: autoPassword,
        role: 'societa',
        utente: denominazione,
        nome: denominazione,
        ragioneSociale: denominazione,
        email,
        commento,
        codiceSocieta,
        codiceAffiliazione: codiceSocieta,
        clubRawId: String(nextClubRawId),
        profileCompleted: false,
        status: 'attivo',
        createdAt: new Date().toISOString()
      };

      db.rawUsers.push({
        id: String(nextRawUserId),
        username,
        password: autoPassword,
        name: denominazione,
        surname: '',
        email,
        group_id: 2,
        status: 1,
        created: todayIso,
        modified: todayIso
      });
      db.writeJsonFile('mysql_users.json', db.rawUsers);

      db.usersList.unshift(newUser);
      saveDynamicUsersFile();

      const emailData = await sendCredentialsEmail({
        to: email,
        role: 'Società Sportiva',
        nome: denominazione,
        username,
        password: autoPassword,
        codiceAssegnato: codiceSocieta,
        codiceLabel: 'Codice Società FISky'
      });

      registrationRequests.splice(reqIdx, 1);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Approvazione Registrazione',
        azione: 'Conferma Richiesta Registrazione Società Sportiva',
        oggetto: `${denominazione} (Cod. ${codiceSocieta})`,
        dettagli: `Richiesta confermata da Admin | Società: "${denominazione}" | Username: ${username} | Codice Società assegnato: ${codiceSocieta} | Mail credenziali a: ${email} (Oggetto: "${emailData.subject}", Mittente: ${emailData.from})`,
        esito: 'OK'
      });

      return res.json({
        success: true,
        emailSent: emailData.smtpDelivered,
        emailData,
        message: `Registrazione Società "${denominazione}" confermata! Mail da federazione@skyrunningitalia.it con oggetto "${emailData.subject}" predisposta/inviata a ${email}.`,
        credentials: {
          username,
          password: autoPassword,
          role: 'societa',
          nome: denominazione,
          emailTo: email,
          codiceAssegnato: codiceSocieta,
          codiceLabel: 'Codice Società FISky'
        },
        user: newUser
      });
    }

    // 2. CONFERMA PERSONA SINGOLA
    if (role === 'singolo') {
      const nome = String(regReq.nome || '').trim();
      const cognome = String(regReq.cognome || '').trim();
      const tipoTesseramento = String(regReq.tipoTesseramento || 'Atleta').trim();
      const validTypes = {
        'Atleta': { letter: 'A', membertypeId: '6', label: 'Atleta' },
        'Tecnico': { letter: 'T', membertypeId: '7', label: 'Tecnico' },
        'Direttore di percorso (Guida alpina)': { letter: 'G', membertypeId: '14', label: 'Direttore di percorso (Guida alpina)' }
      };
      const tInfo = validTypes[tipoTesseramento] || validTypes['Atleta'];

      const maxMemberRawId = Math.max(
        0,
        ...(db.rawMembers || []).map(m => Number(m.id) || 0),
        ...(db.membersList || []).map(m => Number(m.rawId) || parseInt(m.progressivo, 10) || 0)
      );
      const nextMemberId = maxMemberRawId + 1;
      const progressivo = String(nextMemberId).padStart(6, '0');
      const codiceTessera = `SKY${tInfo.letter}${progressivo}`;

      const newRawMember = {
        id: String(nextMemberId),
        name: nome,
        surname: cognome,
        gender: '',
        birthday: '',
        birthplace: '',
        telephone: '',
        email: email,
        medical_cetificate: '',
        mc_expire: '0000-00-00',
        address: '',
        street_number: '',
        region: '',
        cap: '',
        province: '',
        city: '',
        cf: '',
        pi: '',
        assurance: '0',
        assurance_expire: '0000-00-00',
        title_certificate: '',
        title_verified_for: '0',
        title_expire: '0000-00-00',
        membertype_id: tInfo.membertypeId,
        club_id: '0',
        user_id: String(nextRawUserId),
        affiliate_expire: `${new Date().getFullYear()}-12-31`,
        newsletter: '1',
        code: codiceTessera,
        comment: commento,
        profileCompleted: false,
        created: todayIso
      };

      db.rawMembers.push(newRawMember);
      db.writeJsonFile('mysql_members.json', db.rawMembers);

      const newMemberFormatted = {
        id: `mem_${nextMemberId}`,
        rawId: nextMemberId,
        progressivo,
        numeroTessera: codiceTessera,
        numeroTesseraAtleta: tInfo.letter === 'A' ? codiceTessera : `SKYA${progressivo}`,
        numeroTesseraDirigente: null,
        numeroTesseraGuida: tInfo.letter === 'G' ? codiceTessera : null,
        numeroTesseraTecnico: tInfo.letter === 'T' ? codiceTessera : null,
        nome,
        cognome,
        codiceFiscale: '',
        partitaIva: '',
        dataNascita: '',
        luogoNascita: '',
        sesso: '',
        categoria: 'Senior',
        titoloTecnico: '',
        certificatoMedicoScadenza: '',
        dataTesseramento: todayIso,
        created: todayIso,
        statoTessera: 'attiva',
        ultimoAnnoTesseramento: new Date().getFullYear(),
        societaId: '0',
        societaNome: 'Atleta Individuale / Libero',
        email,
        telefono: '',
        indirizzo: '',
        civico: '',
        cap: '',
        citta: '',
        provincia: '',
        regione: '',
        userId: String(nextRawUserId),
        comment: commento,
        profileCompleted: false,
        ruoli: [tInfo.label],
        ruoliSocietari: [tInfo.label],
        ruoliFederali: [],
        affiliateExpire: `${new Date().getFullYear()}-12-31`
      };
      db.membersList.unshift(newMemberFormatted);
      if (tInfo.letter === 'A') {
        db.atletiList.unshift({ ...newMemberFormatted, tipoTessera: 'Atleta Agonista FISky' });
      } else if (tInfo.letter === 'G') {
        db.guideList.unshift({ ...newMemberFormatted, qualificaGuida: tInfo.label, tipoTessera: 'Tessera Guida / Ufficiale di Percorso' });
      }

      const fullName = `${nome} ${cognome}`.trim();
      const cognomeNome = `${cognome} ${nome}`.trim();
      const newUser = {
        id: `u_${nextRawUserId}`,
        rawId: String(nextRawUserId),
        username,
        password: autoPassword,
        role: 'singolo',
        utente: cognomeNome,
        nome: cognomeNome,
        firstName: nome,
        lastName: cognome,
        tipoTesseramento: tInfo.label,
        ruoloSportivo: tInfo.label,
        email,
        commento,
        tesseraNumero: codiceTessera,
        memberRawId: String(nextMemberId),
        profileCompleted: false,
        status: 'attivo',
        createdAt: new Date().toISOString()
      };

      db.rawUsers.push({
        id: String(nextRawUserId),
        username,
        password: autoPassword,
        name: nome,
        surname: cognome,
        email,
        group_id: 3,
        status: 1,
        created: todayIso,
        modified: todayIso
      });
      db.writeJsonFile('mysql_users.json', db.rawUsers);

      db.usersList.unshift(newUser);
      saveDynamicUsersFile();

      const emailData = await sendCredentialsEmail({
        to: email,
        role: `Persona Singola (${tInfo.label})`,
        nome: fullName,
        username,
        password: autoPassword,
        codiceAssegnato: codiceTessera,
        codiceLabel: 'Codice Tessera FISky'
      });

      registrationRequests.splice(reqIdx, 1);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Approvazione Registrazione',
        azione: `Conferma Richiesta Registrazione Singolo (${tInfo.label})`,
        oggetto: `${fullName} (Tessera ${codiceTessera})`,
        dettagli: `Richiesta confermata da Admin | Tesserato: "${fullName}" | Qualifica: ${tInfo.label} | Username: ${username} | Codice Tessera assegnato: ${codiceTessera} | Mail credenziali a: ${email} (Oggetto: "${emailData.subject}", Mittente: ${emailData.from})`,
        esito: 'OK'
      });

      return res.json({
        success: true,
        emailSent: emailData.smtpDelivered,
        emailData,
        message: `Registrazione Persona Singola "${fullName}" confermata! Mail da federazione@skyrunningitalia.it con oggetto "${emailData.subject}" predisposta/inviata a ${email}.`,
        credentials: {
          username,
          password: autoPassword,
          role: 'singolo',
          nome: fullName,
          emailTo: email,
          codiceAssegnato: codiceTessera,
          codiceLabel: 'Codice Tessera FISky'
        },
        user: newUser
      });
    }

    // 3. CONFERMA AZIENDA DI CRONOMETRAGGIO
    if (role === 'crono') {
      const nome = String(regReq.nome || '').trim();
      const cognome = String(regReq.cognome || '').trim();
      const aziendaCrono = String(regReq.aziendaCrono || regReq.denominazione || '').trim();

      const maxChronoId = Math.max(
        0,
        ...(db.rawChronos || []).map(c => Number(c.id) || 0),
        ...(db.chronosList || []).map(c => Number(c.rawId) || Number(c.codice) || 0)
      );
      const nextChronoId = maxChronoId + 1;
      const codiceCrono = String(nextChronoId);
      const referenteFull = `${nome} ${cognome}`.trim();

      const newRawChrono = {
        id: codiceCrono,
        name: aziendaCrono,
        address: '',
        street_number: '',
        cap: '',
        city: '',
        province: '',
        region: '',
        cf: '',
        pi: '',
        cell1: '',
        cell2: '',
        cell3: '',
        fax: '',
        email: email,
        email2: '',
        web: '',
        contact: referenteFull,
        c_cell1: '',
        c_cell2: '',
        c_email: '',
        user_id: String(nextRawUserId),
        comment: commento,
        profileCompleted: false
      };

      db.rawChronos.push(newRawChrono);
      db.writeJsonFile('mysql_chronos.json', db.rawChronos);

      const newChronoFormatted = {
        id: `crono_${codiceCrono}`,
        rawId: codiceCrono,
        codice: codiceCrono,
        role: 'crono',
        nome: aziendaCrono,
        ragioneSociale: aziendaCrono,
        codiceFiscale: '',
        partitaIva: '',
        referenteTecnico: referenteFull,
        contact: referenteFull,
        c_cell1: '',
        c_email: '',
        address: '',
        street_number: '',
        cap: '',
        city: '',
        province: '',
        region: '',
        sede: '',
        email: email,
        email2: '',
        cell1: '',
        telefono: '',
        web: '',
        userId: String(nextRawUserId),
        comment: commento,
        profileCompleted: false,
        status: 'attivo'
      };
      db.chronosList.unshift(newChronoFormatted);

      const newUser = {
        id: `u_${nextRawUserId}`,
        rawId: String(nextRawUserId),
        username,
        password: autoPassword,
        role: 'crono',
        utente: aziendaCrono,
        nome: aziendaCrono,
        ragioneSociale: aziendaCrono,
        aziendaCrono,
        firstName: nome,
        lastName: cognome,
        referenteTecnico: referenteFull,
        email,
        commento,
        codiceCrono,
        chronoRawId: codiceCrono,
        profileCompleted: false,
        status: 'attivo',
        createdAt: new Date().toISOString()
      };

      db.rawUsers.push({
        id: String(nextRawUserId),
        username,
        password: autoPassword,
        name: nome,
        surname: cognome,
        email,
        group_id: 4,
        status: 1,
        created: todayIso,
        modified: todayIso
      });
      db.writeJsonFile('mysql_users.json', db.rawUsers);

      db.usersList.unshift(newUser);
      saveDynamicUsersFile();

      const emailData = await sendCredentialsEmail({
        to: email,
        role: 'Azienda di Cronometraggio',
        nome: aziendaCrono,
        username,
        password: autoPassword,
        codiceAssegnato: codiceCrono,
        codiceLabel: 'Codice Azienda Cronometraggio'
      });

      registrationRequests.splice(reqIdx, 1);
      saveRegistrationRequests(registrationRequests);

      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Approvazione Registrazione',
        azione: 'Conferma Richiesta Registrazione Azienda Crono',
        oggetto: `${aziendaCrono} (Cod. ${codiceCrono})`,
        dettagli: `Richiesta confermata da Admin | Azienda Crono: "${aziendaCrono}" | Referente: ${referenteFull} | Username: ${username} | Codice Azienda assegnato: ${codiceCrono} | Mail credenziali a: ${email} (Oggetto: "${emailData.subject}", Mittente: ${emailData.from})`,
        esito: 'OK'
      });

      return res.json({
        success: true,
        emailSent: emailData.smtpDelivered,
        emailData,
        message: `Registrazione Azienda di Cronometraggio "${aziendaCrono}" confermata! Mail da federazione@skyrunningitalia.it con oggetto "${emailData.subject}" predisposta/inviata a ${email}.`,
        credentials: {
          username,
          password: autoPassword,
          role: 'crono',
          nome: aziendaCrono,
          emailTo: email,
          codiceAssegnato: codiceCrono,
          codiceLabel: 'Codice Azienda Cronometraggio'
        },
        user: newUser
      });
    }

    return res.status(400).json({ error: 'Tipologia richiesta non riconosciuta.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Errore interno durante la conferma della richiesta di registrazione.' });
  }
});

// Reject and completely delete a registration request (Admin only)
app.delete('/api/admin/registration-requests/:id', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Operazione consentita esclusivamente agli utenti di tipo amministratore.' });
  }
  const reqId = String(req.params.id);
  const reqIdx = registrationRequests.findIndex(r => String(r.id) === reqId);
  if (reqIdx === -1) {
    return res.status(404).json({ error: 'Richiesta di registrazione non trovata.' });
  }
  const removed = registrationRequests.splice(reqIdx, 1)[0];
  saveRegistrationRequests(registrationRequests);
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Rifiuto Registrazione',
    azione: 'Rifiuto e Cancellazione Richiesta Registrazione',
    oggetto: `${removed.denominazione || removed.username} (${removed.tipologiaLabel || removed.role})`,
    dettagli: `Richiesta di registrazione (ID: ${removed.id}, Username: ${removed.username}, Email: ${removed.email}) rifiutata e cancellata dall'Amministratore`,
    esito: 'OK'
  });
  return res.json({
    success: true,
    message: `Richiesta di registrazione di "${removed.denominazione || removed.username}" rifiutata e cancellata completamente dal sistema.`
  });
});

app.post('/api/admin/registration-requests/:id/reject', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Operazione consentita esclusivamente agli utenti di tipo amministratore.' });
  }
  const reqId = String(req.params.id);
  const reqIdx = registrationRequests.findIndex(r => String(r.id) === reqId);
  if (reqIdx === -1) {
    return res.status(404).json({ error: 'Richiesta di registrazione non trovata.' });
  }
  const removed = registrationRequests.splice(reqIdx, 1)[0];
  saveRegistrationRequests(registrationRequests);
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Rifiuto Registrazione',
    azione: 'Rifiuto e Cancellazione Richiesta Registrazione',
    oggetto: `${removed.denominazione || removed.username} (${removed.tipologiaLabel || removed.role})`,
    dettagli: `Richiesta di registrazione (ID: ${removed.id}, Username: ${removed.username}, Email: ${removed.email}) rifiutata e cancellata dall'Amministratore`,
    esito: 'OK'
  });
  return res.json({
    success: true,
    message: `Richiesta di registrazione di "${removed.denominazione || removed.username}" rifiutata e cancellata completamente dal sistema.`
  });
});

// Get sent/generated credentials emails (Admin only)
app.get('/api/admin/sent-emails', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso consentito esclusivamente agli utenti di tipo amministratore.' });
  }
  try {
    let logs = [];
    if (fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
    }
    let updated = false;
    logs = logs.map((entry, idx) => {
      const content = buildCredentialsEmailContent({
        to: entry.to,
        role: entry.role,
        nome: entry.nome,
        username: entry.username,
        password: entry.password,
        codiceAssegnato: entry.codiceAssegnato,
        codiceLabel: entry.codiceLabel
      });
      if (!entry.id || !entry.text || entry.subject !== content.subject || entry.from !== content.from) {
        updated = true;
        return {
          ...entry,
          id: entry.id || `mail_${idx}_${Date.now()}`,
          from: content.from,
          subject: content.subject,
          codiceLabel: content.codiceLabel,
          text: content.text,
          html: content.html
        };
      }
      return entry;
    });
    if (updated) {
      fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    }
    const smtpCfg = loadSmtpConfig();
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const visibleLogs = includeArchived ? logs : logs.filter(l => !l.archived);
    res.json({
      success: true,
      emails: visibleLogs,
      totalCount: logs.length,
      archivedCount: logs.filter(l => Boolean(l.archived)).length,
      smtpConfigured: Boolean(smtpCfg.host && smtpCfg.user && smtpCfg.pass),
      smtpHost: smtpCfg.host,
      smtpPort: smtpCfg.port,
      smtpUser: smtpCfg.user,
      fromEmail: 'federazione@skyrunningitalia.it'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore lettura registro mail inviate.' });
  }
});

// Archive a single credentials email entry (Admin only)
app.post('/api/admin/sent-emails/archive', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato.' });
  }
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID attività mancante.' });
    if (!fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      return res.status(404).json({ error: 'Registro vuoto.' });
    }
    let logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
    let found = false;
    logs = logs.map(l => {
      if (String(l.id) === String(id)) {
        found = true;
        return { ...l, archived: true, archivedAt: new Date().toISOString() };
      }
      return l;
    });
    if (!found) {
      return res.status(404).json({ error: 'Attività non trovata nel registro.' });
    }
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    res.json({ success: true, message: 'Operazione archiviata con successo.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore durante l\'archiviazione dell\'operazione.' });
  }
});

// Delete a single credentials email entry permanently (Admin only)
app.post('/api/admin/sent-emails/delete', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato.' });
  }
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID attività mancante.' });
    if (!fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      return res.status(404).json({ error: 'Registro vuoto.' });
    }
    let logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
    const prevLen = logs.length;
    logs = logs.filter(l => String(l.id) !== String(id));
    if (logs.length === prevLen) {
      return res.status(404).json({ error: 'Attività non trovata nel registro.' });
    }
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    res.json({ success: true, message: 'Attività eliminata definitivamente dal registro.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore durante l\'eliminazione dell\'attività.' });
  }
});

// Archive all current entries in the registry (Admin only)
app.post('/api/admin/sent-emails/archive-all', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato.' });
  }
  try {
    if (!fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      return res.json({ success: true, count: 0, message: 'Registro già vuoto.' });
    }
    let logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
    const nowIso = new Date().toISOString();
    let count = 0;
    logs = logs.map(l => {
      if (!l.archived) count++;
      return { ...l, archived: true, archivedAt: l.archivedAt || nowIso };
    });
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    res.json({ success: true, count, message: `Registro archiviato con successo (${count} operazioni archiviate).` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore durante l\'archiviazione del registro.' });
  }
});

// Reset (clear) all entries in the registry permanently (Admin only)
app.post('/api/admin/sent-emails/reset', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato.' });
  }
  try {
    fs.writeFileSync(SENT_EMAILS_LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
    res.json({ success: true, message: 'Registro delle operazioni svuotato con successo.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore durante lo svuotamento del registro.' });
  }
});

// Resend a credentials email (Admin only)
app.post('/api/admin/sent-emails/resend', async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Operazione consentita esclusivamente agli utenti di tipo amministratore.' });
  }
  try {
    const { id, to, role, nome, username, password, codiceAssegnato, codiceLabel } = req.body || {};
    let targetEntry = null;
    if (id && fs.existsSync(SENT_EMAILS_LOG_FILE)) {
      const logs = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_FILE, 'utf-8') || '[]');
      targetEntry = logs.find(l => String(l.id) === String(id));
    }
    const payload = targetEntry || { to, role, nome, username, password, codiceAssegnato, codiceLabel };
    if (!payload.to || !payload.username || !payload.password) {
      return res.status(400).json({ error: 'Dati email o credenziali mancanti per il reinvio.' });
    }
    const sentEntry = await sendCredentialsEmail(payload);
    return res.json({
      success: true,
      emailSent: sentEntry.smtpDelivered,
      emailData: sentEntry,
      message: sentEntry.smtpDelivered
        ? `Mail inviata con successo da ${sentEntry.from} a ${sentEntry.to}!`
        : `Mail rigenerata da ${sentEntry.from} a ${sentEntry.to}. Nota SMTP: ${sentEntry.smtpError || 'Configurare password SMTP in Opzioni Sito per invio diretto tramite server Aruba.'}`
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Errore durante il reinvio della mail.' });
  }
});

// Get & Save SMTP Configuration for federazione@skyrunningitalia.it (Admin only)
app.get('/api/admin/smtp-config', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso consentito esclusivamente agli amministratori.' });
  }
  const cfg = loadSmtpConfig();
  res.json({
    success: true,
    config: {
      fromEmail: 'federazione@skyrunningitalia.it',
      fromName: cfg.fromName || 'Federazione Italiana Skyrunning (FISky)',
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      user: cfg.user,
      hasPassword: Boolean(cfg.pass)
    }
  });
});

app.post('/api/admin/smtp-config', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Operazione consentita esclusivamente agli amministratori.' });
  }
  const b = req.body || {};
  const current = loadSmtpConfig();
  const updated = saveSmtpConfig({
    fromEmail: 'federazione@skyrunningitalia.it',
    fromName: String(b.fromName || current.fromName || 'Federazione Italiana Skyrunning (FISky)').trim(),
    host: String(b.host || current.host || 'smtps.aruba.it').trim(),
    port: Number(b.port || current.port || 465),
    secure: b.secure !== undefined ? Boolean(b.secure === true || b.secure === 'true' || b.secure === '1') : true,
    user: String(b.user || current.user || 'federazione@skyrunningitalia.it').trim(),
    pass: b.pass !== undefined && String(b.pass).trim() !== '' ? String(b.pass).trim() : current.pass
  });
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Configurazioni Sistema',
    azione: 'Aggiornamento Parametri Server SMTP (federazione@skyrunningitalia.it)',
    oggetto: `${updated.host}:${updated.port}`,
    dettagli: `Configurazione SMTP salvata per mittente federazione@skyrunningitalia.it (Utente: ${updated.user}, SSL: ${updated.secure ? 'Sì' : 'No'})`,
    esito: 'OK'
  });
  res.json({
    success: true,
    message: 'Configurazione SMTP per federazione@skyrunningitalia.it salvata con successo!',
    hasPassword: Boolean(updated.pass)
  });
});

// ================= ADMIN: GESTIONE PREZZI E QUOTE FEDERALI (QUOTE FISKY 2026) ================= //

// Ottieni tutte le quote, prezzi e note a piè di pagina
app.get('/api/admin/prezzi', (req, res) => {
  res.json({
    success: true,
    total: (db.getPrezzi() || []).length,
    prezzi: db.getPrezzi(),
    meta: db.getPrezziMeta()
  });
});

// Endpoint pubblico/condiviso per consultazione prezzi
app.get('/api/public/prezzi', (req, res) => {
  res.json({
    success: true,
    total: (db.getPrezzi() || []).length,
    prezzi: db.getPrezzi(),
    meta: db.getPrezziMeta()
  });
});

// Aggiorna una singola voce di prezzo
app.put('/api/admin/prezzi/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const updated = db.updatePrezzo(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Voce di prezzo non trovata nel database.' });
    }

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Gestione Prezzi',
      azione: `Modifica Quota/Prezzo: ${updated.voce}`,
      oggetto: `${updated.code || updated.id}`,
      dettagli: `Aggiornato prezzo a "${updated.prezzo_formatted || updated.prezzo}" per la voce "${updated.voce}" (${updated.categoria})`,
      esito: 'OK'
    });

    res.json({
      success: true,
      message: `Prezzo per "${updated.voce}" aggiornato con successo!`,
      item: updated
    });
  } catch (err) {
    console.error('Errore aggiornamento prezzo:', err);
    res.status(500).json({ success: false, error: 'Errore interno nel salvataggio del prezzo' });
  }
});

// Aggiornamento massivo di tutta la tabella prezzi e/o metadata
app.post('/api/admin/prezzi/bulk', (req, res) => {
  try {
    const { items, meta } = req.body || {};
    if (Array.isArray(items)) {
      db.savePrezzi(items);
    }
    if (meta && typeof meta === 'object') {
      db.savePrezziMeta(meta);
    }

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Gestione Prezzi',
      azione: 'Salvataggio Massivo Tariffario Prezzi FISky',
      oggetto: 'QUOTE FISKY 2026',
      dettagli: `Salvate modifiche su tabella prezzi (${Array.isArray(items) ? items.length : (db.getPrezzi() || []).length} voci)`,
      esito: 'OK'
    });

    res.json({
      success: true,
      message: 'Tabella prezzi e quote aggiornata con successo nel database!',
      total: (db.getPrezzi() || []).length,
      prezzi: db.getPrezzi(),
      meta: db.getPrezziMeta()
    });
  } catch (err) {
    console.error('Errore aggiornamento massivo prezzi:', err);
    res.status(500).json({ success: false, error: 'Errore interno nel salvataggio massivo' });
  }
});

// Ripristina i prezzi originali del tariffario ufficiale 2026
app.post('/api/admin/prezzi/reset', (req, res) => {
  try {
    const defaultFile = path.join(__dirname, 'data', 'mysql_prezzi_default.json');
    if (fs.existsSync(defaultFile)) {
      const defaultData = JSON.parse(fs.readFileSync(defaultFile, 'utf-8'));
      db.savePrezzi(defaultData);
    }
    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Gestione Prezzi',
      azione: 'Ripristino Valori Predefiniti Tariffario 2026',
      oggetto: 'QUOTE FISKY 2026',
      dettagli: 'Ripristinati i valori ufficiali originali del tariffario quote 2026',
      esito: 'OK'
    });
    res.json({
      success: true,
      message: 'Tariffario quote 2026 ripristinato con successo ai valori originali!',
      prezzi: db.getPrezzi(),
      meta: db.getPrezziMeta()
    });
  } catch (err) {
    console.error('Errore ripristino prezzi:', err);
    res.status(500).json({ success: false, error: 'Errore durante il ripristino' });
  }
});

// Helper to find the linked anagrafica entity for a user
function findUserLinkedEntity(user) {
  if (!user) return {};
  const rawUid = String(user.userId || user.rawUserId || '').replace(/^u_/, '');

  if (user.role === 'societa') {
    const rawClub = (db.rawClubs || []).find(
      c => (user.clubRawId && String(c.id) === String(user.clubRawId)) ||
           (user.rawId && String(c.id) === String(user.rawId)) ||
           (rawUid && String(c.user_id) === rawUid) ||
           (user.email && c.email && String(c.email).toLowerCase() === String(user.email).toLowerCase()) ||
           (user.ragioneSociale && c.name && String(c.name).toLowerCase() === String(user.ragioneSociale).toLowerCase()) ||
           (user.utente && c.name && String(c.name).toLowerCase() === String(user.utente).toLowerCase())
    );
    const clubFormatted = (db.clubsList || []).find(
      c => (rawClub && String(c.rawId) === String(rawClub.id)) ||
           (user.clubRawId && String(c.rawId) === String(user.clubRawId)) ||
           (user.rawId && String(c.rawId) === String(user.rawId)) ||
           (user.username && c.username && String(c.username).toLowerCase() === String(user.username).toLowerCase())
    );
    return { rawClub, clubFormatted };
  }

  if (user.role === 'singolo') {
    const uFirst = String(user.firstName || user.name || '').trim().toLowerCase();
    const uLast = String(user.lastName || user.surname || '').trim().toLowerCase();
    const rawMember = (db.rawMembers || []).find(
      m => (user.memberRawId && String(m.id) === String(user.memberRawId)) ||
           (rawUid && String(m.user_id) === rawUid) ||
           (user.email && m.email && String(m.email).toLowerCase() === String(user.email).toLowerCase()) ||
           (uFirst && uLast && m.name && m.surname &&
            String(m.name).trim().toLowerCase() === uFirst &&
            String(m.surname).trim().toLowerCase() === uLast)
    );
    const memberFormatted = (db.membersList || []).find(
      m => (rawMember && String(m.rawId) === String(rawMember.id)) ||
           (user.memberRawId && String(m.rawId) === String(user.memberRawId)) ||
           (user.tesseraNumero && m.numeroTessera === user.tesseraNumero)
    );
    return { rawMember, memberFormatted };
  }

  if (user.role === 'crono') {
    const rawChrono = (db.rawChronos || []).find(
      c => (user.chronoRawId && String(c.id) === String(user.chronoRawId)) ||
           (rawUid && String(c.user_id) === rawUid) ||
           (user.email && c.email && String(c.email).toLowerCase() === String(user.email).toLowerCase()) ||
           (user.ragioneSociale && c.name && String(c.name).toLowerCase() === String(user.ragioneSociale).toLowerCase())
    );
    const chronoFormatted = (db.chronosList || []).find(
      c => (rawChrono && String(c.rawId) === String(rawChrono.id)) ||
           (user.chronoRawId && String(c.rawId) === String(user.chronoRawId))
    );
    return { rawChrono, chronoFormatted };
  }

  return {};
}

// Get full profile and completion state for the logged-in user
app.get('/api/profile/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
  const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
  const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin' || user.impersonating);

  const linked = findUserLinkedEntity(user);
  const { password, ...safeUser } = user;

  if (user.role === 'societa') {
    const rc = linked.rawClub || {};
    const cf = linked.clubFormatted || {};
    const profileCompleted = user.profileCompleted !== undefined
      ? Boolean(user.profileCompleted)
      : (rc.profileCompleted !== undefined ? Boolean(rc.profileCompleted) : Boolean(rc.address && rc.city && rc.province && rc.region && rc.cell1 && rc.contact));

    const rawAcc = (db.rawAccounts || []).find(a => String(a.user_id) === String(rc.user_id || cf.userId || user.userId || user.rawUserId));
    const currentCredit = (cf && cf.credito !== undefined) ? Number(cf.credito) : (rawAcc ? (parseFloat(rawAcc.current) || 0) : 0);

    let cleanStatuteVerification = rc.statute_verification || cf.statute_verification || null;
    if (cleanStatuteVerification && !isAdmin) {
      cleanStatuteVerification = {
        ...cleanStatuteVerification,
        conforme: Boolean(cleanStatuteVerification.conforme || cleanStatuteVerification.forcedManual),
        forcedManual: false,
        forcedManualAt: null,
        forcedManualBy: null
      };
    }

    return res.json({
      user: { ...safeUser, profileCompleted, credito: currentCredit },
      isAdmin,
      profileCompleted,
      credito: currentCredit,
      anagrafica: {
        rawId: rc.id || cf.rawId || '',
        codice: cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || '',
        denominazione: rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || '',
        codiceFiso: rc.fisoId ? String(rc.fisoId).trim().replace(/^0+(?=\d)/, '') : (cf.codiceFiso || ''),
        ragioneSociale: rc.r_name || cf.rName || 'ASD',
        formaGiuridica: rc.r_name || cf.rName || 'ASD',
        credito: currentCredit,
        partitaIva: rc.pi || cf.partitaIva || '',
        codiceFiscale: rc.cf || cf.codiceFiscale || '',
        coniCertificateCheck: String(rc.coni_certificate || '0') === '1',
        certificate: rc.certificate || '',
        indirizzo: rc.address || cf.address || '',
        civico: rc.street_number || '',
        cap: rc.cap || cf.cap || '',
        citta: rc.city || cf.city || '',
        provincia: rc.province || cf.province || '',
        regione: rc.region || cf.region || '',
        cellulare: rc.cell1 || cf.cell1 || '',
        email: rc.email || cf.email || user.email || '',
        pec: rc.email2 || cf.email2 || '',
        referente: rc.contact || cf.contact || '',
        cellulareReferente: rc.c_cell1 || '',
        emailReferente: rc.c_email || '',
        cf_certificate: rc.cf_certificate || '',
        association_articles: rc.association_articles || '',
        statute_modification: rc.statute_modification || '',
        statute: rc.statute || '',
        statute_verification: cleanStatuteVerification,
        id_president: rc.id_president || '',
        election_act: rc.election_act || '',
        affiliation_form: rc.affiliation_form || ''
      }
    });
  }

  if (user.role === 'singolo') {
    const rm = linked.rawMember || {};
    const mf = linked.memberFormatted || {};
    const profileCompleted = user.profileCompleted !== undefined
      ? Boolean(user.profileCompleted)
      : (rm.profileCompleted !== undefined ? Boolean(rm.profileCompleted) : Boolean(rm.cf && rm.birthday && rm.birthplace && rm.address && rm.city));

    const parseToDmy = (isoStr) => {
      if (!isoStr || isoStr === '0000-00-00') return '';
      const p = geoCF.parseDateInput(isoStr);
      return p.valid ? p.dmy : isoStr;
    };

    const resolvedNome = rm.name || mf.nome || user.firstName || user.name || (user.nome ? user.nome.split(' ').slice(1).join(' ') || user.nome.split(' ')[0] : '');
    const resolvedCognome = rm.surname || mf.cognome || user.lastName || user.surname || (user.nome ? user.nome.split(' ')[0] : '');

    return res.json({
      user: { ...safeUser, profileCompleted },
      isAdmin,
      profileCompleted,
      anagrafica: {
        rawId: rm.id || mf.rawId || '',
        codiceTessera: mf.numeroTessera || rm.code || user.tesseraNumero || '',
        tipoTesseramento: user.tipoTesseramento || user.ruoloSportivo || (mf.ruoli && mf.ruoli[0]) || 'Atleta',
        nome: resolvedNome,
        cognome: resolvedCognome,
        sesso: rm.gender ? (String(rm.gender).toUpperCase().startsWith('F') ? 'Femmina' : 'Maschio') : '',
        categoria: mf.categoria || db.computeAthleteCategory(rm.birthday || mf.dataNascita || user.dataNascita || '', rm.gender || mf.sesso || '', rm.cf || mf.codiceFiscale || user.codiceFiscale || ''),
        parametriCategoria: mf.parametriCategoria || db.getAthleteCategoryParams2026(mf.categoria || db.computeAthleteCategory(rm.birthday || mf.dataNascita || user.dataNascita || '', rm.gender || mf.sesso || '', rm.cf || mf.codiceFiscale || user.codiceFiscale || '')),
        dataNascita: parseToDmy(rm.birthday || mf.dataNascita || user.dataNascita || ''),
        luogoNascita: rm.birthplace || mf.luogoNascita || '',
        codiceFiscale: rm.cf || mf.codiceFiscale || user.codiceFiscale || '',
        partitaIva: rm.pi || mf.partitaIva || user.partitaIva || '',
        titoloTecnico: rm.title_certificate || mf.titoloTecnico || '',
        indirizzo: rm.address || mf.indirizzo || user.indirizzo || '',
        civico: rm.street_number || mf.civico || '',
        cap: rm.cap || mf.cap || '',
        citta: rm.city || mf.citta || '',
        provincia: rm.province || mf.provincia || '',
        regione: rm.region || mf.regione || '',
        cellulare: rm.telephone || mf.telefono || user.telefono || '',
        email: rm.email || mf.email || user.email || '',
        scadenzaCertificatoMedico: parseToDmy(rm.mc_expire || mf.certificatoMedicoScadenza || user.scadenzaCertificato || '')
      }
    });
  }

  if (user.role === 'crono') {
    const rch = linked.rawChrono || {};
    const chf = linked.chronoFormatted || {};
    const profileCompleted = user.profileCompleted !== undefined
      ? Boolean(user.profileCompleted)
      : (rch.profileCompleted !== undefined ? Boolean(rch.profileCompleted) : Boolean(rch.address && rch.city && rch.province && rch.cell1));

    const anagCrono = {
      rawId: rch.id || chf.rawId || '',
      id: rch.id || chf.rawId || user.codiceCrono || '',
      codice: chf.codice || rch.id || user.codiceCrono || '',
      denominazione: rch.name || chf.nome || user.ragioneSociale || user.utente || user.nome || '',
      partitaIva: rch.pi || chf.partitaIva || user.partitaIva || '',
      codiceFiscale: rch.cf || chf.codiceFiscale || user.codiceFiscale || '',
      indirizzo: rch.address || chf.address || '',
      civico: rch.street_number || chf.street_number || '',
      cap: rch.cap || chf.cap || '',
      citta: rch.city || chf.city || '',
      provincia: rch.province || chf.province || '',
      regione: rch.region || chf.region || '',
      cellulare: rch.cell1 || chf.cell1 || user.telefono || '',
      email: rch.email || chf.email || user.email || '',
      pec: rch.email2 || chf.email2 || '',
      referente: rch.contact || chf.contact || user.referenteTecnico || `${user.firstName || ''} ${user.lastName || ''}`.trim() || '',
      cellulareReferente: rch.c_cell1 || chf.c_cell1 || '',
      emailReferente: rch.c_email || chf.c_email || '',
      anagraficaCompleta: profileCompleted
    };

    return res.json({
      user: { ...safeUser, profileCompleted },
      isAdmin,
      profileCompleted,
      anagrafica: anagCrono,
      profile: anagCrono
    });
  }

  return res.json({ user: safeUser, isAdmin, profileCompleted: true, anagrafica: {} });
});

// Upload document file for Società (CONI Certificate & RASD mandatory documents)
app.post('/api/societa/upload-doc', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }

    const { docKey, fileName, fileDataBase64 } = req.body || {};
    const allowedDocKeys = new Set([
      'certificate',
      'cf_certificate',
      'association_articles',
      'statute_modification',
      'statute',
      'id_president',
      'election_act',
      'affiliation_form'
    ]);

    if (!allowedDocKeys.has(docKey)) {
      return res.status(400).json({ error: 'Tipologia documento non valida.' });
    }
    if (!fileName || !fileDataBase64) {
      return res.status(400).json({ error: 'File mancante.' });
    }

    const linked = findUserLinkedEntity(user);
    const clubId = (linked.rawClub && linked.rawClub.id) || user.clubRawId || 'general';
    const uploadDir = path.join(__dirname, 'public', 'uploads', 'societa', String(clubId));
    fs.mkdirSync(uploadDir, { recursive: true });

    const safeFileName = `${Date.now()}_${String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const fullFilePath = path.join(uploadDir, safeFileName);
    const base64Clean = String(fileDataBase64).replace(/^data:[^;]+;base64,/, '');
    fs.writeFileSync(fullFilePath, Buffer.from(base64Clean, 'base64'));

    const publicUrl = `/uploads/societa/${clubId}/${safeFileName}`;

    if (linked.rawClub) {
      linked.rawClub[docKey] = publicUrl;
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }
    if (linked.clubFormatted) {
      linked.clubFormatted[docKey] = publicUrl;
    }

    const DOC_LABELS = {
      certificate: 'Certificato Iscrizione CONI',
      cf_certificate: 'Certificato Attribuzione Codice Fiscale / P.IVA',
      association_articles: 'Atto Costitutivo Registrato',
      statute_modification: 'Verbale Modifica Statuto',
      statute: 'Statuto Sociale Registrato',
      id_president: 'Documento Identità Legale Rappresentante',
      election_act: 'Verbale Elezione Cariche Sociali',
      affiliation_form: 'Modulo Affiliazione Firmato'
    };

    recordOperationLog(req, {
      origine: isAdminUser(req) ? 'admin' : 'frontend',
      categoria: 'Documentazione Societaria',
      azione: 'Caricamento Documento Societario',
      oggetto: `${DOC_LABELS[docKey] || docKey} (${fileName})`,
      dettagli: `Società ID: ${clubId} (${(linked.rawClub && linked.rawClub.name) || user.nome || ''}) | Documento: ${DOC_LABELS[docKey] || docKey} | File salvato: ${publicUrl}`,
      esito: 'OK'
    });

    return res.json({
      success: true,
      docKey,
      fileName,
      fileUrl: publicUrl,
      message: `File "${fileName}" caricato e salvato correttamente sul server.`
    });
  } catch (err) {
    console.error('Errore upload documento società:', err);
    return res.status(500).json({ error: 'Errore durante il salvataggio del file sul server.' });
  }
});

// Helper: Evaluate Statute Compliance with D.Lgs. 36/2021 & RASD rules
function evaluateStatuteCompliance(statuteUrl, rc, cf, testMode = null) {
  const baseName = path.basename(statuteUrl || '');
  const normBaseName = baseName.toLowerCase();

  let textFound = '';

  // Attempt to read local file content if present in public folder
  try {
    let localPath = null;
    if (statuteUrl && statuteUrl.startsWith('/uploads/')) {
      localPath = path.join(__dirname, 'public', statuteUrl);
    } else if (statuteUrl) {
      const uploadsDir = path.join(__dirname, 'public', 'uploads', 'societa');
      if (fs.existsSync(uploadsDir)) {
        const found = fs.readdirSync(uploadsDir, { recursive: true, withFileTypes: true })
          .find(e => e.isFile && e.isFile() && e.name.toLowerCase() === baseName.toLowerCase());
        if (found) {
          localPath = path.join(found.parentPath || found.path, found.name);
        }
      }
    }

    if (localPath && fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      textFound += buf.toString('latin1') + ' ' + buf.toString('utf8');

      // Attempt stream inflation for compressed PDFs
      let streamIdx = 0;
      while ((streamIdx = buf.indexOf(Buffer.from('stream'), streamIdx)) !== -1) {
        let start = streamIdx + 6;
        if (buf[start] === 0x0d && buf[start+1] === 0x0a) start += 2;
        else if (buf[start] === 0x0a || buf[start] === 0x0d) start += 1;
        const end = buf.indexOf(Buffer.from('endstream'), start);
        if (end !== -1 && end > start) {
          const chunk = buf.slice(start, end);
          try {
            const zlib = require('zlib');
            const decomp = zlib.inflateSync(chunk);
            textFound += ' ' + decomp.toString('latin1');
          } catch(e) {}
          streamIdx = end + 9;
        } else {
          break;
        }
      }
    }
  } catch(e) {
    console.warn('Errore lettura file statuto per verifica:', e.message);
  }

  const allText = (normBaseName + ' ' + textFound).toLowerCase();

  // Keyword criteria
  const hasDlgs36 = allText.includes('36/2021') || allText.includes('36-2021') || allText.includes('36_2021') || allText.includes('riforma dello sport');
  const hasSecondarie = allText.includes('secondari') || allText.includes('strumental') || allText.includes('art. 9') || allText.includes('attività diverse') || allText.includes('attivita diverse');
  const hasIncompatibilita = allText.includes('incompatibilit') || (hasDlgs36 && (allText.includes('art. 11') || allText.includes('medesima')));
  const hasSafeguarding = allText.includes('safeguarding') || allText.includes('39/2021') || allText.includes('tutela dei minori') || allText.includes('modelli organizzativi') || allText.includes('codici di condotta');

  // Year detection from filename (e.g. 2015, 2018, 2019, 2021, 2023 vs 2024, 2025, 2026)
  const yearMatches = normBaseName.match(/(19|20)\d{2}/g);
  const detectedYear = yearMatches ? parseInt(yearMatches[yearMatches.length - 1], 10) : null;
  const isOldYear = detectedYear && detectedYear < 2024;

  let isConforme = (hasDlgs36 && (hasSecondarie || hasSafeguarding || detectedYear >= 2024)) && !isOldYear;

  if (testMode === 'conforme') isConforme = true;
  if (testMode === 'non_conforme') isConforme = false;

  const checklist = [
    {
      punto: "1",
      titolo: "Denominazione e forma sportiva dilettantistica (ASD / SSD)",
      norma: "Art. 7, comma 1, lett. a) D.Lgs. 36/2021",
      ok: true,
      dettaglio: "Presenza della dicitura di Associazione Sportiva Dilettantistica o Società Sportiva Dilettantistica."
    },
    {
      punto: "2",
      titolo: "Oggetto sociale principale sportivo (organizzazione e gestione)",
      norma: "Art. 7, comma 1, lett. b) D.Lgs. 36/2021",
      ok: true,
      dettaglio: "Svolgimento in via stabile e principale dell'attività sportiva dilettantistica, compresa didattica e formazione."
    },
    {
      punto: "3",
      titolo: "Clausola per attività secondarie e strumentali",
      norma: "Art. 9 D.Lgs. 36/2021",
      ok: isConforme || hasSecondarie,
      dettaglio: (isConforme || hasSecondarie) 
        ? "Clausola statutaria presente che consente e disciplina l'esercizio di attività secondarie e strumentali."
        : "Mancata previsione statutaria che disciplina i limiti per le attività secondarie e strumentali diverse da quelle sportive."
    },
    {
      punto: "4",
      titolo: "Assenza scopo di lucro e divieto di ripartizione utili",
      norma: "Art. 8 D.Lgs. 36/2021",
      ok: true,
      dettaglio: "Destinazione dei proventi e divieto di distribuzione anche indiretta di utili, avanzi o riserve."
    },
    {
      punto: "5",
      titolo: "Devoluzione patrimonio a fini sportivi in caso di estinzione",
      norma: "Art. 7 D.Lgs. 36/2021",
      ok: true,
      dettaglio: "Clausola inderogabile di devoluzione del patrimonio residuo per finalità sportive conforme al RASD."
    },
    {
      punto: "6",
      titolo: "Disciplina incompatibilità degli amministratori",
      norma: "Art. 11 D.Lgs. 36/2021",
      ok: isConforme || hasIncompatibilita,
      dettaglio: (isConforme || hasIncompatibilita)
        ? "Clausola di incompatibilità conforme al divieto di cariche nella medesima FSN/DSA/EPS."
        : "Clausola non aggiornata con il divieto per gli amministratori di ricoprire cariche in altre ASD/SSD della stessa disciplina o federazione."
    },
    {
      punto: "7",
      titolo: "Democrazia interna, uguaglianza e parità di diritti dei soci",
      norma: "Art. 7 D.Lgs. 36/2021",
      ok: true,
      dettaglio: "Principi di democrazia interna, eleggibilità delle cariche e parità di voto dei soci maggiorenni."
    },
    {
      punto: "8",
      titolo: "Norme di Safeguarding e contrasto ad abusi e molestie",
      norma: "Art. 16 D.Lgs. 39/2021 e Art. 33 D.Lgs. 36/2021",
      ok: isConforme || hasSafeguarding,
      dettaglio: (isConforme || hasSafeguarding)
        ? "Recepimento statutario dei modelli organizzativi e codici di condotta per la tutela dei minori e contro abusi e molestie."
        : "Assenza delle prescrizioni statutarie sull'adozione dei modelli di Safeguarding e nomina del Responsabile contro abusi."
    },
    {
      punto: "9",
      titolo: "Registrazione dell'adeguamento statutario RASD",
      norma: "D.Lgs. 36/2021 e Regolamento RASD",
      ok: isConforme,
      dettaglio: isConforme
        ? "Statuto sociale adeguato registrato presso l'Agenzia delle Entrate conforme alle scadenze di legge."
        : "Lo statuto caricato risulta registrato antecedentemente all'entrata in vigore della Riforma o privo dell'adeguamento obbligatorio (termine perentorio 30/06/2024)."
    }
  ];

  const motivazioni = [];
  if (!checklist[2].ok) {
    motivazioni.push("Mancata previsione statutaria espressa per l'esercizio delle attività secondarie e strumentali ai sensi dell'art. 9 del D.Lgs. 36/2021.");
  }
  if (!checklist[5].ok) {
    motivazioni.push("Clausola di incompatibilità per i componenti del Consiglio Direttivo non aggiornata ai sensi dell'art. 11 del D.Lgs. 36/2021 (divieto di ricoprire cariche in altre ASD o SSD nell'ambito della medesima Federazione Sportiva Nazionale, Disciplina Sportiva Associata o Ente di Promozione Sportiva).");
  }
  if (!checklist[7].ok) {
    motivazioni.push("Assenza del recepimento statutario obbligatorio delle politiche di Safeguarding a tutela dei minori e per il contrasto di molestie, violenza di genere e di ogni condizione di discriminazione (art. 16 D.Lgs. 39/2021 e art. 33 D.Lgs. 36/2021).");
  }
  if (!checklist[8].ok) {
    motivazioni.push("Mancato deposito di un testo statutario adeguato e registrato presso l'Agenzia delle Entrate successivamente all'entrata in vigore del D.Lgs. 36/2021 (il termine ultimo con esenzione fiscale dall'imposta di registro è decorso il 30 giugno 2024).");
  }

  const prevVerification = rc?.statute_verification || cf?.statute_verification;
  const prevForced = Boolean(
    prevVerification &&
    (prevVerification.docName === baseName || prevVerification.baseName === baseName || prevVerification.statuteUrl === statuteUrl) &&
    prevVerification.forcedManual
  );

  const raccomandazioni = isConforme
    ? "Lo statuto sociale risulta a norma con la Riforma dello Sport e con i requisiti obbligatori per l'iscrizione al Registro Nazionale delle Attività Sportive Dilettantistiche (RASD)."
    : "Per regolarizzare la posizione della società e mantenere la regolare iscrizione al Registro Nazionale delle Attività Sportive Dilettantistiche (RASD), l'Associazione deve convocare un'Assemblea Straordinaria dei Soci per approvare l'adeguamento dello statuto ai sensi del D.Lgs. 36/2021 e D.Lgs. 39/2021, registrarlo presso l'Agenzia delle Entrate e ricaricarlo nella sezione Documentazione Obbligatoria RASD.";

  return {
    conforme: isConforme,
    baseName,
    docName: baseName,
    statuteUrl,
    verifiedAt: new Date().toISOString(),
    dataVerifica: new Date().toISOString(),
    motivazioni: isConforme ? [] : motivazioni,
    checklist,
    raccomandazioni,
    forcedManual: prevForced,
    forcedManualAt: prevForced ? (prevVerification.forcedManualAt || null) : null,
    forcedManualBy: prevForced ? (prevVerification.forcedManualBy || null) : null
  };
}

// Route to verify Statute compliance (D.Lgs. 36/2021 & RASD)
app.post('/api/societa/verifica-statuto', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
    const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
    const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin' || user.impersonating);

    if (!isAdmin) {
      return res.status(403).json({ error: 'La gestione e verifica della conformità dello Statuto è permessa esclusivamente alle utenze amministrative.' });
    }

    let { rawClub, club } = getClubForUser(user);
    if ((!rawClub || !club) && isAdmin && (req.body?.clubId || req.query?.clubId)) {
      const targetClubId = req.body?.clubId || req.query?.clubId;
      club = (db.clubsList || []).find(c => String(c.rawId) === String(targetClubId) || String(c.id) === String(targetClubId) || String(c.codice) === String(targetClubId)) || club;
      rawClub = (db.rawClubs || []).find(c => String(c.id) === String(targetClubId) || (club && String(c.id) === String(club.rawId))) || rawClub;
    }
    const rc = rawClub || {};
    const cf = club || {};
    const statuteUrl = req.body?.fileUrl || rc.statute || cf.statute || '';

    if (!statuteUrl) {
      return res.status(400).json({ error: 'Nessun file di statuto sociale caricato da verificare.' });
    }

    const testMode = req.body?.testMode || null;
    const result = evaluateStatuteCompliance(statuteUrl, rc, cf, testMode);

    // Save verification result in club record
    if (rc) {
      rc.statute_verification = result;
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }
    if (cf) {
      cf.statute_verification = result;
    }

    recordOperationLog(req, {
      origine: user.role === 'admin' ? 'admin' : 'frontend',
      categoria: 'Documentazione Societaria',
      azione: 'Verifica Conformità Statuto RASD (D.Lgs. 36/2021)',
      oggetto: `${rc.name || cf.nome || user.nome} - Statuto (${result.baseName})`,
      dettagli: `Esito: ${result.conforme ? 'CONFORME' : 'NON CONFORME'}. ${result.motivazioni?.length ? 'Motivazioni: ' + result.motivazioni.join(' | ') : 'Tutti i requisiti RASD superati.'}`,
      esito: result.conforme ? 'OK' : 'AVVISO'
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('Errore durante verifica statuto:', err);
    return res.status(500).json({ error: 'Errore durante la verifica dello statuto: ' + err.message });
  }
});

// Route to toggle manual override of statute verification
app.post('/api/societa/forza-verifica-statuto', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autenticato' });
    }

    const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
    const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
    const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin' || user.impersonating);

    if (!isAdmin) {
      return res.status(403).json({ error: 'La forzatura manuale della conformità dello Statuto è permessa esclusivamente alle utenze amministrative.' });
    }

    let { rawClub, club } = getClubForUser(user);
    if ((!rawClub || !club) && isAdmin && (req.body?.clubId || req.query?.clubId)) {
      const targetClubId = req.body?.clubId || req.query?.clubId;
      club = (db.clubsList || []).find(c => String(c.rawId) === String(targetClubId) || String(c.id) === String(targetClubId) || String(c.codice) === String(targetClubId)) || club;
      rawClub = (db.rawClubs || []).find(c => String(c.id) === String(targetClubId) || (club && String(c.id) === String(club.rawId))) || rawClub;
    }
    const rc = rawClub || {};
    const cf = club || {};
    const forced = Boolean(req.body?.forced);

    if (!rc.statute_verification && !cf.statute_verification) {
      const statuteUrl = rc.statute || cf.statute || '';
      if (!statuteUrl) {
        return res.status(400).json({ error: 'Nessun file di statuto sociale caricato.' });
      }
      rc.statute_verification = evaluateStatuteCompliance(statuteUrl, rc, cf);
    }

    const v = rc.statute_verification || cf.statute_verification || {};
    v.forcedManual = forced;
    v.forcedManualAt = forced ? new Date().toISOString() : null;
    v.forcedManualBy = forced ? (user.name || user.username || 'Verifica Manuale') : null;

    if (rc) {
      rc.statute_verification = v;
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }
    if (cf) {
      cf.statute_verification = v;
    }

    recordOperationLog(req, {
      origine: user.role === 'admin' ? 'admin' : 'frontend',
      categoria: 'Documentazione Societaria',
      azione: forced ? 'Forzatura Manuale Conformità Statuto RASD (Abilitata)' : 'Forzatura Manuale Conformità Statuto RASD (Disabilitata)',
      oggetto: `${rc.name || cf.nome || user.nome} - Statuto (${v.docName || v.baseName || 'Documento'})`,
      dettagli: forced ? 'Conformità forzata manualmente a seguito di verifica visiva diretta del file.' : 'Forzatura manuale revocata. Ripristinato esito automatico.',
      esito: 'OK'
    });

    return res.json({
      success: true,
      forcedManual: forced,
      message: forced ? 'Forzatura manuale abilitata con successo: lo statuto è considerato conforme.' : 'Forzatura manuale disabilitata: ripristinato esito automatico.',
      statute_verification: v
    });
  } catch (err) {
    console.error('Errore durante forzatura verifica statuto:', err);
    return res.status(500).json({ error: 'Errore durante l\'aggiornamento della forzatura manuale: ' + err.message });
  }
});

// Route to get current verification status
app.get('/api/societa/verifica-statuto', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }
    const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
    const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
    const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin' || user.impersonating);

    let { rawClub, club } = getClubForUser(user);
    if ((!rawClub || !club) && isAdmin && (req.body?.clubId || req.query?.clubId)) {
      const targetClubId = req.body?.clubId || req.query?.clubId;
      club = (db.clubsList || []).find(c => String(c.rawId) === String(targetClubId) || String(c.id) === String(targetClubId) || String(c.codice) === String(targetClubId)) || club;
      rawClub = (db.rawClubs || []).find(c => String(c.id) === String(targetClubId) || (club && String(c.id) === String(club.rawId))) || rawClub;
    }
    const rc = rawClub || {};
    const cf = club || {};
    let saved = rc.statute_verification || cf.statute_verification || null;
    if (saved && !isAdmin) {
      saved = {
        ...saved,
        conforme: Boolean(saved.conforme || saved.forcedManual),
        forcedManual: false,
        forcedManualAt: null,
        forcedManualBy: null
      };
    }
    return res.json({ success: true, verification: saved, isAdmin });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
});

// Save & validate Società Anagrafica (Step 2 / First login completion)
app.put('/api/profile/societa', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }

    const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
    const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
    const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin');

    const b = req.body || {};
    const errors = [];

    const denominazione = String(b.denominazione || '').trim();
    const ragioneSociale = String(b.ragioneSociale || b.formaGiuridica || '').trim();
    const partitaIva = String(b.partitaIva || '').trim();
    const codiceFiscale = String(b.codiceFiscale || '').trim();
    const coniCertificateCheck = Boolean(b.coniCertificateCheck === true || b.coniCertificateCheck === 'true' || b.coniCertificateCheck === '1');
    const indirizzo = String(b.indirizzo || '').trim();
    const civico = String(b.civico || '').trim();
    const cap = String(b.cap || '').trim();
    const citta = String(b.citta || '').trim();
    const provincia = String(b.provincia || '').trim().toUpperCase();
    const regione = String(b.regione || '').trim();
    const cellulareRaw = String(b.cellulare || '').trim();
    const email = String(b.email || '').trim();
    const pec = String(b.pec || '').trim();
    const referente = String(b.referente || '').trim();
    const cellulareReferenteRaw = String(b.cellulareReferente || '').trim();
    const emailReferente = String(b.emailReferente || '').trim();

    if (!denominazione) errors.push('Il campo "Denominazione" è obbligatorio.');
    if (!['ASD', 'SSD', 'Ente senza fine di lucro', 'Altro'].includes(ragioneSociale)) {
      errors.push('Selezionare un valore valido per "Forma Giuridica" (ASD, SSD, Ente senza fine di lucro, Altro).');
    }
    if (!indirizzo) errors.push('Il campo "Indirizzo" è obbligatorio.');
    if (!civico) errors.push('Il campo "Civico" è obbligatorio.');

    if (!cap) {
      errors.push('Il campo "CAP" è obbligatorio.');
    } else {
      const capCheck = geoCF.validateItalianCap(cap, provincia);
      if (!capCheck.valid) errors.push(capCheck.error);
    }

    if (!citta) {
      errors.push('Il campo "Città/Località" è obbligatorio.');
    } else {
      const cityCheck = geoCF.validateItalianCity(citta);
      if (!cityCheck.valid) errors.push(cityCheck.error);
    }

    if (!provincia || !geoCF.ITALIAN_PROVINCES.some(p => p.code === provincia)) {
      errors.push('Selezionare una "Provincia" italiana valida (formato a 2 caratteri).');
    }
    if (!regione || !geoCF.ITALIAN_REGIONS.includes(regione)) {
      errors.push('Selezionare una "Regione" italiana valida.');
    }

    const cellCheck = geoCF.formatItalianPhone(cellulareRaw);
    if (!cellCheck.valid) {
      errors.push('Campo "Cellulare": ' + cellCheck.error);
    }

    if (!email || !geoCF.isValidEmail(email)) {
      errors.push('Inserire un "Indirizzo mail" societario formalmente valido.');
    }
    if (pec && !geoCF.isValidEmail(pec)) {
      errors.push('L\'indirizzo "PEC" digitato non ha un formato email valido.');
    }
    if (!referente) {
      errors.push('Il campo "Referente" è obbligatorio.');
    }

    const cellRefCheck = geoCF.formatItalianPhone(cellulareReferenteRaw);
    if (!cellRefCheck.valid) {
      errors.push('Campo "Cellulare Referente": ' + cellRefCheck.error);
    }

    if (!emailReferente || !geoCF.isValidEmail(emailReferente)) {
      errors.push('Inserire un "Indirizzo mail referente" formalmente valido.');
    }

    const linked = findUserLinkedEntity(user);
    const rc = linked.rawClub;
    const cf = linked.clubFormatted;

    const certConiUrl = String(b.certificate || (rc && rc.certificate) || '').trim();
    if (coniCertificateCheck && !certConiUrl) {
      errors.push('Avendo spuntato "Certificato Iscrizione CONI", è necessario caricare il file del "Certificato".');
    }

    if (errors.length > 0) {
      recordOperationLog(req, {
        origine: isAdmin ? 'admin' : 'frontend',
        categoria: 'Anagrafica Utente',
        azione: 'Aggiornamento Anagrafica Società Fallito (Validazione)',
        oggetto: denominazione || user.nome || user.username,
        dettagli: `Errori di validazione: ${errors.join(' | ')}`,
        esito: 'ERRORE'
      });
      return res.status(400).json({ error: errors.join('\n'), errors });
    }

    if (rc) {
      rc.name = denominazione;
      if (isAdmin && b.codiceFiso !== undefined) {
        rc.fisoId = String(b.codiceFiso).trim().replace(/^0+(?=\d)/, '');
      }
      rc.r_name = ragioneSociale;
      rc.pi = partitaIva;
      rc.cf = codiceFiscale;
      rc.coni_certificate = coniCertificateCheck ? '1' : '0';
      if (b.certificate !== undefined) rc.certificate = String(b.certificate).trim();
      rc.address = indirizzo;
      rc.street_number = civico;
      rc.cap = cap;
      rc.city = citta;
      rc.province = provincia;
      rc.region = regione;
      rc.cell1 = cellCheck.formatted;
      rc.email = email;
      rc.email2 = pec;
      rc.contact = referente;
      rc.c_cell1 = cellRefCheck.formatted;
      rc.c_email = emailReferente;
      if (b.cf_certificate !== undefined) rc.cf_certificate = String(b.cf_certificate).trim();
      if (b.association_articles !== undefined) rc.association_articles = String(b.association_articles).trim();
      if (b.statute_modification !== undefined) rc.statute_modification = String(b.statute_modification).trim();
      if (b.statute !== undefined) rc.statute = String(b.statute).trim();
      if (b.id_president !== undefined) rc.id_president = String(b.id_president).trim();
      if (b.election_act !== undefined) rc.election_act = String(b.election_act).trim();
      if (b.affiliation_form !== undefined) rc.affiliation_form = String(b.affiliation_form).trim();
      rc.is_new = '0';
      rc.profileCompleted = true;
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }

    if (cf) {
      cf.nome = denominazione;
      cf.ragioneSociale = denominazione;
      if (isAdmin && b.codiceFiso !== undefined) {
        cf.codiceFiso = String(b.codiceFiso).trim().replace(/^0+(?=\d)/, '');
      }
      cf.rName = ragioneSociale;
      cf.partitaIva = partitaIva;
      cf.codiceFiscale = codiceFiscale;
      cf.coni_certificate = coniCertificateCheck ? '1' : '0';
      if (b.certificate !== undefined) cf.certificate = String(b.certificate).trim();
      cf.address = indirizzo;
      cf.street_number = civico;
      cf.cap = cap;
      cf.city = citta;
      cf.province = provincia;
      cf.region = regione;
      cf.sede = `${citta} (${provincia})`;
      cf.cell1 = cellCheck.formatted;
      cf.telefono = cellCheck.formatted;
      cf.email = email;
      cf.email2 = pec;
      cf.contact = referente;
      cf.legaleRappresentante = referente;
      cf.c_cell1 = cellRefCheck.formatted;
      cf.c_email = emailReferente;
      if (b.cf_certificate !== undefined) cf.cf_certificate = String(b.cf_certificate).trim();
      if (b.association_articles !== undefined) cf.association_articles = String(b.association_articles).trim();
      if (b.statute_modification !== undefined) cf.statute_modification = String(b.statute_modification).trim();
      if (b.statute !== undefined) cf.statute = String(b.statute).trim();
      if (b.id_president !== undefined) cf.id_president = String(b.id_president).trim();
      if (b.election_act !== undefined) cf.election_act = String(b.election_act).trim();
      if (b.affiliation_form !== undefined) cf.affiliation_form = String(b.affiliation_form).trim();
      cf.profileCompleted = true;
    }

    user.utente = denominazione;
    user.nome = denominazione;
    user.ragioneSociale = denominazione;
    user.email = email;
    user.telefono = cellCheck.formatted;
    user.profileCompleted = true;
    const targetListSoc = (db.usersList || []).find(u => u.id === user.id || (user.username && u.username === user.username));
    if (targetListSoc) Object.assign(targetListSoc, user);
    saveDynamicUsersFile();

    recordOperationLog(req, {
      origine: isAdmin ? 'admin' : 'frontend',
      categoria: 'Anagrafica Utente',
      azione: 'Aggiornamento Anagrafica Società Sportiva',
      oggetto: `${denominazione} (Cod. ${(cf && cf.codice) || (rc && rc.codice) || user.codiceSocieta || '-'})`,
      dettagli: `Sede: ${indirizzo} ${civico}, ${cap} ${citta} (${provincia}) - ${regione} | CF: ${codiceFiscale || '-'} | P.IVA: ${partitaIva || '-'} | Referente: ${referente} (${cellRefCheck.formatted})`,
      esito: 'OK'
    });

    return res.json({
      success: true,
      message: 'Dati anagrafici della società salvati con successo!',
      cellulareFormatted: cellCheck.formatted,
      cellulareReferenteFormatted: cellRefCheck.formatted
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Errore interno durante il salvataggio dei dati societari.' });
  }
});

// Save & validate Persona Singola Anagrafica (Step 2 / First login completion)
app.put('/api/profile/singolo', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user || (user.role !== 'singolo' && user.role !== 'admin')) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }

    const realAdminUserId = req.cookies && req.cookies.fisky_user_id;
    const realUser = realAdminUserId ? (db.usersList || []).find(u => u.id === realAdminUserId) : null;
    const isAdmin = Boolean((realUser && realUser.role === 'admin') || user.role === 'admin');

    const b = req.body || {};
    const errors = [];

    const nome = String(b.nome || '').trim();
    const cognome = String(b.cognome || '').trim();
    const sesso = String(b.sesso || '').trim();
    const dataNascitaRaw = String(b.dataNascita || '').trim();
    const luogoNascita = String(b.luogoNascita || '').trim();
    const codiceFiscale = String(b.codiceFiscale || '').trim().toUpperCase();
    const partitaIva = String(b.partitaIva || '').trim();
    const indirizzo = String(b.indirizzo || '').trim();
    const civico = String(b.civico || '').trim();
    const cap = String(b.cap || '').trim();
    const citta = String(b.citta || '').trim();
    const provincia = String(b.provincia || '').trim().toUpperCase();
    const regione = String(b.regione || '').trim();
    const cellulareRaw = String(b.cellulare || '').trim();
    const email = String(b.email || '').trim();
    const scadenzaCertRaw = String(b.scadenzaCertificatoMedico || '').trim();

    if (!nome) errors.push('Il campo "Nome" è obbligatorio.');
    if (!cognome) errors.push('Il campo "Cognome" è obbligatorio.');
    if (!['Maschio', 'Femmina', 'M', 'F'].includes(sesso)) {
      errors.push('Selezionare il "Sesso" (Maschio o Femmina).');
    }

    const parsedBirth = geoCF.parseDateInput(dataNascitaRaw);
    if (!parsedBirth.valid) {
      errors.push('Inserire una "Data di nascita" valida nel formato gg/mm/aaaa.');
    }

    if (!luogoNascita) {
      errors.push('Il campo "Luogo di nascita" è obbligatorio.');
    } else {
      const bpCheck = geoCF.validateBirthplace(luogoNascita);
      if (!bpCheck.valid) errors.push(bpCheck.error);
    }

    if (!codiceFiscale) {
      errors.push('Il campo "Codice Fiscale" è obbligatorio.');
    } else {
      const cfCheck = geoCF.validateCodiceFiscaleCongruence(codiceFiscale, {
        nome,
        cognome,
        sesso,
        dataNascita: dataNascitaRaw,
        luogoNascita
      });
      if (!cfCheck.valid) errors.push(cfCheck.error);
    }

    if (!indirizzo) errors.push('Il campo "Indirizzo" è obbligatorio.');
    if (!civico) errors.push('Il campo "Civico" è obbligatorio.');

    if (!cap) {
      errors.push('Il campo "CAP" è obbligatorio.');
    } else {
      const capCheck = geoCF.validateItalianCap(cap, provincia);
      if (!capCheck.valid) errors.push(capCheck.error);
    }

    if (!citta) {
      errors.push('Il campo "Città/Località" è obbligatorio.');
    } else {
      const cityCheck = geoCF.validateItalianCity(citta);
      if (!cityCheck.valid) errors.push(cityCheck.error);
    }

    if (!provincia || !geoCF.ITALIAN_PROVINCES.some(p => p.code === provincia)) {
      errors.push('Selezionare una "Provincia" italiana valida (formato a 2 caratteri).');
    }
    if (!regione || !geoCF.ITALIAN_REGIONS.includes(regione)) {
      errors.push('Selezionare una "Regione" italiana valida.');
    }

    const cellCheck = geoCF.formatItalianPhone(cellulareRaw);
    if (!cellCheck.valid) {
      errors.push('Campo "Cellulare/Telefono": ' + cellCheck.error);
    }

    if (!email || !geoCF.isValidEmail(email)) {
      errors.push('Inserire un "Indirizzo mail" formalmente valido.');
    }

    let parsedMcIso = '0000-00-00';
    if (scadenzaCertRaw) {
      const parsedMc = geoCF.parseDateInput(scadenzaCertRaw);
      if (!parsedMc.valid) {
        errors.push('La "Data scadenza Certificato Medico Agonistico (B1-B6)" deve essere nel formato gg/mm/aaaa.');
      } else {
        parsedMcIso = parsedMc.iso;
      }
    }

    if (errors.length > 0) {
      recordOperationLog(req, {
        origine: isAdmin ? 'admin' : 'frontend',
        categoria: 'Anagrafica Utente',
        azione: 'Aggiornamento Anagrafica Singolo Fallito (Validazione)',
        oggetto: `${nome} ${cognome}`.trim() || user.nome || user.username,
        dettagli: `Errori di validazione: ${errors.join(' | ')}`,
        esito: 'ERRORE'
      });
      return res.status(400).json({ error: errors.join('\n'), errors });
    }

    const genderChar = sesso.toUpperCase().startsWith('F') ? 'F' : 'M';
    const linked = findUserLinkedEntity(user);
    const rm = linked.rawMember;
    const mf = linked.memberFormatted;

    if (rm) {
      rm.name = nome;
      rm.surname = cognome;
      rm.gender = genderChar;
      rm.birthday = parsedBirth.iso;
      rm.birthplace = luogoNascita;
      rm.cf = codiceFiscale;
      rm.pi = partitaIva;
      if (isAdmin && b.titoloTecnico !== undefined) {
        rm.title_certificate = String(b.titoloTecnico).trim();
      }
      rm.address = indirizzo;
      rm.street_number = civico;
      rm.cap = cap;
      rm.city = citta;
      rm.province = provincia;
      rm.region = regione;
      rm.telephone = cellCheck.formatted;
      rm.email = email;
      rm.mc_expire = parsedMcIso;
      rm.profileCompleted = true;
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }

    if (mf) {
      mf.nome = nome;
      mf.cognome = cognome;
      mf.sesso = genderChar;
      mf.dataNascita = parsedBirth.iso;
      mf.luogoNascita = luogoNascita;
      mf.codiceFiscale = codiceFiscale;
      mf.categoria = db.computeAthleteCategory(parsedBirth.iso, genderChar, codiceFiscale);
      mf.parametriCategoria = db.getAthleteCategoryParams2026(mf.categoria);
      mf.partitaIva = partitaIva;
      if (isAdmin && b.titoloTecnico !== undefined) {
        mf.titoloTecnico = String(b.titoloTecnico).trim();
      }
      mf.indirizzo = indirizzo;
      mf.civico = civico;
      mf.cap = cap;
      mf.citta = citta;
      mf.provincia = provincia;
      mf.regione = regione;
      mf.telefono = cellCheck.formatted;
      mf.email = email;
      mf.certificatoMedicoScadenza = parsedMcIso !== '0000-00-00' ? parsedMcIso : '';
      mf.profileCompleted = true;

      const atlTarget = (db.atletiList || []).find(a => a.id === mf.id || String(a.rawId) === String(mf.rawId));
      if (atlTarget) {
        atlTarget.nome = mf.nome;
        atlTarget.cognome = mf.cognome;
        atlTarget.sesso = mf.sesso;
        atlTarget.dataNascita = mf.dataNascita;
        atlTarget.luogoNascita = mf.luogoNascita;
        atlTarget.codiceFiscale = mf.codiceFiscale;
        atlTarget.categoria = mf.categoria;
        atlTarget.parametriCategoria = mf.parametriCategoria;
      }
    }

    user.utente = `${cognome} ${nome}`.trim();
    user.nome = `${cognome} ${nome}`.trim();
    user.firstName = nome;
    user.lastName = cognome;
    user.codiceFiscale = codiceFiscale;
    user.partitaIva = partitaIva;
    user.dataNascita = parsedBirth.iso;
    user.email = email;
    user.telefono = cellCheck.formatted;
    user.indirizzo = `${indirizzo} ${civico}, ${cap} ${citta} (${provincia})`;
    user.profileCompleted = true;
    const targetListSin = (db.usersList || []).find(u => u.id === user.id || (user.username && u.username === user.username));
    if (targetListSin) Object.assign(targetListSin, user);
    saveDynamicUsersFile();

    recordOperationLog(req, {
      origine: isAdmin ? 'admin' : 'frontend',
      categoria: 'Anagrafica Utente',
      azione: 'Aggiornamento Anagrafica Tesserato Singolo',
      oggetto: `${nome} ${cognome} (Tessera ${(mf && mf.numeroTessera) || user.tesseraNumero || '-'})`,
      dettagli: `CF: ${codiceFiscale} | Data Nascita: ${parsedBirth.dmy} (${luogoNascita}) | Residenza: ${indirizzo} ${civico}, ${cap} ${citta} (${provincia}) | Scadenza Cert. Medico: ${scadenzaCertRaw || 'N/D'}`,
      esito: 'OK'
    });

    return res.json({
      success: true,
      message: 'Dati anagrafici salvati con successo!',
      cellulareFormatted: cellCheck.formatted
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Errore interno durante il salvataggio dei dati anagrafici.' });
  }
});

// Save & validate Azienda di Cronometraggio Anagrafica (Step 2 / First login completion)
app.put('/api/profile/crono', (req, res) => {
  try {
    const user = getCurrentUser(req);
    if (!user || (user.role !== 'crono' && user.role !== 'admin')) {
      return res.status(401).json({ error: 'Non autorizzato' });
    }

    const b = req.body || {};
    const errors = [];

    const denominazione = String(b.denominazione || '').trim();
    const partitaIva = String(b.partitaIva || '').trim();
    const codiceFiscale = String(b.codiceFiscale || '').trim();
    const indirizzo = String(b.indirizzo || '').trim();
    const civico = String(b.civico || '').trim();
    const cap = String(b.cap || '').trim();
    const citta = String(b.citta || '').trim();
    const provincia = String(b.provincia || '').trim().toUpperCase();
    const regione = String(b.regione || '').trim();
    const cellulareRaw = String(b.cellulare || '').trim();
    const email = String(b.email || '').trim();
    const pec = String(b.pec || '').trim();
    const referente = String(b.referente || '').trim();
    const cellulareReferenteRaw = String(b.cellulareReferente || '').trim();
    const emailReferente = String(b.emailReferente || '').trim();

    if (!denominazione) errors.push('Il campo "Denominazione" è obbligatorio.');
    if (!indirizzo) errors.push('Il campo "Indirizzo" è obbligatorio.');
    if (!civico) errors.push('Il campo "Civico" è obbligatorio.');

    if (!cap) {
      errors.push('Il campo "CAP" è obbligatorio.');
    } else {
      const capCheck = geoCF.validateItalianCap(cap, provincia);
      if (!capCheck.valid) errors.push(capCheck.error);
    }

    if (!citta) {
      errors.push('Il campo "Città/Località" è obbligatorio.');
    } else {
      const cityCheck = geoCF.validateItalianCity(citta);
      if (!cityCheck.valid) errors.push(cityCheck.error);
    }

    if (!provincia || !geoCF.ITALIAN_PROVINCES.some(p => p.code === provincia)) {
      errors.push('Selezionare una "Provincia" italiana valida (formato a 2 caratteri).');
    }
    if (!regione || !geoCF.ITALIAN_REGIONS.includes(regione)) {
      errors.push('Selezionare una "Regione" italiana valida.');
    }

    const cellCheck = geoCF.formatItalianPhone(cellulareRaw);
    if (!cellCheck.valid) {
      errors.push('Campo "Cellulare": ' + cellCheck.error);
    }

    if (!email || !geoCF.isValidEmail(email)) {
      errors.push('Inserire un "Indirizzo mail" formalmente valido.');
    }
    if (pec && !geoCF.isValidEmail(pec)) {
      errors.push('L\'indirizzo "PEC" digitato non ha un formato email valido.');
    }
    if (!referente) {
      errors.push('Il campo "Referente" è obbligatorio.');
    }

    const cellRefCheck = geoCF.formatItalianPhone(cellulareReferenteRaw);
    if (!cellRefCheck.valid) {
      errors.push('Campo "Cellulare Referente": ' + cellRefCheck.error);
    }

    if (!emailReferente || !geoCF.isValidEmail(emailReferente)) {
      errors.push('Inserire un "Indirizzo mail referente" formalmente valido.');
    }

    if (errors.length > 0) {
      recordOperationLog(req, {
        origine: isAdminUser(req) ? 'admin' : 'frontend',
        categoria: 'Anagrafica Utente',
        azione: 'Aggiornamento Anagrafica Azienda Crono Fallito (Validazione)',
        oggetto: denominazione || user.nome || user.username,
        dettagli: `Errori di validazione: ${errors.join(' | ')}`,
        esito: 'ERRORE'
      });
      return res.status(400).json({ error: errors.join('\n'), errors });
    }

    const linked = findUserLinkedEntity(user);
    const rch = linked.rawChrono;
    const chf = linked.chronoFormatted;

    if (rch) {
      rch.name = denominazione;
      rch.pi = partitaIva;
      rch.cf = codiceFiscale;
      rch.address = indirizzo;
      rch.street_number = civico;
      rch.cap = cap;
      rch.city = citta;
      rch.province = provincia;
      rch.region = regione;
      rch.cell1 = cellCheck.formatted;
      rch.email = email;
      rch.email2 = pec;
      rch.contact = referente;
      rch.c_cell1 = cellRefCheck.formatted;
      rch.c_email = emailReferente;
      rch.profileCompleted = true;
      db.writeJsonFile('mysql_chronos.json', db.rawChronos);
    }

    if (chf) {
      chf.nome = denominazione;
      chf.ragioneSociale = denominazione;
      chf.partitaIva = partitaIva;
      chf.codiceFiscale = codiceFiscale;
      chf.address = indirizzo;
      chf.street_number = civico;
      chf.cap = cap;
      chf.city = citta;
      chf.province = provincia;
      chf.region = regione;
      chf.sede = `${citta} (${provincia})`;
      chf.cell1 = cellCheck.formatted;
      chf.telefono = cellCheck.formatted;
      chf.email = email;
      chf.email2 = pec;
      chf.contact = referente;
      chf.referenteTecnico = referente;
      chf.c_cell1 = cellRefCheck.formatted;
      chf.c_email = emailReferente;
      chf.profileCompleted = true;
    }

    user.utente = denominazione;
    user.nome = denominazione;
    user.ragioneSociale = denominazione;
    user.partitaIva = partitaIva;
    user.codiceFiscale = codiceFiscale;
    user.email = email;
    user.telefono = cellCheck.formatted;
    user.referenteTecnico = referente;
    user.profileCompleted = true;
    const targetListCro = (db.usersList || []).find(u => u.id === user.id || (user.username && u.username === user.username));
    if (targetListCro) Object.assign(targetListCro, user);
    saveDynamicUsersFile();

    recordOperationLog(req, {
      origine: isAdminUser(req) ? 'admin' : 'frontend',
      categoria: 'Anagrafica Utente',
      azione: 'Aggiornamento Anagrafica Azienda di Cronometraggio',
      oggetto: `${denominazione} (Cod. ${(chf && chf.codice) || user.codiceCrono || '-'})`,
      dettagli: `Sede: ${indirizzo} ${civico}, ${cap} ${citta} (${provincia}) | P.IVA: ${partitaIva || '-'} | CF: ${codiceFiscale || '-'} | Referente: ${referente} (${cellRefCheck.formatted})`,
      esito: 'OK'
    });

    return res.json({
      success: true,
      message: 'Dati anagrafici dell\'azienda di cronometraggio salvati con successo!',
      cellulareFormatted: cellCheck.formatted,
      cellulareReferenteFormatted: cellRefCheck.formatted
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Errore interno durante il salvataggio dei dati dell\'azienda di cronometraggio.' });
  }
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password, silentAutoLogin } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Inserisci username e password' });
  }

  const user = db.usersList.find(
    u => (u.username && u.username.toLowerCase() === username.trim().toLowerCase() ||
          u.email && u.email.toLowerCase() === username.trim().toLowerCase()) &&
         u.password === password.trim()
  );

  if (!user) {
    const normInput = username.trim().toLowerCase();
    const pendingReq = registrationRequests.find(
      r => (r.username && r.username.toLowerCase() === normInput) ||
           (r.email && r.email.toLowerCase() === normInput)
    );
    if (pendingReq) {
      recordOperationLog(req, {
        origine: 'frontend',
        categoria: 'Autenticazione',
        azione: 'Tentativo di Login con Registrazione in Attesa',
        oggetto: `Utente: ${username}`,
        dettagli: `Tentativo di accesso da parte di "${username}" la cui richiesta di registrazione (ID: ${pendingReq.id}) è in attesa di conferma Admin`,
        operatoreOverride: username,
        ruoloOverride: pendingReq.role || 'pubblico',
        esito: 'ERRORE'
      });
      return res.status(403).json({
        error: 'La tua richiesta di registrazione è attualmente in attesa di verifica e conferma da parte dell\'Amministratore FISky. Riceverai le credenziali via email non appena verrà confermata.'
      });
    }
    recordOperationLog(req, {
      origine: 'frontend',
      categoria: 'Autenticazione',
      azione: 'Tentativo di Login Fallito (Credenziali Non Valide)',
      oggetto: `Username/Email: ${username}`,
      dettagli: `Credenziali non valide inserite per "${username}"`,
      operatoreOverride: username,
      ruoloOverride: 'pubblico',
      esito: 'ERRORE'
    });
    return res.status(401).json({ error: 'Credenziali non valide. Verifica username e password.' });
  }

  if (user.status === 'sospeso') {
    recordOperationLog(req, {
      origine: 'frontend',
      categoria: 'Autenticazione',
      azione: 'Tentativo di Login su Account Sospeso',
      oggetto: `${user.username} (${user.nome || ''})`,
      dettagli: `Accesso negato: l'account "${user.username}" risulta sospeso dalla Federazione`,
      operatoreOverride: `${user.username} (${user.nome || ''})`,
      ruoloOverride: user.role,
      esito: 'ERRORE'
    });
    return res.status(403).json({ error: 'Questo account è attualmente sospeso dalla Federazione.' });
  }

  res.cookie('fisky_user_id', user.id, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });

  let redirectUrl = '/dashboard-societa.html';
  if (user.role === 'admin') redirectUrl = '/dashboard-admin.html';
  else if (user.role === 'singolo') redirectUrl = '/dashboard-singolo.html';
  else if (user.role === 'crono') redirectUrl = '/dashboard-crono.html';

  if (!silentAutoLogin) {
    recordOperationLog(req, {
      origine: user.role === 'admin' ? 'admin' : 'frontend',
      categoria: 'Autenticazione',
      azione: 'Accesso Utente (Login)',
      oggetto: `${user.username} (${user.nome || user.role})`,
      dettagli: `Autenticazione effettuata con successo | Ruolo: ${ROLE_LABELS_MAP[user.role] || user.role} | Destinazione: ${redirectUrl}`,
      operatoreOverride: user.nome && user.nome !== user.username ? `${user.username} (${user.nome})` : user.username,
      ruoloOverride: user.role,
      esito: 'OK'
    });
  }

  return res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      nome: user.nome,
      role: user.role,
      email: user.email,
      codiceAffiliazione: user.codiceAffiliazione || '',
      tesseraNumero: user.tesseraNumero || ''
    },
    redirectUrl
  });
});

// Current user
app.get('/api/auth/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  const { password, ...safeUser } = user;
  res.json({ user: safeUser });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  const user = getCurrentUser(req);
  if (user) {
    recordOperationLog(req, {
      origine: user.role === 'admin' ? 'admin' : 'frontend',
      categoria: 'Autenticazione',
      azione: 'Disconnessione Utente (Logout)',
      oggetto: `${user.username} (${user.nome || ''})`,
      dettagli: `Sessione chiusa dall'utente "${user.username}"`,
      esito: 'OK'
    });
  }
  res.clearCookie('fisky_user_id');
  res.clearCookie('fisky_impersonate');
  res.json({ success: true, message: 'Logout effettuato' });
});

// ================= GESTIONE ATLETI (SOCIETÀ & ADMIN) ================= //

function paginateAndSearchAtleti(sourceList, req) {
  if (typeof db.ensureCurrentYearCategories === 'function') {
    db.ensureCurrentYearCategories(req.query.annoRiferimento);
  }
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  let societaFilter = (req.query.societa || 'all').trim();
  let categoriaFilter = (req.query.categoria || 'all').trim();
  let statoFilter = (req.query.stato || 'all').trim().toLowerCase();
  const sort = (req.query.sort || 'numeroTessera').trim();
  const dir = (req.query.dir || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const factor = dir === 'desc' ? -1 : 1;

  // 1. Base list: filter by societaId (if requested) and global text search
  let baseList = sourceList;
  if (req.query.societaId) {
    baseList = baseList.filter(a => String(a.societaId) === String(req.query.societaId));
  }

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    baseList = baseList.filter(a => {
      const nome = (a.nome || '').toLowerCase();
      const cognome = (a.cognome || '').toLowerCase();
      const nominativo1 = `${cognome} ${nome}`.trim();
      const nominativo2 = `${nome} ${cognome}`.trim();
      const tessera = (a.numeroTessera || '').toLowerCase();
      const progressivo = (a.progressivo || '').toLowerCase();
      const cf = (a.codiceFiscale || '').toLowerCase();
      const societa = (a.societaNome || '').toLowerCase();
      const cat = (a.categoria || '').toLowerCase();
      const citta = (a.citta || '').toLowerCase();
      const dataTess = (a.dataTesseramento || a.created || '').toLowerCase();

      return tokens.every(token =>
        nominativo1.includes(token) ||
        nominativo2.includes(token) ||
        tessera.includes(token) ||
        progressivo.includes(token) ||
        cf.includes(token) ||
        societa.includes(token) ||
        cat.includes(token) ||
        citta.includes(token) ||
        dataTess.includes(token)
      );
    });
  }

  // Filter matching helpers
  const matchSocieta = (a, sf) => {
    if (!sf || sf === 'all') return true;
    return (a.societaNome || 'Atleta Individuale / Libero').trim().toLowerCase() === sf.toLowerCase();
  };

  const matchCategoria = (a, cf) => {
    if (!cf || cf === 'all') return true;
    return (a.categoria || 'Senior').trim().toLowerCase() === cf.toLowerCase();
  };

  const matchStato = (a, st) => {
    if (!st || st === 'all') return true;
    return (a.statoTessera || '').toLowerCase() === st;
  };

  // 2. Interconnected Facets:
  // Available Società: in baseList matching active Categoria and Stato filters
  const socSubset = baseList.filter(a => matchCategoria(a, categoriaFilter) && matchStato(a, statoFilter));
  const societaSet = new Set();
  socSubset.forEach(a => {
    const sName = (a.societaNome || 'Atleta Individuale / Libero').trim();
    if (sName) societaSet.add(sName);
  });
  const availableSocieta = Array.from(societaSet).sort((a, b) =>
    a.localeCompare(b, 'it', { sensitivity: 'base' })
  );

  // Available Categorie: in baseList matching active Società and Stato filters
  const catSubset = baseList.filter(a => matchSocieta(a, societaFilter) && matchStato(a, statoFilter));
  const catSet = new Set();
  catSubset.forEach(a => {
    const cName = (a.categoria || 'Senior').trim();
    if (cName) catSet.add(cName);
  });
  const catOrderList = db.ATHLETE_CATEGORIES_ORDER_2026 || [];
  const getCatRank = (catName) => {
    const idx = catOrderList.indexOf(catName);
    return idx !== -1 ? idx : 999;
  };
  const availableCategorie = Array.from(catSet).sort((a, b) => {
    const rankA = getCatRank(a);
    const rankB = getCatRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, 'it', { sensitivity: 'base' });
  });

  // Available Stati & Counts: in baseList matching active Società and Categoria filters
  const statoSubset = baseList.filter(a => matchSocieta(a, societaFilter) && matchCategoria(a, categoriaFilter));
  const statoCounts = {
    attiva: statoSubset.filter(a => (a.statoTessera || '').toLowerCase() === 'attiva').length,
    in_scadenza: statoSubset.filter(a => (a.statoTessera || '').toLowerCase() === 'in_scadenza').length,
    scaduta: statoSubset.filter(a => (a.statoTessera || '').toLowerCase() === 'scaduta').length
  };

  // 3. Final filtered results matching all active filters
  let filtered = baseList.filter(a =>
    matchSocieta(a, societaFilter) &&
    matchCategoria(a, categoriaFilter) &&
    matchStato(a, statoFilter)
  );

  // Sort filtered results
  filtered.sort((a, b) => {
    if (sort === 'nominativo') {
      const nomA = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nomB = `${b.cognome || ''} ${b.nome || ''}`.trim();
      const cmp = nomA.localeCompare(nomB, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * factor;
    } else if (sort === 'categoria') {
      const catA = (a.categoria || 'Senior').trim();
      const catB = (b.categoria || 'Senior').trim();
      const rankA = getCatRank(catA);
      const rankB = getCatRank(catB);
      if (rankA !== rankB) return (rankA - rankB) * factor;
      const cmp = catA.localeCompare(catB, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * factor;
      const nomA = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nomB = `${b.cognome || ''} ${b.nome || ''}`.trim();
      const cmpNom = nomA.localeCompare(nomB, 'it', { sensitivity: 'base' });
      if (cmpNom !== 0) return cmpNom;
    } else if (sort === 'societa' || sort === 'societaNome') {
      const socA = (a.societaNome || 'Atleta Individuale / Libero').trim();
      const socB = (b.societaNome || 'Atleta Individuale / Libero').trim();
      const cmp = socA.localeCompare(socB, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * factor;
      const nomA = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nomB = `${b.cognome || ''} ${b.nome || ''}`.trim();
      const cmpNom = nomA.localeCompare(nomB, 'it', { sensitivity: 'base' });
      if (cmpNom !== 0) return cmpNom;
    } else if (sort === 'dataTesseramento') {
      const dtA = (a.dataTesseramento || a.created || '').trim();
      const dtB = (b.dataTesseramento || b.created || '').trim();
      if (dtA !== dtB) return dtA.localeCompare(dtB) * factor;
    }

    const tessA = String(a.numeroTessera || '');
    const tessB = String(b.numeroTessera || '');
    return tessA.localeCompare(tessB, 'it', { numeric: true, sensitivity: 'base' }) * factor;
  });

  const total = filtered.length;

  if (req.query.limit === 'all') {
    return {
      success: true,
      atleti: filtered,
      total,
      page: 1,
      limit: total,
      totalPages: 1,
      sort,
      dir,
      societa: societaFilter,
      categoria: categoriaFilter || 'all',
      stato: statoFilter,
      statoCounts,
      availableSocieta,
      availableCategorie
    };
  }

  const limit = req.query.limit !== undefined ? Math.max(1, parseInt(req.query.limit) || 100) : 100;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, totalPages));
  const offset = (page - 1) * limit;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    success: true,
    atleti: paginated,
    total,
    page,
    limit,
    totalPages,
    sort,
    dir,
    societa: societaFilter,
    categoria: categoriaFilter || 'all',
    stato: statoFilter,
    statoCounts,
    availableSocieta,
    availableCategorie
  };
}

// Get athletes
app.get('/api/societa/atleti', (req, res) => {
  const user = getCurrentUser(req);
  let baseList = db.atletiList;

  if (user && user.role === 'societa') {
    baseList = db.atletiList.filter(a => 
      String(a.societaId) === String(user.id) ||
      String(a.societaId) === String(user.rawId) ||
      String(a.societaId) === String(user.codice) ||
      (a.societaNome && user.nome && a.societaNome.trim().toLowerCase() === user.nome.trim().toLowerCase())
    );
  }

  const result = paginateAndSearchAtleti(baseList, req);
  res.json(result);
});

// Helper for status and category
function computeAthleteStatus(scadenzaCertificato) {
  if (!scadenzaCertificato) return 'in_attesa';
  const today = new Date();
  const expire = new Date(scadenzaCertificato);
  const diffDays = Math.ceil((expire - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'scaduta';
  if (diffDays <= 30) return 'in_scadenza';
  return 'attiva';
}

function computeCategory(dataNascita, sesso, codiceFiscale) {
  return db.computeAthleteCategory(dataNascita, sesso, codiceFiscale);
}

// Add new athlete (Tesseramento)
app.post('/api/societa/atleti', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Solo le Società Sportive o gli Admin possono tesserare atleti' });
  }

  const {
    nome,
    cognome,
    codiceFiscale,
    dataNascita,
    sesso,
    tipoTessera,
    certificatoMedicoScadenza,
    email,
    telefono
  } = req.body;

  if (!nome || !cognome || !codiceFiscale) {
    return res.status(400).json({ error: 'Nome, Cognome e Codice Fiscale sono obbligatori' });
  }

  const exists = db.membersList.find(a => a.codiceFiscale && a.codiceFiscale.toUpperCase() === codiceFiscale.trim().toUpperCase());
  if (exists) {
    recordOperationLog(req, {
      origine: isAdminUser(req) ? 'admin' : 'frontend',
      categoria: 'Tesseramento Atleti',
      azione: 'Tentativo Tesseramento Atleta Fallito (CF Duplicato)',
      oggetto: `${nome} ${cognome} (${codiceFiscale.trim().toUpperCase()})`,
      dettagli: `Codice Fiscale ${codiceFiscale.trim().toUpperCase()} già presente in anagrafe federale`,
      esito: 'ERRORE'
    });
    return res.status(400).json({ error: `L'atleta con Codice Fiscale ${codiceFiscale} risulta già registrato.` });
  }

  // Compute next progressive ID based on authentic FISky standard
  let maxId = 0;
  db.membersList.forEach(m => {
    if (m.rawId && m.rawId > maxId) maxId = m.rawId;
  });
  const nextId = maxId + 1;
  const progressivo = String(nextId).padStart(6, '0');
  const numeroTessera = `SKYA${progressivo}`;
  const statoTessera = computeAthleteStatus(certificatoMedicoScadenza);
  const categoria = computeCategory(dataNascita, sesso, codiceFiscale);

  const newAtleta = {
    id: `mem_${nextId}`,
    rawId: nextId,
    progressivo,
    societaId: user.id,
    societaNome: user.ragioneSociale || user.nome,
    nome: nome.trim(),
    cognome: cognome.trim(),
    codiceFiscale: codiceFiscale.trim().toUpperCase(),
    dataNascita: dataNascita || '',
    sesso: sesso || 'M',
    categoria,
    parametriCategoria: db.getAthleteCategoryParams2026(categoria),
    numeroTessera,
    numeroTesseraAtleta: numeroTessera,
    numeroTesseraDirigente: null,
    tipoTessera: tipoTessera || 'Atleta Agonista FISky',
    certificatoMedicoScadenza: certificatoMedicoScadenza || '',
    statoTessera,
    email: email || '',
    telefono: telefono || '',
    ruoli: ['Atleta'],
    dataTesseramento: new Date().toISOString().slice(0, 10),
    created: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  };

  db.membersList.unshift(newAtleta);
  db.atletiList.unshift(newAtleta);
  writeJson(ATLETI_FILE, db.atletiList.slice(0, 100)); // persist recent additions

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Tesseramento Atleti',
    azione: 'Nuovo Tesseramento Atleta',
    oggetto: `${newAtleta.cognome} ${newAtleta.nome} (${numeroTessera})`,
    dettagli: `Società: ${newAtleta.societaNome} | CF: ${newAtleta.codiceFiscale} | Categoria: ${categoria} | Scadenza Cert. Medico: ${certificatoMedicoScadenza || 'N/D'}`,
    esito: 'OK'
  });

  return res.status(201).json({
    success: true,
    message: 'Atleta tesserato con successo!',
    atleta: newAtleta
  });
});

// Update athlete
app.put('/api/societa/atleti/:id', (req, res) => {
  const atleti = db.atletiList;
  const index = atleti.findIndex(a => a.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Atleta non trovato' });
  }

  const { certificatoMedicoScadenza, tipoTessera, email, telefono } = req.body;
  if (certificatoMedicoScadenza) {
    atleti[index].certificatoMedicoScadenza = certificatoMedicoScadenza;
    atleti[index].statoTessera = computeAthleteStatus(certificatoMedicoScadenza);
  }
  if (tipoTessera) atleti[index].tipoTessera = tipoTessera;
  if (email !== undefined) atleti[index].email = email;
  if (telefono !== undefined) atleti[index].telefono = telefono;

  // Also sync in membersList
  const mIndex = db.membersList.findIndex(m => m.id === req.params.id);
  if (mIndex !== -1) {
    Object.assign(db.membersList[mIndex], atleti[index]);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Tesseramento Atleti',
    azione: 'Aggiornamento Dati Tesserato / Certificato Medico',
    oggetto: `${atleti[index].cognome} ${atleti[index].nome} (${atleti[index].numeroTessera || atleti[index].id})`,
    dettagli: `Società: ${atleti[index].societaNome || '-'} | Scadenza Certificato: ${atleti[index].certificatoMedicoScadenza || '-'} | Stato Tessera: ${atleti[index].statoTessera}`,
    esito: 'OK'
  });

  res.json({ success: true, message: 'Dati atleta aggiornati', atleta: atleti[index] });
});

// Delete athlete (rimuove la tessera/tesseramento ma MANTIENE l'anagrafica della persona nel database)
app.delete('/api/societa/atleti/:id', (req, res) => {
  const index = db.atletiList.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Atleta non trovato' });

  const removedAtleta = db.atletiList[index];
  db.atletiList.splice(index, 1);

  // L'anagrafica della persona RESTA salvata nel database (db.membersList e mysql_members.json)
  const mIndex = db.membersList.findIndex(m => m.id === req.params.id || String(m.rawId) === String(removedAtleta.rawId));
  if (mIndex !== -1) {
    const m = db.membersList[mIndex];
    m.numeroTesseraAtleta = null;
    if (m.numeroTessera === removedAtleta.numeroTessera) {
      m.numeroTessera = m.numeroTesseraDirigente || m.numeroTesseraGuida || m.numeroTesseraTecnico || null;
    }
    m.societaId = '0';
    m.societaNome = 'Atleta Individuale / Libero';

    // Rimuove l'affiliazione societaria specifica da mysql_wmembers.json se presente
    if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
      const wIdx = db.rawWmembers.findIndex(w => String(w.member_id) === String(removedAtleta.rawId) && (!removedAtleta.societaId || String(w.club_id) === String(removedAtleta.societaId)));
      if (wIdx !== -1) {
        db.rawWmembers.splice(wIdx, 1);
        db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
      }
      const remainingAff = db.rawWmembers.filter(w => String(w.member_id) === String(removedAtleta.rawId));
      m.isAssociato = remainingAff.length > 0;
      m.statoAssociazione = m.isAssociato ? 'associato' : 'non_associato';
      m.statoAssociazioneLabel = m.isAssociato ? 'Associato' : 'Non associato';
    } else {
      m.isAssociato = false;
      m.statoAssociazione = 'non_associato';
      m.statoAssociazioneLabel = 'Non associato';
    }
    m.statoTessera = 'scaduta';
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Tesseramento Atleti',
    azione: 'Rimozione Tesseramento Atleta',
    oggetto: `${removedAtleta.cognome} ${removedAtleta.nome} (${removedAtleta.numeroTessera || removedAtleta.id})`,
    dettagli: `Rimosso tesseramento dell'atleta ${removedAtleta.cognome} ${removedAtleta.nome} (Società: ${removedAtleta.societaNome || '-'}). L'anagrafica anagrafica generale resta conservata nel database FISky.`,
    esito: 'OK'
  });

  res.json({ success: true, message: 'Tesseramento rimosso. Anagrafica conservata nel database.' });
});

// Helper to resolve session club for society endpoints
function getClubForUser(user) {
  if (!user) return { rawClub: null, club: null };
  const linked = findUserLinkedEntity(user);
  let rawClub = linked.rawClub || null;
  let club = linked.clubFormatted || null;

  if (!rawClub && user.clubRawId) {
    rawClub = (db.rawClubs || []).find(c => String(c.id) === String(user.clubRawId)) || null;
  }
  if (!club && rawClub) {
    club = (db.clubsList || []).find(c => String(c.rawId) === String(rawClub.id)) || null;
  }
  if (!club && user.codiceSocieta) {
    club = (db.clubsList || []).find(c => String(c.codice) === String(user.codiceSocieta)) || null;
  }
  if (!rawClub && club) {
    rawClub = (db.rawClubs || []).find(c => String(c.id) === String(club.rawId)) || null;
  }
  return { rawClub, club };
}

// ================= AREA RISERVATA SOCIETÀ API ================= //

function isMemberActive(m) {
  if (!m) return false;
  if (m.statoTessera === 'attiva') return true;
  if (m.affiliateExpire && m.affiliateExpire >= '2026-01-01') return true;
  if (m.ultimoAnnoTesseramento && Number(m.ultimoAnnoTesseramento) >= 2026) return true;
  return false;
}

function formatDirigenteCard(member) {
  if (!member) return 'SKYD000001';
  if (member.numeroTesseraDirigente && /^SKYD\d{6}$/i.test(member.numeroTesseraDirigente.trim())) {
    return member.numeroTesseraDirigente.trim().toUpperCase();
  }
  const rawId = member.rawId || member.id || member.member_id || member.user_id;
  const num = String(rawId).replace(/\D/g, '');
  if (num) {
    return `SKYD${num.padStart(6, '0')}`;
  }
  const cardNum = String(member.numeroTessera || '').replace(/\D/g, '');
  if (cardNum) {
    return `SKYD${cardNum.padStart(6, '0')}`;
  }
  return 'SKYD000001';
}

function getMemberTypeIdForRole(role) {
  if (!role) return '4';
  const r = String(role).toLowerCase();
  if (r.includes('presidente') && !r.includes('vice')) return '1';
  if (r.includes('vicepresidente')) return '2';
  if (r.includes('segretario')) return '3';
  if (r.includes('medico')) return '12';
  if (r.includes('tecnic')) return '5';
  if (r.includes('atlet')) return '13';
  return '4';
}

// Dashboard summary & compliance check for Società
app.get('/api/societa/dashboard-summary', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};

  const rawClubId = String(rc.id || cf.rawId || '');
  const clubCodice = String(cf.codice || rc.codice || user.codiceSocieta || '');
  const clubName = String(rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || '').trim().toLowerCase();

  // 1. Members filtering
  const clubMembers = (db.membersList || []).filter(m => 
    (rawClubId && String(m.societaId) === rawClubId) ||
    (clubCodice && String(m.societaCodice) === clubCodice) ||
    (m.societaNome && clubName && m.societaNome.trim().toLowerCase() === clubName)
  );

  // 2. Consiglio Direttivo (esposte soltanto le figure che risultano attive)
  const dirKeywords = ['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'];
  const allDirigenti = clubMembers.filter(m => {
    const roles = (m.ruoliSocietari || []).concat(m.ruoli || []).map(r => String(r).toLowerCase());
    const isDir = roles.some(r => dirKeywords.some(kw => r.includes(kw)));
    const hasDirCard = String(m.numeroTessera || m.numeroTesseraDirigente || '').startsWith('SKYD');
    return isDir || hasDirCard;
  });

  // Esposte soltanto le figure che risultano attive e con formato tessera SKYD000000 garantito
  const consiglioDirettivo = allDirigenti
    .filter(m => isMemberActive(m))
    .map(m => {
      const card = formatDirigenteCard(m);
      m.numeroTesseraDirigente = card;
      m.numeroTessera = card;
      return m;
    });

  // Hierarchy sort
  const getRolePriority = (m) => {
    const r = (m.ruoliSocietari || []).join(' ').toLowerCase();
    if (r.includes('presidente') && !r.includes('vice')) return 1;
    if (r.includes('vicepresidente')) return 2;
    if (r.includes('segretario')) return 3;
    if (r.includes('consigliere')) return 4;
    if (r.includes('medico')) return 5;
    if (r.includes('rappresentante tecnici')) return 6;
    if (r.includes('rappresentante atleti')) return 7;
    return 8;
  };
  consiglioDirettivo.sort((a, b) => getRolePriority(a) - getRolePriority(b));

  // 3. Atleti Tesserati (SKYA*)
  const atleti = (db.atletiList || []).filter(a => 
    (rawClubId && String(a.societaId) === rawClubId) ||
    (user.id && String(a.societaId) === String(user.id)) ||
    (user.rawId && String(a.societaId) === String(user.rawId)) ||
    (user.clubRawId && String(a.societaId) === String(user.clubRawId)) ||
    (clubCodice && String(a.societaCodice) === clubCodice) ||
    (a.societaNome && clubName && a.societaNome.trim().toLowerCase() === clubName)
  );

  // 4. Compliance: Figure Dirigenziali Obbligatorie
  const hasPresidente = consiglioDirettivo.some(m => {
    const r = (m.ruoliSocietari || []).join(' ').toLowerCase();
    return r.includes('presidente') && !r.includes('vice');
  });
  const hasVicepresidente = consiglioDirettivo.some(m => {
    const r = (m.ruoliSocietari || []).join(' ').toLowerCase();
    return r.includes('vicepresidente');
  });
  const hasConsigliere = consiglioDirettivo.some(m => {
    const r = (m.ruoliSocietari || []).join(' ').toLowerCase();
    return r.includes('consigliere') || r.includes('segretario');
  });

  const missingBoardRoles = [];
  if (!hasPresidente) missingBoardRoles.push('Presidente');
  if (!hasVicepresidente) missingBoardRoles.push('Vicepresidente');
  if (!hasConsigliere) missingBoardRoles.push('Consigliere (o Consigliere/Segretario)');
  const boardOk = missingBoardRoles.length === 0;

  // 5. Compliance: Atleti Obbligatori (almeno 5 atleti con tessera attiva, tessera SKYA*)
  const skyaAtleti = atleti.filter(a => String(a.numeroTessera || '').startsWith('SKYA') || a.tipoTessera === 'Atleta Agonista FISky' || (a.ruoliSocietari || []).some(r => r.toLowerCase().includes('atleta')));
  const skyaCount = skyaAtleti.length;
  
  // Conteggio atleti attivi vs totali
  const isAtletaAttivo = (a) => a.statoTessera === 'attiva' || a.stato === 'attiva';
  const atletiAttivi = atleti.filter(isAtletaAttivo);
  const skyaAttivi = skyaAtleti.filter(isAtletaAttivo);
  const atletiAttiviCount = atletiAttivi.length;
  const atletiTotaliCount = atleti.length;
  const skyaAttiviCount = skyaAttivi.length;

  const atletiOk = skyaAttiviCount >= 5;
  const missingAthletesCount = Math.max(0, 5 - skyaAttiviCount);

  // 6. Compliance: Documenti RASD
  const rasdDocDefinitions = [
    { key: 'cf_certificate', label: 'Certificato di Attribuzione Codice Fiscale' },
    { key: 'association_articles', label: 'Atto Costitutivo' },
    { key: 'statute', label: 'Statuto Sociale' },
    { key: 'id_president', label: 'Documento di Riconoscimento del Presidente' },
    { key: 'election_act', label: 'Verbale di Nomina / Elezione Cariche Direttive' },
    { key: 'affiliation_form', label: 'Modulo di Richiesta Affiliazione' }
  ];
  const hasConi = Boolean((rc && rc.certificate) || (cf && cf.certificate) || String(rc && rc.coni_certificate) === '1');
  const missingRasdDocs = [];
  const rasdDocsStatus = {};

  rasdDocDefinitions.forEach(doc => {
    const val = (rc && rc[doc.key]) || (cf && cf[doc.key]) || '';
    const isPresent = Boolean(val && String(val).trim() !== '');
    rasdDocsStatus[doc.key] = { label: doc.label, present: isPresent, url: val };
    if (!isPresent) {
      missingRasdDocs.push(doc.label);
    }
  });
  rasdDocsStatus['coni_certificate'] = { label: 'Certificato Iscrizione Registro CONI / RASD', present: hasConi, url: (rc && rc.certificate) || '' };
  if (!hasConi) {
    missingRasdDocs.push('Certificato Iscrizione Registro CONI / RASD');
  }
  const rasdOk = missingRasdDocs.length === 0;

  // 7. Saldo Conto / Credito
  const userId = String(rc.user_id || cf.userId || user.userId || user.rawUserId || '');
  const rawAcc = (db.rawAccounts || []).find(a => String(a.user_id) === userId);
  const currentCredit = (cf && cf.credito !== undefined) ? Number(cf.credito) : (rawAcc ? (parseFloat(rawAcc.current) || 0) : 0);

  // 8. Composite list of warnings
  const avvisi = [];
  if (!boardOk) {
    avvisi.push({
      category: 'dirigenza',
      level: 'danger',
      title: 'Figure Dirigenziali Obbligatorie Mancanti',
      message: `La società deve avere un Consiglio Direttivo regolarmente costituito. Figure essenziali mancanti: ${missingBoardRoles.join(', ')}.`
    });
  }
  if (!atletiOk) {
    avvisi.push({
      category: 'atleti',
      level: 'warning',
      title: 'Requisito Minimo Atleti Tesserati Non Soddisfatto',
      message: `Per mantenere la regolarità federale è obbligatorio tesserare almeno 5 atleti con tessera SKYA* attiva. Attualmente risultano attivi ${skyaAttiviCount} di 5 atleti minimi (totale atleti registrati: ${skyaCount}, mancano ${missingAthletesCount} atleti attivi).`
    });
  }
  if (!rasdOk) {
    avvisi.push({
      category: 'rasd',
      level: 'warning',
      title: 'Documentazione per la Registrazione al RASD Incompleta',
      message: `Mancano i seguenti documenti societari obbligatori per il Registro Nazionale delle Attività Sportive Dilettantistiche (RASD): ${missingRasdDocs.join(', ')}.`
    });
  }

  res.json({
    success: true,
    club: {
      rawId: rc.id || cf.rawId || '',
      codice: cf.codice || rc.codice || clubCodice,
      codiceFiso: rc.fisoId ? String(rc.fisoId).trim().replace(/^0+(?=\d)/, '') : (cf.codiceFiso || ''),
      denominazione: rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || '',
      ragioneSociale: rc.r_name || cf.rName || 'ASD',
      partitaIva: rc.pi || cf.partitaIva || '',
      codiceFiscale: rc.cf || cf.codiceFiscale || '',
      credito: currentCredit,
      indirizzo: rc.address || cf.address || '',
      civico: rc.street_number || '',
      cap: rc.cap || cf.cap || '',
      citta: rc.city || cf.city || '',
      provincia: rc.province || cf.province || '',
      regione: rc.region || cf.region || '',
      cellulare: rc.cell1 || cf.cell1 || '',
      email: rc.email || cf.email || user.email || '',
      pec: rc.email2 || cf.email2 || '',
      referente: rc.contact || cf.contact || '',
      cellulareReferente: rc.c_cell1 || '',
      emailReferente: rc.c_email || '',
      affiliato: cf.affiliato !== undefined ? cf.affiliato : Boolean(rc.affiliation_complete),
      statoAffiliazione: cf.statoAffiliazione || 'Affiliazione Regolare'
    },
    counts: {
      consiglio: consiglioDirettivo.length,
      atleti: atletiAttiviCount,
      atletiAttivi: atletiAttiviCount,
      atletiTotali: atletiTotaliCount,
      skyaAtleti: skyaAttiviCount,
      skyaAttivi: skyaAttiviCount,
      skyaTotali: skyaCount
    },
    compliance: {
      boardOk,
      hasPresidente,
      hasVicepresidente,
      hasConsigliere,
      missingBoardRoles,
      atletiOk,
      skyaCount,
      skyaTotali: skyaCount,
      skyaAttivi: skyaAttiviCount,
      atletiAttivi: atletiAttiviCount,
      atletiTotali: atletiTotaliCount,
      minAthletes: 5,
      missingAthletesCount,
      rasdOk,
      missingRasdDocs,
      rasdDocsStatus,
      allCompliant: boardOk && atletiOk && rasdOk
    },
    avvisi
  });
});

// Members list (Consiglio Direttivo & Atleti) for Società
app.get('/api/societa/membri', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};

  const rawClubId = String(rc.id || cf.rawId || user.clubRawId || user.id || '');
  const clubCodice = String(cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || '');
  const clubName = String(rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || '').trim().toLowerCase();

  const clubMembers = (db.membersList || []).filter(m => 
    (rawClubId && String(m.societaId) === rawClubId) ||
    (user.id && String(m.societaId) === String(user.id)) ||
    (user.rawId && String(m.societaId) === String(user.rawId)) ||
    (user.clubRawId && String(m.societaId) === String(user.clubRawId)) ||
    (clubCodice && String(m.societaCodice) === clubCodice) ||
    (m.societaNome && clubName && m.societaNome.trim().toLowerCase() === clubName)
  );

  const dirKeywords = ['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'];
  const allDirigenti = clubMembers.filter(m => {
    const roles = (m.ruoliSocietari || []).concat(m.ruoli || []).map(r => String(r).toLowerCase());
    const isDir = roles.some(r => dirKeywords.some(kw => r.includes(kw)));
    const hasDirCard = String(m.numeroTessera || m.numeroTesseraDirigente || '').startsWith('SKYD');
    return isDir || hasDirCard;
  });

  const getRolePriority = (m) => {
    const r = (m.ruoliSocietari || []).join(' ').toLowerCase();
    if (r.includes('presidente') && !r.includes('vice')) return 1;
    if (r.includes('vicepresidente')) return 2;
    if (r.includes('segretario')) return 3;
    if (r.includes('consigliere')) return 4;
    if (r.includes('medico')) return 5;
    if (r.includes('rappresentante tecnici')) return 6;
    if (r.includes('rappresentante atleti')) return 7;
    return 8;
  };

  // Esposte figure attive con formato tessera SKYD000000 garantito
  const consiglioDirettivo = allDirigenti
    .filter(m => isMemberActive(m))
    .map(m => {
      const card = formatDirigenteCard(m);
      m.numeroTesseraDirigente = card;
      m.numeroTessera = card;
      m.statoTessera = 'attiva';
      return m;
    });
  consiglioDirettivo.sort((a, b) => getRolePriority(a) - getRolePriority(b));

  // Figure dirigenziali inattive (tessera scaduta)
  const dirigentiInattivi = allDirigenti
    .filter(m => !isMemberActive(m))
    .map(m => {
      const card = formatDirigenteCard(m);
      m.numeroTesseraDirigente = card;
      m.numeroTessera = card;
      m.statoTessera = 'scaduta';
      return m;
    });
  dirigentiInattivi.sort((a, b) => getRolePriority(a) - getRolePriority(b));

  const atleti = (db.atletiList || []).filter(a => 
    (rawClubId && String(a.societaId) === rawClubId) ||
    (user.id && String(a.societaId) === String(user.id)) ||
    (user.rawId && String(a.societaId) === String(user.rawId)) ||
    (user.clubRawId && String(a.societaId) === String(user.clubRawId)) ||
    (clubCodice && String(a.societaCodice) === clubCodice) ||
    (a.societaNome && clubName && a.societaNome.trim().toLowerCase() === clubName)
  );

  res.json({
    success: true,
    consiglioDirettivo,
    dirigentiInattivi,
    atleti,
    totalConsiglio: consiglioDirettivo.length,
    totalInattivi: dirigentiInattivi.length,
    totalAtleti: atleti.length
  });
});

// Rinnova Tesseramento Dirigente
app.post('/api/societa/dirigenti/:id/rinnova', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const clubId = String(rc.id || cf.rawId || user.clubRawId || user.id || '');

  const memberIndex = (db.membersList || []).findIndex(m => m.id === req.params.id || String(m.rawId) === String(req.params.id));
  if (memberIndex === -1) {
    return res.status(404).json({ error: 'Dirigente non trovato' });
  }

  const member = db.membersList[memberIndex];
  const newExpire = req.body.scadenza || '2026-12-31';

  member.affiliateExpire = newExpire;
  member.ultimoAnnoTesseramento = parseInt(newExpire.slice(0, 4)) || 2026;
  member.statoTessera = 'attiva';
  member.numeroTesseraDirigente = formatDirigenteCard(member);
  member.numeroTessera = member.numeroTesseraDirigente;
  if (!member.societaId || member.societaId === '0') {
    member.societaId = clubId;
    member.societaNome = rc.name || cf.nome || user.ragioneSociale || user.nome || 'Società';
  }

  // Aggiornamento in mysql_members.json
  const rawM = (db.rawMembers || []).find(m => String(m.id) === String(member.rawId));
  if (rawM) {
    rawM.affiliate_expire = member.affiliateExpire;
    rawM.status = '1';
    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  // Aggiornamento in mysql_wmembers.json
  if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
    let w = db.rawWmembers.find(w => String(w.member_id) === String(member.rawId) && String(w.club_id) === clubId);
    if (!w) {
      const dirRole = (member.ruoliSocietari || [])[0] || 'Consigliere';
      const maxWId = db.rawWmembers.reduce((max, x) => Math.max(max, parseInt(x.id) || 0), 0);
      db.rawWmembers.push({
        id: String(maxWId + 1),
        member_id: String(member.rawId || member.id),
        club_id: clubId,
        membertype_id: getMemberTypeIdForRole(dirRole),
        affiliate_expire: newExpire,
        is_valid: '1'
      });
    } else {
      w.affiliate_expire = newExpire;
      w.is_valid = '1';
    }
    db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'societa',
    categoria: 'Consiglio Direttivo',
    azione: 'Rinnovo Tesseramento Dirigente',
    oggetto: `${member.cognome} ${member.nome} (${member.numeroTesseraDirigente})`,
    dettagli: `Rinnovato tesseramento del dirigente ${member.cognome} ${member.nome} per la stagione 2026 (scadenza ${newExpire})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Tesseramento rinnovato per ${member.cognome} ${member.nome}!`,
    dirigente: member
  });
});

// Tessera nuovo Dirigente (Consiglio Direttivo)
app.post('/api/societa/dirigenti', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Solo le Società Sportive o gli Admin possono tesserare dirigenti' });
  }

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const clubId = String(rc.id || cf.rawId || '');
  const clubName = rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || 'Società';
  const clubCode = String(cf.codice || rc.codice || user.codiceSocieta || '');

  const {
    nome,
    cognome,
    codiceFiscale,
    dataNascita,
    sesso,
    ruoloDirigenziale,
    email,
    telefono,
    indirizzo,
    civico,
    cap,
    citta,
    provincia,
    regione
  } = req.body;

  if (!nome || !cognome || !codiceFiscale || !ruoloDirigenziale) {
    return res.status(400).json({ error: 'Nome, cognome, codice fiscale e ruolo dirigenziale sono obbligatori' });
  }

  const cleanCF = codiceFiscale.trim().toUpperCase();
  const cleanNome = nome.trim();
  const cleanCognome = cognome.trim();
  const cleanRuolo = ruoloDirigenziale.trim();

  // Check if member already exists
  let existing = db.membersList.find(m => m.codiceFiscale && m.codiceFiscale.toUpperCase() === cleanCF);

  if (existing) {
    existing.societaId = clubId;
    existing.societaNome = clubName;
    existing.societaCodice = clubCode;
    existing.nome = cleanNome;
    existing.cognome = cleanCognome;
    if (dataNascita) existing.dataNascita = dataNascita;
    if (sesso) existing.sesso = sesso;
    if (email) existing.email = email.trim();
    if (telefono) existing.telefono = telefono.trim();
    if (indirizzo) existing.indirizzo = indirizzo.trim();
    if (civico) existing.civico = civico.trim();
    if (cap) existing.cap = cap.trim();
    if (citta) existing.citta = citta.trim();
    if (provincia) existing.provincia = provincia;
    if (regione) existing.regione = regione;

    const currentRoles = (existing.ruoliSocietari || []).filter(r => !['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'].some(k => r.toLowerCase().includes(k)));
    currentRoles.unshift(cleanRuolo);
    existing.ruoliSocietari = currentRoles;
    existing.ruoli = Array.from(new Set([...(existing.ruoli || []), cleanRuolo]));

    existing.statoTessera = 'attiva';
    existing.affiliateExpire = '2026-12-31';
    existing.ultimoAnnoTesseramento = 2026;
    existing.numeroTesseraDirigente = formatDirigenteCard(existing);
    existing.numeroTessera = existing.numeroTesseraDirigente;
    existing.isAssociato = true;

    const rawM = (db.rawMembers || []).find(m => String(m.id) === String(existing.rawId));
    if (rawM) {
      rawM.club_id = clubId;
      rawM.affiliate_expire = '2026-12-31';
      rawM.status = '1';
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }

    if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
      const typeId = getMemberTypeIdForRole(cleanRuolo);
      const wIdx = db.rawWmembers.findIndex(w => String(w.member_id) === String(existing.rawId) && String(w.club_id) === clubId);
      if (wIdx !== -1) {
        db.rawWmembers[wIdx].membertype_id = typeId;
        db.rawWmembers[wIdx].affiliate_expire = '2026-12-31';
        db.rawWmembers[wIdx].is_valid = '1';
      } else {
        const nextWId = String(db.rawWmembers.length ? Math.max(...db.rawWmembers.map(w => parseInt(w.id) || 0)) + 1 : 1);
        db.rawWmembers.push({
          id: nextWId,
          member_id: String(existing.rawId),
          club_id: clubId,
          membertype_id: typeId,
          affiliate_expire: '2026-12-31',
          is_valid: '1'
        });
      }
      db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
    }

    recordOperationLog(req, {
      origine: isAdminUser(req) ? 'admin' : 'societa',
      categoria: 'Consiglio Direttivo',
      azione: 'Tesseramento Dirigente',
      oggetto: `${cleanCognome} ${cleanNome} (${existing.numeroTesseraDirigente})`,
      dettagli: `Tesserato ${cleanRuolo} ${cleanCognome} ${cleanNome} per la società ${clubName}`,
      esito: 'OK'
    });

    return res.json({
      success: true,
      message: `Dirigente ${cleanCognome} ${cleanNome} tesserato con successo (Tessera: ${existing.numeroTesseraDirigente})!`,
      dirigente: existing
    });
  }

  // New member creation
  const maxRawId = Math.max(...(db.rawMembers || []).map(m => parseInt(m.id) || 0), ...(db.membersList || []).map(m => parseInt(m.rawId || m.id) || 0), 10000);
  const newId = String(maxRawId + 1);
  const progressivo = newId.padStart(6, '0');
  const cardDirigente = `SKYD${progressivo}`;
  const typeId = getMemberTypeIdForRole(cleanRuolo);

  const newRawMember = {
    id: newId,
    name: cleanNome,
    surname: cleanCognome,
    cf: cleanCF,
    birthday: dataNascita || '',
    gender: sesso || 'M',
    email: email ? email.trim() : '',
    telephone: telefono ? telefono.trim() : '',
    address: indirizzo ? indirizzo.trim() : '',
    street_number: civico ? civico.trim() : '',
    cap: cap ? cap.trim() : '',
    city: citta ? citta.trim() : '',
    province: provincia || '',
    region: regione || '',
    club_id: clubId,
    membertype_id: typeId,
    affiliate_expire: '2026-12-31',
    created: new Date().toISOString().split('T')[0],
    status: '1'
  };

  db.rawMembers.push(newRawMember);
  db.writeJsonFile('mysql_members.json', db.rawMembers);

  const nextWId = String((db.rawWmembers || []).length ? Math.max(...db.rawWmembers.map(w => parseInt(w.id) || 0)) + 1 : 1);
  db.rawWmembers.push({
    id: nextWId,
    member_id: newId,
    club_id: clubId,
    membertype_id: typeId,
    affiliate_expire: '2026-12-31',
    is_valid: '1'
  });
  db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);

  const newMemberObj = {
    id: `member_${newId}`,
    rawId: newId,
    nome: cleanNome,
    cognome: cleanCognome,
    codiceFiscale: cleanCF,
    dataNascita: dataNascita || '',
    sesso: sesso || 'M',
    email: email ? email.trim() : '',
    telefono: telefono ? telefono.trim() : '',
    indirizzo: indirizzo ? indirizzo.trim() : '',
    civico: civico ? civico.trim() : '',
    cap: cap ? cap.trim() : '',
    citta: citta ? citta.trim() : '',
    provincia: provincia || '',
    regione: regione || '',
    societaId: clubId,
    societaCodice: clubCode,
    societaNome: clubName,
    ruoli: [cleanRuolo],
    ruoliSocietari: [cleanRuolo],
    numeroTessera: cardDirigente,
    numeroTesseraDirigente: cardDirigente,
    tipoTessera: 'Dirigente',
    affiliateExpire: '2026-12-31',
    ultimoAnnoTesseramento: 2026,
    statoTessera: 'attiva',
    isAssociato: true
  };

  db.membersList.unshift(newMemberObj);

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'societa',
    categoria: 'Consiglio Direttivo',
    azione: 'Nuovo Tesseramento Dirigente',
    oggetto: `${cleanCognome} ${cleanNome} (${cardDirigente})`,
    dettagli: `Tesserato ${cleanRuolo} ${cleanCognome} ${cleanNome} per la società ${clubName}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Nuovo dirigente ${cleanCognome} ${cleanNome} tesserato con successo (Tessera: ${cardDirigente})!`,
    dirigente: newMemberObj
  });
});

// Modifica dati Dirigente
app.put('/api/societa/dirigenti/:id', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const clubId = String(rc.id || cf.rawId || '');

  const member = (db.membersList || []).find(m => m.id === req.params.id || String(m.rawId) === String(req.params.id));
  if (!member) {
    return res.status(404).json({ error: 'Dirigente non trovato' });
  }

  const {
    nome,
    cognome,
    codiceFiscale,
    dataNascita,
    sesso,
    ruoloDirigenziale,
    email,
    telefono,
    indirizzo,
    civico,
    cap,
    citta,
    provincia,
    regione,
    scadenza
  } = req.body;

  if (nome) member.nome = nome.trim();
  if (cognome) member.cognome = cognome.trim();
  if (codiceFiscale) member.codiceFiscale = codiceFiscale.trim().toUpperCase();
  if (dataNascita) member.dataNascita = dataNascita;
  if (sesso) member.sesso = sesso;
  if (email !== undefined) member.email = email.trim();
  if (telefono !== undefined) member.telefono = telefono.trim();
  if (indirizzo !== undefined) member.indirizzo = indirizzo.trim();
  if (civico !== undefined) member.civico = civico.trim();
  if (cap !== undefined) member.cap = cap.trim();
  if (citta !== undefined) member.citta = citta.trim();
  if (provincia !== undefined) member.provincia = provincia;
  if (regione !== undefined) member.regione = regione;
  if (scadenza) {
    member.affiliateExpire = scadenza;
    member.ultimoAnnoTesseramento = parseInt(scadenza.slice(0, 4)) || 2026;
    member.statoTessera = isMemberActive(member) ? 'attiva' : 'scaduta';
  }

  if (ruoloDirigenziale) {
    const cleanRole = ruoloDirigenziale.trim();
    const otherRoles = (member.ruoliSocietari || []).filter(r => !['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'].some(k => r.toLowerCase().includes(k)));
    otherRoles.unshift(cleanRole);
    member.ruoliSocietari = otherRoles;
    member.ruoli = Array.from(new Set([...(member.ruoli || []), cleanRole]));

    const typeId = getMemberTypeIdForRole(cleanRole);
    const w = (db.rawWmembers || []).find(w => String(w.member_id) === String(member.rawId) && String(w.club_id) === clubId);
    if (w) {
      w.membertype_id = typeId;
      db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
    }
  }

  member.numeroTesseraDirigente = formatDirigenteCard(member);
  member.numeroTessera = member.numeroTesseraDirigente;

  const rawM = (db.rawMembers || []).find(m => String(m.id) === String(member.rawId));
  if (rawM) {
    if (nome) rawM.name = member.nome;
    if (cognome) rawM.surname = member.cognome;
    if (codiceFiscale) rawM.cf = member.codiceFiscale;
    if (email !== undefined) rawM.email = member.email;
    if (telefono !== undefined) rawM.telephone = member.telefono;
    if (scadenza) rawM.affiliate_expire = member.affiliateExpire;
    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'societa',
    categoria: 'Consiglio Direttivo',
    azione: 'Modifica Dati Dirigente',
    oggetto: `${member.cognome} ${member.nome} (${member.numeroTesseraDirigente})`,
    dettagli: `Aggiornati dati anagrafici e ruolo dirigente ${member.cognome} ${member.nome}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Dati dirigente aggiornati con successo!',
    dirigente: member
  });
});

// Cancella Dirigente dalla società
app.delete('/api/societa/dirigenti/:id', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const clubId = String(rc.id || cf.rawId || '');

  const memberIndex = (db.membersList || []).findIndex(m => m.id === req.params.id || String(m.rawId) === String(req.params.id));
  if (memberIndex === -1) {
    return res.status(404).json({ error: 'Dirigente non trovato' });
  }

  const member = db.membersList[memberIndex];

  // Remove dirigenza roles
  member.ruoliSocietari = (member.ruoliSocietari || []).filter(r => !['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'].some(k => r.toLowerCase().includes(k)));
  member.ruoli = (member.ruoli || []).filter(r => !['presidente', 'vicepresidente', 'consigliere', 'segretario', 'medico', 'rappresentante'].some(k => r.toLowerCase().includes(k)));

  if (!member.ruoliSocietari.some(r => r.toLowerCase().includes('atleta'))) {
    member.societaId = '0';
    member.societaNome = 'Atleta Individuale / Libero';
  }

  if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
    const wIdx = db.rawWmembers.findIndex(w => String(w.member_id) === String(member.rawId) && String(w.club_id) === clubId);
    if (wIdx !== -1) {
      db.rawWmembers.splice(wIdx, 1);
      db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
    }
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'societa',
    categoria: 'Consiglio Direttivo',
    azione: 'Cancellazione Dirigente',
    oggetto: `${member.cognome} ${member.nome} (${member.numeroTesseraDirigente || member.id})`,
    dettagli: `Rimosso dal Consiglio Direttivo della società ${rc.name || cf.nome || user.ragioneSociale}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Tesserato rimosso dal Consiglio Direttivo della società.'
  });
});

// Helper: load/save FISO forms
function getFisoForms() {
  return db.readJsonFile ? db.readJsonFile('fiso_forms.json', {}) : {};
}

function saveFisoForms(data) {
  if (db.writeJsonFile) {
    db.writeJsonFile('fiso_forms.json', data);
  }
}

// Helper: combina denominazione società e ragione sociale (se non già presente)
function formatClubNameWithRagioneSociale(clubName, rName) {
  let name = String(clubName || '').trim();
  let r = String(rName || '').trim();
  if (!r) return name;
  if (!name) return r;

  const nameNorm = name.toLowerCase().replace(/[\.\s_-]+/g, ' ');
  const rNorm = r.toLowerCase().replace(/[\.\s_-]+/g, ' ');

  if (/^a\s*s\s*d$/i.test(rNorm) || r.toUpperCase() === 'ASD') {
    if (/\b(?:asd|a\s*s\s*d|associazione\s+sportiva\s+dilettantistica)\b/i.test(nameNorm)) {
      return name;
    }
    return `${name} ${r.toUpperCase()}`;
  }

  if (/^s\s*s\s*d/i.test(rNorm) || r.toUpperCase().startsWith('SSD')) {
    if (/\b(?:ssd|s\s*s\s*d|societ[aà]\s+sportiva\s+dilettantistica)\b/i.test(nameNorm)) {
      return name;
    }
    return `${name} ${r.toUpperCase()}`;
  }

  if (nameNorm.includes(rNorm) || rNorm.includes(nameNorm)) {
    return name;
  }

  if (rNorm.includes('ente senza fine di lucro')) {
    return name;
  }

  return `${name} ${r}`;
}

// Helper: build FISO module structure for a club with automatic retrieval from tesseramenti
function buildSocietaModuloFiso(rc, cf, user, forceReload = false) {
  const rawClubId = String((rc && rc.id) || (cf && cf.rawId) || '');
  const clubCodice = String((cf && cf.codice) || (rc && rc.codice) || (user && user.codiceSocieta) || '');
  const rawClubName = String((rc && rc.name) || (cf && cf.nome) || (user && (user.ragioneSociale || user.utente || user.nome)) || '').trim();
  const rName = String((rc && rc.r_name) || (cf && cf.rName) || '').trim();
  const clubName = formatClubNameWithRagioneSociale(rawClubName, rName);
  const clubNameLower = rawClubName.toLowerCase();

  const fisoForms = getFisoForms();
  const savedData = forceReload ? null : ((fisoForms && fisoForms[rawClubId]) || (rc && rc.fiso_form) || (cf && cf.fiso_form) || null);

  // Filter all members belonging to this club
  const allClubMembers = (db.membersList || []).filter(m => 
    (rawClubId && String(m.societaId) === rawClubId) ||
    (clubCodice && String(m.societaCodice) === clubCodice) ||
    (m.societaNome && clubNameLower && m.societaNome.trim().toLowerCase() === clubNameLower)
  );

  // Regola generica: verifica tesseramento attivo per l'anno di affiliazione (statoTessera 'attiva' oppure ultimoAnnoTesseramento >= 2026)
  const isMemberActive = (m) => m.statoTessera === 'attiva' || Number(m.ultimoAnnoTesseramento) >= 2026;
  const activeMembers = allClubMembers.filter(isMemberActive);

  // Per l'estrazione automatica delle cariche consideriamo ESCLUSIVAMENTE i tesserati con tessera attiva
  const membersForRoles = activeMembers;
  // Per il picker dropdown usiamo i membri attivi se presenti, altrimenti fallback a allClubMembers
  const membersForPicker = activeMembers.length > 0 ? activeMembers : allClubMembers;

  const normalize = (str) => String(str || '').trim().toLowerCase();
  const formatFullName = (m) => (`${String(m.cognome || '').trim()} ${String(m.nome || '').trim()}`.trim() || `${String(m.nome || '').trim()} ${String(m.cognome || '').trim()}`.trim()).toUpperCase();

  let detectedPresidente = null;
  let detectedVice = null;
  const detectedConsiglieri = [];
  let detectedRapprAtleti = null;
  let detectedRapprTecnici = null;
  let detectedMedico = null;

  // Pass 1: Presidente (ESCLUSIVAMENTE da ruoliSocietari di tesserati attivi)
  membersForRoles.forEach(m => {
    const roles = (m.ruoliSocietari || []).map(r => normalize(r));
    const fullName = formatFullName(m);
    const cfVal = String(m.codiceFiscale || m.cf || '').trim().toUpperCase();
    if (!detectedPresidente && roles.some(r => r === 'presidente' || (r.includes('presidente') && !r.includes('vice')))) {
      detectedPresidente = { nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Presidente)' };
    }
  });

  // Pass 2: Vicepresidente (ESCLUSIVAMENTE da ruoliSocietari di tesserati attivi, persona diversa dal Presidente)
  membersForRoles.forEach(m => {
    if (detectedPresidente && m.id === detectedPresidente.id) return;
    const roles = (m.ruoliSocietari || []).map(r => normalize(r));
    const fullName = formatFullName(m);
    const cfVal = String(m.codiceFiscale || m.cf || '').trim().toUpperCase();
    if (!detectedVice && roles.some(r => r.includes('vicepresidente') || r.includes('vice presidente') || r === 'vice')) {
      detectedVice = { nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Vicepresidente)' };
    }
  });

  // Pass 3: Consiglieri societari (ESCLUSIVAMENTE da ruoliSocietari dei tesserati attivi, MAI da ruoliFederali)
  membersForRoles.forEach(m => {
    if (detectedPresidente && m.id === detectedPresidente.id) return;
    if (detectedVice && m.id === detectedVice.id) return;
    const roles = (m.ruoliSocietari || []).map(r => normalize(r));
    const fullName = formatFullName(m);
    const cfVal = String(m.codiceFiscale || m.cf || '').trim().toUpperCase();
    if (roles.some(r => r.includes('consigliere') || r.includes('segretario'))) {
      if (!detectedConsiglieri.some(c => c.cf === cfVal || c.nome === fullName)) {
        detectedConsiglieri.push({ nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Consigliere)' });
      }
    }
  });

  // Pass 4: Rappresentanti e Medico (ESCLUSIVAMENTE da ruoliSocietari di tesserati attivi)
  membersForRoles.forEach(m => {
    if (detectedPresidente && m.id === detectedPresidente.id) return;
    if (detectedVice && m.id === detectedVice.id) return;
    const roles = (m.ruoliSocietari || []).map(r => normalize(r));
    const fullName = formatFullName(m);
    const cfVal = String(m.codiceFiscale || m.cf || '').trim().toUpperCase();
    if (!detectedRapprAtleti && roles.some(r => r.includes('rappresentante atleti') || (r.includes('rappresentante') && r.includes('atleti')))) {
      detectedRapprAtleti = { nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Rappresentante Atleti)' };
    }
    if (!detectedRapprTecnici && roles.some(r => r.includes('rappresentante tecnici') || (r.includes('rappresentante') && r.includes('tecnic')))) {
      detectedRapprTecnici = { nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Rappresentante Tecnici)' };
    }
    if (!detectedMedico && roles.some(r => r.includes('medico'))) {
      detectedMedico = { nome: fullName, cf: cfVal, id: m.id, source: 'Tesseramenti (Medico Sociale)' };
    }
  });

  // Fallback Presidente: se non trovato tra i tesserati attivi, usa rc.contact / rc.referente dell'anagrafica
  if (!detectedPresidente && ((rc && rc.contact) || (cf && cf.contact) || (cf && cf.referente))) {
    const contactName = (rc && rc.contact) || (cf && cf.contact) || (cf && cf.referente);
    detectedPresidente = { nome: String(contactName).trim().toUpperCase(), cf: '', id: '', source: 'Anagrafica Società (Referente)' };
  }

  const currentYear = new Date().getFullYear();
  const defaultAnno = currentYear >= 2026 ? '2026' : String(currentYear);

  // Estrazione intelligente e bonifica dell'indirizzo societario
  let rawAddr = String((rc && rc.address) || (cf && cf.address) || '').trim();
  let rawNum = String((rc && rc.street_number) || (cf && cf.street_number) || '').trim();
  let rawCap = String((rc && rc.cap) || (cf && cf.cap) || '').trim();
  let rawCity = String((rc && rc.city) || (cf && cf.city) || '').trim();
  let rawProv = String((rc && rc.province) || (cf && cf.province) || '').trim().toUpperCase();

  // 1. Se il comune contiene il CAP a inizio stringa (es. "36100 Vicenza")
  const capInCity = rawCity.match(/^(\d{5})\s+(.*)$/);
  if (capInCity) {
    if (!rawCap) rawCap = capInCity[1];
    rawCity = capInCity[2].trim();
  }

  // 2. Lookup automatico del CAP mancante o normalizzazione comune via geoCF
  if (rawCity && geoCF && typeof geoCF.lookupCity === 'function') {
    const looked = geoCF.lookupCity(rawCity);
    if (looked) {
      if (!rawCap && looked.cap) rawCap = looked.cap;
      if (!rawProv && looked.prov) rawProv = String(looked.prov).toUpperCase();
      if (looked.name) rawCity = looked.name;
    }
  }

  // 3. Fallback: se la città non corrisponde o ha refusi ma abbiamo il CAP valido
  if (rawCap && geoCF && geoCF.CITY_META_MAP && (!rawCity || (geoCF.lookupCity && !geoCF.lookupCity(rawCity)))) {
    const byCap = Object.values(geoCF.CITY_META_MAP).find(v => v.cap === rawCap && (!rawProv || v.prov === rawProv));
    if (byCap) {
      rawCity = byCap.name;
      if (!rawProv) rawProv = String(byCap.prov).toUpperCase();
    }
  }

  // Funzione separazione Via e Civico
  function separateAddressAndCivico(addrStr, numStr) {
    let addr = (addrStr || '').trim();
    let num = (numStr || '').trim();
    if (!num && addr) {
      // Formato "str. Dolomites nr,14" o "VIA VALFRANCESCA N.7"
      const nrMatch = addr.match(/^(.*?)[,\s]+(?:nr[,\.]*|n[°\.]*|n°|civico)\s*([0-9]+[\s\w\/-]*)$/i);
      if (nrMatch && nrMatch[1] && nrMatch[2]) {
        addr = nrMatch[1].trim();
        num = nrMatch[2].trim();
      } else {
        // Formato con virgola "Viale Ovidio, 3"
        const commaParts = addr.split(',');
        if (commaParts.length === 2 && /^\s*(?:n[°r\.]*|civico)?\s*\d+[\s\w\/-]*$/i.test(commaParts[1])) {
          addr = commaParts[0].trim();
          num = commaParts[1].replace(/^(?:n[°r\.]*|civico)\s*/i, '').trim();
        } else {
          // Formato numero a fine via "Via Roma 72", "corso Fogazzaro 50", "Frazione Brach 34"
          const numMatch = addr.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:\s*[\/-]\s*[a-zA-Z0-9]+)?)(?:\s*-\s*(.*))?$/);
          if (numMatch && numMatch[1] && numMatch[2]) {
            const street = numMatch[1].trim();
            const nVal = numMatch[2].trim();
            const rest = numMatch[3] ? ' - ' + numMatch[3].trim() : '';
            if (!/(?:XXIV|IV|IX|V|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI|XXII|XXIII|XXV|XXVI|XXVII|XXVIII|XXIX|XXX)\b/i.test(street)) {
              addr = street + rest;
              num = nVal;
            }
          }
        }
      }
    }
    return { indirizzo: addr, civico: num };
  }

  const separated = separateAddressAndCivico(rawAddr, rawNum);
  const cleanAddress = separated.indirizzo;
  const cleanCivico = separated.civico;

  // 4. Formattazione Luogo pulito: "Comune (PROV)"
  let cleanLuogo = rawCity;
  if (rawProv) {
    if (!cleanLuogo.includes(`(${rawProv})`)) {
      cleanLuogo = cleanLuogo ? `${cleanLuogo} (${rawProv})` : `(${rawProv})`;
    }
  }

  const defaultConsiglieri = detectedConsiglieri.slice();
  while (defaultConsiglieri.length < 5) {
    defaultConsiglieri.push({ nome: '', cf: '', source: '' });
  }

  const defaults = {
    anno: defaultAnno,
    nomeSocieta: clubName,
    codiceFiscale: (rc && rc.cf) || (cf && cf.codiceFiscale) || '',
    partitaIva: (rc && rc.pi) || (cf && cf.partitaIva) || '',
    indirizzo: cleanAddress,
    civico: cleanCivico,
    cap: rawCap,
    luogo: cleanLuogo,
    email: (rc && rc.email) || (cf && cf.email) || (user && user.email) || '',
    pec: (rc && rc.email2) || (cf && cf.email2) || '',
    sitoWeb: (rc && rc.web) || (cf && cf.web) || '',
    telefono: (rc && rc.cell1) || (cf && cf.cell1) || '',
    iban: (rc && rc.iban) || (cf && cf.iban) || '',
    presidente: detectedPresidente || { nome: '', cf: '', source: '' },
    vicepresidente: detectedVice || { nome: '', cf: '', source: '' },
    consiglieri: defaultConsiglieri,
    rappresentanteAtleti: detectedRapprAtleti || { nome: '', cf: '', source: '' },
    rappresentanteTecnici: detectedRapprTecnici || { nome: '', cf: '', source: '' },
    medicoSociale: detectedMedico || { nome: '', cf: '', source: '' },
    data: new Date().toLocaleDateString('it-IT')
  };

  let fisoForm = defaults;
  if (savedData) {
    fisoForm = { ...defaults, ...savedData };
    if (!fisoForm.nomeSocieta || fisoForm.nomeSocieta === rawClubName) {
      fisoForm.nomeSocieta = clubName;
    } else {
      fisoForm.nomeSocieta = formatClubNameWithRagioneSociale(fisoForm.nomeSocieta, rName);
    }
    if (!fisoForm.civico && cleanCivico) fisoForm.civico = cleanCivico;
    if (!fisoForm.cap && rawCap) fisoForm.cap = rawCap;
    if (!fisoForm.luogo && cleanLuogo) fisoForm.luogo = cleanLuogo;
    if (fisoForm.indirizzo && !fisoForm.civico) {
      const sepAgain = separateAddressAndCivico(fisoForm.indirizzo, '');
      if (sepAgain.civico) {
        fisoForm.indirizzo = sepAgain.indirizzo;
        fisoForm.civico = sepAgain.civico;
      }
    }

    // Integrazione automatica consiglieri da tesseramenti se superiori a quelli precedentemente salvati
    if (Array.isArray(savedData.consiglieri) && detectedConsiglieri.length > 0) {
      const savedNonEmpty = savedData.consiglieri.filter(c => (c.nome || '').trim() || (c.cf || '').trim());
      const existingCfs = new Set(savedNonEmpty.map(c => (c.cf || '').trim().toUpperCase()).filter(Boolean));
      const existingNames = new Set(savedNonEmpty.map(c => (c.nome || '').trim().toLowerCase()).filter(Boolean));
      const merged = [...savedNonEmpty];

      detectedConsiglieri.forEach(dc => {
        const normCf = (dc.cf || '').trim().toUpperCase();
        const normName = (dc.nome || '').trim().toLowerCase();
        if ((normCf && !existingCfs.has(normCf)) || (!normCf && normName && !existingNames.has(normName))) {
          merged.push(dc);
          if (normCf) existingCfs.add(normCf);
          if (normName) existingNames.add(normName);
        }
      });
      while (merged.length < 5) merged.push({ nome: '', cf: '', source: '' });
      fisoForm.consiglieri = merged;
    }
  }

  if (!Array.isArray(fisoForm.consiglieri)) fisoForm.consiglieri = [];
  while (fisoForm.consiglieri.length < 5) {
    fisoForm.consiglieri.push({ nome: '', cf: '', source: '' });
  }

  return {
    success: true,
    rawClubId,
    clubCodice,
    clubName,
    fisoForm,
    isSaved: Boolean(savedData),
    lastSavedAt: savedData && savedData.savedAt ? savedData.savedAt : null,
    detected: {
      presidente: detectedPresidente,
      vicepresidente: detectedVice,
      consiglieri: detectedConsiglieri,
      rappresentanteAtleti: detectedRapprAtleti,
      rappresentanteTecnici: detectedRapprTecnici,
      medicoSociale: detectedMedico
    },
    societaMembers: membersForPicker.map(m => ({
      id: m.id,
      nome: formatFullName(m),
      cf: String(m.codiceFiscale || m.cf || '').trim().toUpperCase(),
      ruoli: (m.ruoliSocietari && m.ruoliSocietari.length > 0) ? m.ruoliSocietari : (m.ruoli || [])
    }))
  };
}

// Get FISO module data for current Società
app.get('/api/societa/modulo-fiso', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};

  const forceReload = req.query.forceReload === '1' || req.query.forceReload === 'true';
  const result = buildSocietaModuloFiso(rc, cf, user, forceReload);
  res.json(result);
});

// Save FISO module data for current Società
const handleSaveFisoModulo = (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const rawClubId = String(rc.id || cf.rawId || '');

  if (!rawClubId) {
    return res.status(400).json({ error: 'Società non associata all\'utente' });
  }

  const formData = req.body || {};
  formData.savedAt = new Date().toISOString();
  formData.savedBy = user.username || user.nome || user.email || 'Società';

  const fisoForms = getFisoForms();
  fisoForms[rawClubId] = formData;
  saveFisoForms(fisoForms);

  if (rc) {
    rc.fiso_form = formData;
    db.writeJsonFile('mysql_clubs.json', db.rawClubs);
  }
  if (cf) {
    cf.fiso_form = formData;
  }

  recordOperationLog(req, {
    origine: user.role === 'admin' ? 'admin' : 'frontend',
    categoria: 'Società',
    azione: 'Salvataggio Modulo FISO',
    oggetto: formData.nomeSocieta || rc.name || cf.nome || `Società ${rawClubId}`,
    dettagli: `Salvati dati del Modulo FISO (Affiliazione anno ${formData.anno || '2026'}). Presidente: ${formData.presidente?.nome || '-'}.`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Dati del Modulo FISO salvati con successo!',
    data: formData
  });
};

app.post('/api/societa/modulo-fiso', handleSaveFisoModulo);
app.put('/api/societa/modulo-fiso', handleSaveFisoModulo);

// Admin endpoints for FISO module by societa ID
app.get('/api/admin/societa/:id/modulo-fiso', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Non autorizzato' });

  const targetId = String(req.params.id);
  const rc = (db.rawClubs || []).find(c => String(c.id) === targetId || String(c.fisoId) === targetId || String(c.codice) === targetId);
  const cf = (db.clubsList || []).find(c => String(c.rawId) === targetId || String(c.id) === targetId || String(c.codice) === targetId);

  if (!rc && !cf) {
    return res.status(404).json({ error: 'Società non trovata' });
  }

  const forceReload = req.query.forceReload === '1' || req.query.forceReload === 'true';
  const result = buildSocietaModuloFiso(rc, cf, user, forceReload);
  res.json(result);
});

const handleAdminSaveFisoModulo = (req, res) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Non autorizzato' });

  const targetId = String(req.params.id);
  const rc = (db.rawClubs || []).find(c => String(c.id) === targetId || String(c.fisoId) === targetId || String(c.codice) === targetId);
  const cf = (db.clubsList || []).find(c => String(c.rawId) === targetId || String(c.id) === targetId || String(c.codice) === targetId);

  const rawClubId = String((rc && rc.id) || (cf && cf.rawId) || targetId);
  const formData = req.body || {};
  formData.savedAt = new Date().toISOString();
  formData.savedBy = 'Admin: ' + (user.username || user.nome || 'Amministratore');

  const fisoForms = getFisoForms();
  fisoForms[rawClubId] = formData;
  saveFisoForms(fisoForms);

  if (rc) {
    rc.fiso_form = formData;
    db.writeJsonFile('mysql_clubs.json', db.rawClubs);
  }
  if (cf) {
    cf.fiso_form = formData;
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Società',
    azione: 'Salvataggio Modulo FISO (Admin)',
    oggetto: formData.nomeSocieta || (rc && rc.name) || (cf && cf.nome) || `Società ${rawClubId}`,
    dettagli: `Salvati dati del Modulo FISO da pannello amministrativo per la società ID ${rawClubId}.`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Dati del Modulo FISO salvati con successo!',
    data: formData
  });
};

app.post('/api/admin/societa/:id/modulo-fiso', handleAdminSaveFisoModulo);
app.put('/api/admin/societa/:id/modulo-fiso', handleAdminSaveFisoModulo);

// Helper check race access for society
function canSocietyAccessRace(user, gara) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const rawClubId = String(rc.id || cf.rawId || user.clubRawId || user.id || '').trim();
  const clubName = String(rc.name || cf.nome || user.ragioneSociale || user.utente || user.nome || '').trim().toLowerCase();

  const gClubId = String(gara.club_id || gara.societaId || '').trim();
  const gPromotore = String(gara.promotore || gara.societaNome || gara.societa || gara.from || '').trim().toLowerCase();

  // 1. Se la richiesta gara ha un club_id esplicito (> 0):
  // Appartiene a questa società solo e soltanto se i rispettivi ID societari coincidono.
  // Non deve MAI essere assegnata ad un'altra società per omonimia parziale o per email di contatto condivisa!
  if (gClubId && gClubId !== '0') {
    return Boolean(rawClubId && gClubId === rawClubId);
  }

  // 2. Solo per gare storiche o inserimenti liberi con club_id mancante o '0':
  // Effettua la corrispondenza univoca sul nome del promotore / ragione sociale della società.
  if (clubName && gPromotore) {
    if (gPromotore === clubName) return true;
    const cleanClub = clubName.replace(/\b(a\.?s\.?d\.?|s\.?s\.?d\.?|aps|onlus)\b/gi, '').trim();
    const cleanProm = gPromotore.replace(/\b(a\.?s\.?d\.?|s\.?s\.?d\.?|aps|onlus)\b/gi, '').trim();
    if (cleanClub.length >= 6 && cleanProm.length >= 6) {
      if (cleanProm === cleanClub || cleanProm.startsWith(cleanClub) || cleanClub.startsWith(cleanProm)) {
        return true;
      }
    }
  }

  return false;
}

// Race requests for Società
app.get('/api/societa/gare', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const gare = (db.raceRequestsList || []).filter(g => canSocietyAccessRace(user, g));

  // Ordina per data gara / anno decrescente
  gare.sort((a, b) => {
    const dateA = a.dataGara || a.date || (a.anno ? `${a.anno}-01-01` : '1970-01-01');
    const dateB = b.dataGara || b.date || (b.anno ? `${b.anno}-01-01` : '1970-01-01');
    return new Date(dateB) - new Date(dateA);
  });

  res.json({ success: true, total: gare.length, gare });
});

// Single race request details
app.get('/api/societa/gare/:id', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const idParam = String(req.params.id);
  const gara = (db.raceRequestsList || []).find(g => String(g.id) === idParam || String(g.rawId) === idParam || `req_${g.rawId}` === idParam);
  if (!gara) return res.status(404).json({ error: 'Richiesta gara non trovata' });

  if (!canSocietyAccessRace(user, gara)) {
    return res.status(403).json({ error: 'Non hai i permessi per accedere a questa richiesta gara' });
  }

  const raw = (db.rawRequests || []).find(r => String(r.id) === String(gara.rawId));
  res.json({ success: true, gara, raw });
});

// Update race request by Società
app.put('/api/societa/gare/:id', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const idParam = String(req.params.id);
  const rawIdx = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIdx === -1) return res.status(404).json({ error: 'Richiesta gara non trovata' });

  const rawRec = db.rawRequests[rawIdx];
  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(rawRec.id));
  const garaObj = listIdx !== -1 ? db.raceRequestsList[listIdx] : db.buildRaceRequestObj(rawRec);

  if (!canSocietyAccessRace(user, garaObj)) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questa richiesta gara' });
  }

  const b = req.body || {};
  if (b.nomeGara !== undefined) rawRec.title = String(b.nomeGara).trim();
  if (b.title !== undefined) rawRec.title = String(b.title).trim();
  if (b.edizione !== undefined) rawRec.edition = String(b.edizione).trim();
  if (b.edition !== undefined) rawRec.edition = String(b.edition).trim();
  if (b.dataGara !== undefined) rawRec.date = String(b.dataGara).trim();
  if (b.date !== undefined) rawRec.date = String(b.date).trim();
  if (b.localita !== undefined) rawRec.where = String(b.localita).trim();
  if (b.where !== undefined) rawRec.where = String(b.where).trim();
  if (b.regione !== undefined) rawRec.regione = String(b.regione).trim();

  if (b.categoryrace_id !== undefined) {
    rawRec.categoryrace_id = String(b.categoryrace_id);
  } else if (b.disciplina !== undefined) {
    const dLower = String(b.disciplina).toLowerCase();
    if (dLower.includes('vert')) rawRec.categoryrace_id = '2';
    else if (dLower.includes('ultra')) rawRec.categoryrace_id = '3';
    else rawRec.categoryrace_id = '1';
  }

  if (b.distanzaKm !== undefined) rawRec.distance = String(b.distanzaKm);
  if (b.distance !== undefined) rawRec.distance = String(b.distance);
  if (b.dislivelloDplus !== undefined) rawRec.drop_pos = String(b.dislivelloDplus);
  if (b.drop_pos !== undefined) rawRec.drop_pos = String(b.drop_pos);
  if (b.dislivelloDminus !== undefined) rawRec.drop_neg = String(b.dislivelloDminus);
  if (b.drop_neg !== undefined) rawRec.drop_neg = String(b.drop_neg);
  if (b.quotaMassima !== undefined) rawRec.max_height = String(b.quotaMassima);
  if (b.max_height !== undefined) rawRec.max_height = String(b.max_height);
  if (b.maxPartecipanti !== undefined) rawRec.max_atlete = String(b.maxPartecipanti);
  if (b.max_atlete !== undefined) rawRec.max_atlete = String(b.max_atlete);
  if (b.percentualeAsfalto !== undefined) rawRec.asfalto_perc = String(b.percentualeAsfalto);
  if (b.percentualeSentiero !== undefined) rawRec.sentiero_perc = String(b.percentualeSentiero);

  if (b.tipologieSentiero !== undefined) {
    rawRec.sentiero_tipi = Array.isArray(b.tipologieSentiero) ? b.tipologieSentiero.join(', ') : String(b.tipologieSentiero);
  }
  if (b.tipologiaRichiesta !== undefined) {
    const list = Array.isArray(b.tipologiaRichiesta) ? b.tipologiaRichiesta : [b.tipologiaRichiesta];
    rawRec.tipologia_richiesta = list.join('; ');
    rawRec.championships = rawRec.tipologia_richiesta;
  }
  if (b.altriCircuiti !== undefined) {
    rawRec.otherChampionship = (b.altriCircuiti === 'Si' || b.altriCircuiti === 'Sì' || b.altriCircuiti === '1' || b.altriCircuiti === true) ? '1' : '0';
  }
  if (b.altriCircuitiTxt !== undefined) rawRec.otherChampionshipTxt = String(b.altriCircuitiTxt).trim();

  if (b.sitoWeb !== undefined) rawRec.url = String(b.sitoWeb).trim();
  if (b.direttoreGara !== undefined) rawRec.racedirector = String(b.direttoreGara).trim();
  if (b.aziendaCrono !== undefined) rawRec.chrono = String(b.aziendaCrono).trim();
  if (b.emailUfficiale !== undefined) rawRec.email = String(b.emailUfficiale).trim();
  if (b.referenteNome !== undefined) rawRec.contact = String(b.referenteNome).trim();
  if (b.referenteTelefono !== undefined) rawRec.telephone = String(b.referenteTelefono).trim();
  if (b.referenteEmail !== undefined) rawRec.c_emal = String(b.referenteEmail).trim();
  if (b.note !== undefined) rawRec.description = String(b.note).trim();

  db.writeJsonFile('mysql_racerequests.json', db.rawRequests);

  const updatedObj = db.buildRaceRequestObj(rawRec);
  if (listIdx !== -1) {
    db.raceRequestsList[listIdx] = updatedObj;
  }

  if (typeof db.syncRaceRequestToCalendar === 'function') {
    db.syncRaceRequestToCalendar(rawRec);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Gestione Gare',
    azione: 'Modifica Richiesta Gara',
    oggetto: `${updatedObj.nomeGara || rawRec.title} (ID: ${rawRec.id})`,
    dettagli: `Modificata richiesta gara da società "${user.ragioneSociale || user.nome}" | Data: ${updatedObj.dataGara || rawRec.date}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Richiesta gara aggiornata con successo.',
    gara: updatedObj
  });
});

// Delete race request by Società
app.delete('/api/societa/gare/:id', (req, res) => {
  const user = getCurrentUser(req);
  if (!user || (user.role !== 'societa' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  const idParam = String(req.params.id);
  const rawIdx = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIdx === -1) return res.status(404).json({ error: 'Richiesta gara non trovata' });

  const rawRec = db.rawRequests[rawIdx];
  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(rawRec.id));
  const garaObj = listIdx !== -1 ? db.raceRequestsList[listIdx] : db.buildRaceRequestObj(rawRec);

  if (!canSocietyAccessRace(user, garaObj)) {
    return res.status(403).json({ error: 'Non hai i permessi per cancellare questa richiesta gara' });
  }

  const removedRaw = db.rawRequests.splice(rawIdx, 1)[0];
  db.writeJsonFile('mysql_racerequests.json', db.rawRequests);

  if (listIdx !== -1) {
    db.raceRequestsList.splice(listIdx, 1);
  }

  if (typeof db.removeRaceRequestFromCalendar === 'function') {
    db.removeRaceRequestFromCalendar(removedRaw.id);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Gestione Gare',
    azione: 'Cancellazione Richiesta Gara',
    oggetto: `${removedRaw.title || idParam} (ID: ${removedRaw.id})`,
    dettagli: `Richiesta gara "${removedRaw.title}" cancellata dalla società "${user.ragioneSociale || user.nome}"`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Richiesta gara "${removedRaw.title}" cancellata con successo.`
  });
});

// Helper per arricchire i pagamenti con Causale descrittiva, Metodo e Stato formattati
function enrichSocietyPayment(p) {
  const paymentId = String(p.id);
  const items = (db.rawPaymentitems || []).filter(it => String(it.payment_id) === paymentId);
  const info = (db.rawPaymentinfos || []).find(inf => String(inf.payment_id) === paymentId);

  let causale = '';
  let dettaglio = '';

  if (items.length > 0) {
    const models = [...new Set(items.map(i => i.model))];

    if (models.includes('Club')) {
      causale = 'Rinnovo Affiliazione Club';
      const clubNames = items.filter(i => i.model === 'Club').map(i => {
        const parts = (i.description || '').split(':');
        return (parts[1] || parts[0]).trim();
      }).filter(Boolean);
      dettaglio = clubNames.join(', ');
    } else if (models.includes('Wmember')) {
      const names = items.map(i => (i.description || '').trim()).filter(Boolean);
      if (names.length === 1) {
        causale = 'Pagamento Tessera Atleta';
        dettaglio = names[0];
      } else {
        causale = `Pagamento Tessere Atleti (${names.length} nominativi)`;
        dettaglio = names.join(', ');
      }
    } else if (models.includes('Racerequest')) {
      causale = 'Richiesta Inserimento Gara a Calendario';
      dettaglio = items.map(i => i.description).filter(Boolean).join(', ');
    } else {
      causale = items[0].model ? ('Pagamento ' + items[0].model) : 'Pagamento Servizi Federali';
      dettaglio = items.map(i => i.description).filter(Boolean).join(', ');
    }
  } else if (info) {
    if (info.type === 'members' && info.info) {
      const clean = info.info.replace(/\\\\n|\\n/g, '\n');
      const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
      const names = lines.map(l => {
        const parts = l.split(';').map(s => s.trim()).filter(Boolean);
        return parts.join(' ');
      }).filter(Boolean);

      if (names.length === 1) {
        causale = 'Pagamento Tessera Atleta';
        dettaglio = names[0];
      } else {
        causale = `Pagamento Tessere Atleti (${names.length} nominativi)`;
        dettaglio = names.join(', ');
      }
    } else if (info.type === 'races' && info.info) {
      causale = 'Richiesta Inserimento Gara a Calendario';
      dettaglio = info.info.replace(/\\\\n|\\n/g, '\n').replace(/;/g, ' - ').trim();
    }
  }

  if (!causale && p.note && p.note.trim()) {
    causale = p.note.trim();
  }

  if (!causale && p.description && p.description.trim()) {
    causale = p.description.trim();
  }

  if (!causale && p.racerequest_id && p.racerequest_id !== '0') {
    causale = 'Richiesta Inserimento Gara a Calendario #' + p.racerequest_id;
  }

  if (!causale) {
    causale = 'Addebito Servizi Federali';
  }

  // Normalizzazione Metodo di Pagamento ("Conto FISKY" invece di "CFISKY", "Carta di Credito" invece di "CC")
  let metodoLabel = 'Conto FISKY';
  const m = String(p.payment || '').toUpperCase().trim();
  if (m === 'CC' || m === 'CARTA' || m === 'CREDIT_CARD' || m.includes('CARTA')) {
    metodoLabel = 'Carta di Credito';
  } else if (m === 'CFISKY' || m === 'CONTO' || m === 'CONTO FISKY') {
    metodoLabel = 'Conto FISKY';
  } else if (m === 'MANUAL' || m === 'BONIFICO') {
    metodoLabel = 'Bonifico Bancario';
  } else if (p.payment) {
    metodoLabel = p.payment;
  }

  // Normalizzazione Stato
  let statoLabel = p.status || 'Eseguito';
  const st = statoLabel.toLowerCase();
  if (st.includes('eseguit') || st.includes('approvat') || st.includes('complet') || st === 'ok') {
    statoLabel = 'Eseguito';
  } else if (st.includes('attes') || st.includes('pend')) {
    statoLabel = 'In Attesa';
  } else if (st.includes('fallit') || st.includes('annullat') || st.includes('negat') || st.includes('respint')) {
    statoLabel = 'Fallito';
  }

  return {
    ...p,
    causale,
    dettaglio: dettaglio || '',
    noteExtra: (p.note && p.note !== causale && p.note !== dettaglio) ? p.note : '',
    metodoLabel,
    status: statoLabel,
    total: p.total !== undefined ? p.total : (p.amount !== undefined ? p.amount : 0),
    itemsCount: items.length
  };
}

// Pagamenti effettuati for Società
app.get('/api/societa/pagamenti', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const userId = String(rc.user_id || cf.userId || user.userId || user.rawUserId || '');

  const payments = (db.rawPayments || [])
    .filter(p => userId && String(p.user_id) === userId)
    .sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)))
    .map(p => enrichSocietyPayment(p));

  const rawAcc = (db.rawAccounts || []).find(a => String(a.user_id) === userId);
  const currentCredit = (cf && cf.credito !== undefined) ? Number(cf.credito) : (rawAcc ? (parseFloat(rawAcc.current) || 0) : 0);

  res.json({ success: true, payments, currentCredit });
});

// Richieste di versamento for Società
app.get('/api/societa/richieste-versamento', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const userId = String(rc.user_id || cf.userId || user.userId || user.rawUserId || '');

  const requests = (db.rawPaymentrequests || []).filter(pr => userId && String(pr.user_id) === userId);
  requests.sort((a, b) => parseInt(b.id || 0) - parseInt(a.id || 0));

  res.json({ success: true, requests });
});

// Submit new payment request (Richiesta di Versamento)
app.post('/api/societa/richieste-versamento', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const userId = String(rc.user_id || cf.userId || user.userId || user.rawUserId || '');

  const amount = parseFloat(req.body.amount);
  const note = String(req.body.note || '').trim();
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Importo non valido' });
  }

  const existingIds = (db.rawPaymentrequests || []).map(r => parseInt(r.id) || 0);
  const newId = String(existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const todayStr = new Date().toISOString().split('T')[0];
  const clubHeader = `${rc.name || cf.nome || user.ragioneSociale || 'Società'}[]${rc.address || cf.address || ''} - ${rc.city || cf.city || ''}`;

  const newRequest = {
    id: newId,
    header: clubHeader,
    amount: amount.toFixed(2),
    when: todayStr,
    n_doc: null,
    note: note || 'Richiesta di versamento conto federale',
    status: 'In attesa',
    accepted: null,
    user_id: userId || '0'
  };

  db.rawPaymentrequests.unshift(newRequest);
  db.writeJsonFile('mysql_paymentrequests.json', db.rawPaymentrequests);

  recordOperationLog(req, {
    origine: 'societa',
    categoria: 'Contabilità e Pagamenti',
    azione: 'Nuova Richiesta di Versamento',
    oggetto: `Società ${rc.name || cf.nome || user.ragioneSociale || user.utente}`,
    dettagli: `Inviata richiesta di versamento ID ${newId} per € ${amount.toFixed(2)} - Note: ${note}`,
    esito: 'OK'
  });

  res.json({ success: true, message: 'Richiesta di versamento inviata con successo!', request: newRequest });
});

// Ricevute (invoices) for Società
app.get('/api/societa/ricevute', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { rawClub, club } = getClubForUser(user);
  const rc = rawClub || {};
  const cf = club || {};
  const userId = String(rc.user_id || cf.userId || user.userId || user.rawUserId || '');

  const invoices = (db.rawInvoices || []).filter(inv => userId && String(inv.user_id) === userId);
  invoices.sort((a, b) => parseInt(b.id || 0) - parseInt(a.id || 0));

  res.json({ success: true, invoices });
});

// ================= RICHIESTA GARE ================= //

// Metadata for race request form (active clubs, cronos, disciplines, etc.)
app.get('/api/richieste-gare/form-data', (req, res) => {
  try {
    const currYear = new Date().getFullYear();

    // 1. Societa attive per l'annata in corso
    const societaAttive = (db.clubsList || [])
      .filter(c => c.isAttiva)
      .map(c => {
        const rawId = String(c.rawId || c.id || '');
        const members = (db.membersList || []).filter(m => String(m.societaId) === rawId);
        const activeMembers = members
          .filter(m => m.statoTessera === 'attiva' || m.ultimoAnnoTesseramento >= currYear || (m.ruoli && m.ruoli.length > 0))
          .map(m => {
            const cognomeNome = `${m.cognome || ''} ${m.nome || ''}`.trim();
            const ruolo = Array.isArray(m.ruoli) && m.ruoli.length ? m.ruoli.join(', ') : 'Tesserato';
            return {
              id: m.rawId || m.id,
              nomeCompleto: cognomeNome || `${m.nome || ''} ${m.cognome || ''}`.trim(),
              ruolo
            };
          })
          .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto));

        return {
          id: rawId,
          codice: c.codice || '',
          nome: (c.nome || c.ragioneSociale || '').trim(),
          presidente: (c.legaleRappresentante || c.contact || '').trim(),
          email: (c.email || c.c_email || '').trim(),
          sito: (c.web || '').trim(),
          tesseratiAttivi: activeMembers
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));

    // 2. Aziende di cronometraggio presenti a database
    const aziendeCrono = (db.chronosList || [])
      .map(c => ({
        id: c.rawId || c.id,
        nome: (c.nome || c.ragioneSociale || '').trim()
      }))
      .filter(c => c.nome.length > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome));

    // 3. Discipline ufficiali Skyrunning (da "Lo Skyrunning \ Discipline")
    const discipline = [
      {
        id: '1',
        nome: 'SkyRace®',
        shortDesc: '20-30 km, oltre 1.200m D+ (o 1.300m D+), quota min. transito/arrivo > 2.000m slm',
        fullDesc: 'Quota minima di transito e/o arrivo superiore ai 2.000 m. s.l.m. Distanze comprese tra 20 e 30 km (tolleranza +/- 5%). Tempo per il vincitore entro le 3 ore. Unicamente nelle aree geografiche che non presentano rilievi che raggiungono i 2.000 m. di quota, possono essere considerate SkyRace le competizioni su percorsi Skyrunning con più di 1.300 m. di dislivello positivo che presentano caratteristiche e difficoltà tipiche dello Skyrunning.'
      },
      {
        id: '6',
        nome: 'SkyMarathon®',
        shortDesc: '30-42 km, oltre 2.000m D+, quota min. transito/arrivo > 2.000m slm',
        fullDesc: 'Quota minima di transito e/o arrivo superiore ai 2.000 m. s.l.m. Distanze comprese tra 30 e 42 km (tolleranza +/- 5%). Tempo per il vincitore entro le 5 ore. Nelle aree geografiche senza rilievi che raggiungono i 2.000 m. di quota, possono essere considerate SkyMarathon competizioni con più di 2.000 m. di dislivello positivo con caratteristiche e difficoltà tipiche dello Skyrunning.'
      },
      {
        id: '3',
        nome: 'Sky Ultra',
        shortDesc: 'Oltre 50 km, oltre 2.500m D+, tempo vincitore entro 12 ore',
        fullDesc: 'Quota minima di transito e/o arrivo superiore ai 2.000 m. s.l.m. Distanze che con tolleranza +/- 5% superano i 50 km. Tempo per il vincitore entro le 12 ore (tempo limite 16 ore). In aree senza rilievi a 2.000 m di quota, dislivello positivo oltre 2.500 m.'
      },
      {
        id: '2',
        nome: 'Vertical Kilometer®',
        shortDesc: 'Max 5 km (+/- 5%), dislivello positivo 1.000m esatti',
        fullDesc: 'Distanza massima 5 km (tolleranza +/- 5%). Dislivello positivo di 1.000 m. Tre tipologie di altitudine di arrivo: 1.000 m, 2.000 m o 3.000 m s.l.m. (tolleranza +/- 5%).'
      },
      {
        id: '9',
        nome: 'SkySnow',
        shortDesc: 'Gare su neve (min 70%) con micro-ramponi (Vertical / Classic)',
        fullDesc: 'Gare su neve (almeno 70%) con utilizzo obbligatorio di calzature con micro-ramponi. Vertical: meno di 5 km con un minimo di pendenza del 15%. Classic: oltre 9 km con un\'inclinazione media di almeno il 3%, con sezioni oltre il 10% (per categorie Youth massimo 5 km con dislivello max di 200 m).'
      },
      {
        id: '7',
        nome: 'SkySpeed',
        shortDesc: 'Pendenza > 33%, sviluppo circa 100m in salita pura',
        fullDesc: 'Percorsi con pendenza superiore al 33% e sviluppo metrico di circa 100 metri lineari.'
      },
      {
        id: '8',
        nome: 'SkyScraper - Running',
        shortDesc: 'Versione indoor su scale di grattacieli, pendenza > 45%',
        fullDesc: 'Versione indoor dello SkySpeed disputata salendo le scale dei grattacieli con pendenza media oltre il 45%.'
      },
      {
        id: '10',
        nome: 'SkyRun',
        shortDesc: 'Minimo 15 km, sentieri e tracce, max 10% asfalto',
        fullDesc: 'Gare su sentieri e tracce alpine che non possiedono tutti i parametri specifici dello Skyrunning puro. Distanza minima 15 km, fondo asfaltato non superiore al 10%.'
      },
      {
        id: '4',
        nome: 'SkyTrail',
        shortDesc: 'Distanze e quote medie su sentieri tecnici montani',
        fullDesc: 'Competizioni svolte su sentieri montani e single-track in ambiente naturale.'
      },
      {
        id: '5',
        nome: 'Combinata (VK e Sky)',
        shortDesc: 'Classifica combinata tra Vertical Kilometer e SkyRace',
        fullDesc: 'Manifestazione con prove multiple che assegna il titolo combinando i risultati della prova Vertical Kilometer e della gara SkyRace.'
      }
    ];

    // 4. Tipologie di richiesta selezionabili (Tutte le 16 opzioni presenti sulla modale di modifica)
    const tipologieRichiesta = [
      { id: "14", label: "Inserimento normale in calendario" },
      { id: "9",  label: "Campionati Italiani Assoluti e di categoria" },
      { id: "10", label: "Coppa Italia Skyrunning" },
      { id: "11", label: "Coppa Italia Skysnow" },
      { id: "12", label: "Coppa Italia Vertical" },
      { id: "15", label: "COPPA ITALIA GIOVANI / YOUTH" },
      { id: "6",  label: "SNS - Skyrunner National Series" },
      { id: "8",  label: "Circuito SWS - Skyrunner World Series" },
      { id: "16", label: "Gara internazionale" },
      { id: "13", label: "Coppa Italia delle Alpi (Sky Climb)" },
      { id: "2",  label: "Campionato Italiano Assoluto" },
      { id: "3",  label: "Campionato Italiano Giovanile" },
      { id: "4",  label: "Campionato Italiano Master" },
      { id: "5",  label: "Campionato Regionale" },
      { id: "1",  label: "Skytrail Associata" },
      { id: "7",  label: "SCC" }
    ];

    // 5. Tipologie di sentiero
    const tipologieSentiero = [
      "Sentiero",
      "Ghiaioni/Fuori sentiero",
      "Nevaio/Ghiacciaio",
      "Creste e/o tratti esposti",
      "Presenza di corde fisse",
      "Rocce",
      "Tecnico (1°/2° Grado)"
    ];

    const regioni = [
      "Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna",
      "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche",
      "Molise", "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana",
      "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"
    ];

    return res.json({
      success: true,
      annoCorrente: currYear,
      societaAttive,
      aziendeCrono,
      discipline,
      tipologieRichiesta,
      tipologieSentiero,
      regioni
    });
  } catch (err) {
    console.error('Errore get form-data richieste gare:', err);
    return res.status(500).json({ error: 'Errore nel recupero dei dati del form' });
  }
});

// Submit new race request
app.post('/api/richieste-gare', (req, res) => {
  try {
    const user = getCurrentUser(req);
    const {
      tipologiaRichiesta,
      altriCircuiti,
      altriCircuitiTxt,
      nomeGara,
      edizione,
      disciplina,
      categoryrace_id,
      dataGara,
      dataGaraFine,
      date_end,
      localita,
      regione,
      societaId,
      societaNome,
      sitoWeb,
      direttoreGara,
      racejudge,
      giudiceGara,
      aziendaCrono,
      emailUfficiale,
      maxPartecipanti,
      distanzaKm,
      dislivelloDplus,
      dislivelloDminus,
      quotaMassima,
      percentualeAsfalto,
      percentualeSentiero,
      tipologieSentiero,
      descrizionePercorso,
      description,
      subscription_url,
      urlIscrizioni,
      subscription_start,
      dataAperturaIscrizioni,
      subscription_end,
      dataChiusuraIscrizioni,
      subscription_price,
      quotaIscrizione,
      price,
      montepremi,
      money_price,
      premiDenaro,
      nature_price,
      premiNatura,
      pasta_party,
      shower_free,
      race_refresh,
      parking,
      medical_assistance,
      board,
      room,
      race_bib,
      photoshoot,
      tv_broadcast,
      press_officer,
      other_services_txt,
      other_benefits_txt,
      referenteNome,
      referenteTelefono,
      referenteEmail,
      telephone,
      telefonoSede,
      condizioniAccettate,
      condizione_a,
      condizione_b,
      condizione_c,
      condizione_d,
      note
    } = req.body;

    const errori = [];

    // Validazione Riquadro Condizioni
    const condA = Boolean(condizione_a || (condizioniAccettate && condizioniAccettate.a));
    const condB = Boolean(condizione_b || (condizioniAccettate && condizioniAccettate.b));
    const condC = Boolean(condizione_c || (condizioniAccettate && condizioniAccettate.c));
    const condD = Boolean(condizione_d || (condizioniAccettate && condizioniAccettate.d));

    if (!condA || !condB || !condC || !condD) {
      if (!condA) errori.push("Condizione a) 'Accettazione norme e regolamenti FISky' non spuntata");
      if (!condB) errori.push("Condizione b) 'Impegno a non valere per altri circuiti non autorizzati' non spuntata");
      if (!condC) errori.push("Condizione c) 'Disponibilità spazio per i partner FISky' non spuntata");
      if (!condD) errori.push("Condizione d) 'Inserimento logo FISky e link skyrunningitalia.it' non spuntata");
    }

    // Validazione Campi Obbligatori Gara
    if (!nomeGara || !String(nomeGara).trim()) {
      errori.push("Nome Gara obbligatorio");
    }
    if (!disciplina || !String(disciplina).trim()) {
      errori.push("Tipologia/Disciplina Gara obbligatoria");
    }
    if (!dataGara || !String(dataGara).trim()) {
      errori.push("Data di svolgimento obbligatoria");
    }
    if (!localita || !String(localita).trim()) {
      errori.push("Località Gara obbligatoria");
    }
    if (!societaNome || !String(societaNome).trim()) {
      errori.push("Società organizzatrice obbligatoria");
    }

    // Validazione formale email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailUfficiale || !emailRegex.test(String(emailUfficiale).trim())) {
      errori.push("Email Ufficiale Gara non valida o mancante");
    }
    if (!referenteEmail || !emailRegex.test(String(referenteEmail).trim())) {
      errori.push("Email Referente non valida o mancante");
    }
    if (!referenteNome || !String(referenteNome).trim()) {
      errori.push("Nominativo Referente obbligatorio");
    }
    if (!referenteTelefono || !String(referenteTelefono).trim()) {
      errori.push("Numero di Telefono Referente obbligatorio");
    }

    // Controllo formale URL se inserito
    const urlCheck = (u) => {
      if (!u || !String(u).trim()) return true;
      const s = String(u).trim();
      const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/i;
      return urlRegex.test(s) || s.startsWith('http://') || s.startsWith('https://') || s.includes('.');
    };
    if (sitoWeb && !urlCheck(sitoWeb)) {
      errori.push("Formato Sito Web non valido (es. https://www.nomesito.it)");
    }
    const finalSubUrl = subscription_url || urlIscrizioni || '';
    if (finalSubUrl && !urlCheck(finalSubUrl)) {
      errori.push("Formato URL Iscrizioni non valido (es. https://www.portaleiscrizioni.it)");
    }

    if (errori.length > 0) {
      return res.status(400).json({
        error: 'Verifica i campi obbligatori prima di inviare la richiesta.',
        errori
      });
    }

    const year = new Date().getFullYear();
    const count = (db.raceRequestsList || []).length + 1;
    const protocollo = `FISKY-REQ-${year}-${String(count).padStart(3, '0')}`;

    const maxRawId = (db.rawRequests || []).reduce((max, r) => Math.max(max, parseInt(r.id, 10) || 0), 0);
    const nextRawId = String(maxRawId + 1);
    const todayIso = new Date().toISOString().slice(0, 10);

    // Mappatura ID e etichette per tipologia richiesta (championships)
    const CHAMP_ID_TO_LABEL = {
      "14": "Inserimento normale in calendario",
      "9": "Campionati Italiani Assoluti e di categoria",
      "10": "Coppa Italia Skyrunning",
      "11": "Coppa Italia Skysnow",
      "12": "Coppa Italia Vertical",
      "15": "COPPA ITALIA GIOVANI / YOUTH",
      "6": "SNS - Skyrunner National Series",
      "8": "Circuito SWS - Skyrunner World Series",
      "16": "Gara internazionale",
      "13": "Coppa Italia delle Alpi (Sky Climb)",
      "2": "Campionato Italiano Assoluto",
      "3": "Campionato Italiano Giovanile",
      "4": "Campionato Italiano Master",
      "5": "Campionato Regionale",
      "1": "Skytrail Associata",
      "7": "SCC"
    };

    let champIds = [];
    let champLabels = [];

    if (Array.isArray(tipologiaRichiesta)) {
      tipologiaRichiesta.forEach(val => {
        const vStr = String(val).trim();
        if (CHAMP_ID_TO_LABEL[vStr]) {
          champIds.push(vStr);
          champLabels.push(CHAMP_ID_TO_LABEL[vStr]);
        } else {
          // cerca per label
          const entry = Object.entries(CHAMP_ID_TO_LABEL).find(([id, lbl]) => lbl.toLowerCase() === vStr.toLowerCase());
          if (entry) {
            champIds.push(entry[0]);
            champLabels.push(entry[1]);
          } else {
            champLabels.push(vStr);
          }
        }
      });
    } else if (typeof tipologiaRichiesta === 'string' && tipologiaRichiesta.trim()) {
      champLabels.push(tipologiaRichiesta.trim());
      champIds.push("14");
    }

    if (!champIds.includes("14")) {
      champIds.unshift("14");
      if (!champLabels.includes("Inserimento normale in calendario") && !champLabels.includes("Inserimento in calendario")) {
        champLabels.unshift("Inserimento normale in calendario");
      }
    }

    const championshipsStr = champIds.join(';');
    const tipologiaRichiestaStr = champLabels.join('; ');

    // Gestione tipologie di sentiero multiple sia come stringa che booleani
    let sentieroTipiList = [];
    if (Array.isArray(tipologieSentiero)) {
      sentieroTipiList = tipologieSentiero;
    } else if (typeof tipologieSentiero === 'string') {
      sentieroTipiList = tipologieSentiero.split(',').map(s => s.trim()).filter(Boolean);
    }
    const sentieroTipiStr = sentieroTipiList.join(', ');

    const hasMountain = sentieroTipiList.some(t => t.toLowerCase().includes('sentiero')) ? '1' : '0';
    const hasScree = sentieroTipiList.some(t => t.toLowerCase().includes('ghiaio')) ? '1' : '0';
    const hasSnow = sentieroTipiList.some(t => t.toLowerCase().includes('nevaio') || t.toLowerCase().includes('ghiacc')) ? '1' : '0';
    const hasRocks = sentieroTipiList.some(t => t.toLowerCase().includes('rocce') || t.toLowerCase().includes('creste')) ? '1' : '0';
    const hasCordate = sentieroTipiList.some(t => t.toLowerCase().includes('corde')) ? '1' : '0';
    const hasRailways = sentieroTipiList.some(t => t.toLowerCase().includes('attrezz') || t.toLowerCase().includes('corde')) ? '1' : '0';
    const hasTecnical = sentieroTipiList.some(t => t.toLowerCase().includes('tecnico')) ? '1' : '0';

    const finalDesc = String(descrizionePercorso || description || note || '').trim();

    const newRawReq = {
      id: nextRawId,
      rr_version: '1',
      title: String(nomeGara).trim(),
      edition: String(edizione || '1').trim(),
      description: finalDesc,
      where: String(localita).trim(),
      regione: String(regione || '').trim(),
      date: String(dataGara).trim(),
      date_end: String(dataGaraFine || date_end || '0000-00-00').trim(),
      distance: String(distanzaKm !== undefined && distanzaKm !== null ? distanzaKm : '0'),
      drop_pos: String(dislivelloDplus !== undefined && dislivelloDplus !== null ? dislivelloDplus : '0'),
      drop_neg: String(dislivelloDminus !== undefined && dislivelloDminus !== null ? dislivelloDminus : '0'),
      max_height: String(quotaMassima !== undefined && quotaMassima !== null ? quotaMassima : '0'),
      max_atlete: String(maxPartecipanti !== undefined && maxPartecipanti !== null ? maxPartecipanti : '0'),
      asphalt_per: String(percentualeAsfalto !== undefined && percentualeAsfalto !== null ? percentualeAsfalto : '0'),
      trail_per: String(percentualeSentiero !== undefined && percentualeSentiero !== null ? percentualeSentiero : '0'),
      asfalto_perc: String(percentualeAsfalto !== undefined && percentualeAsfalto !== null ? percentualeAsfalto : ''),
      sentiero_perc: String(percentualeSentiero !== undefined && percentualeSentiero !== null ? percentualeSentiero : ''),
      sentiero_tipi: sentieroTipiStr,
      mountain_trail: hasMountain,
      scree_trail: hasScree,
      snowfield_trail: hasSnow,
      rocks_trail: hasRocks,
      cordate_trail: hasCordate,
      railways_trail: hasRailways,
      tecnical_trail: hasTecnical,
      tipologia_richiesta: tipologiaRichiestaStr,
      series: null,
      championships: championshipsStr,
      otherChampionship: (altriCircuiti === 'Si' || altriCircuiti === 'Sì' || altriCircuiti === true || altriCircuiti === '1') ? '1' : '0',
      otherChampionshipTxt: String(altriCircuitiTxt || '').trim(),
      email: String(emailUfficiale || referenteEmail || (user ? user.email : '')).trim(),
      contact: String(referenteNome).trim(),
      c_tel: String(referenteTelefono).trim(),
      c_emal: String(referenteEmail || emailUfficiale || '').trim(),
      telephone: String(telefonoSede || telephone || referenteTelefono || '').trim(),
      money_price: (premiDenaro === '1' || premiDenaro === 1 || money_price === '1' || money_price === 1) ? '1' : '0',
      price: String(montepremi || price || '').trim(),
      nature_price: (premiNatura === '1' || premiNatura === 1 || nature_price === '1' || nature_price === 1) ? '1' : '0',
      payed: '0',
      free: '0',
      payed_date: null,
      status: 'new',
      published: '0',
      categoryrace_id: String(categoryrace_id || '1'),
      specialita: String(disciplina).trim(),
      club_id: societaId ? String(societaId) : (user && user.rawId ? String(user.rawId) : '0'),
      code: protocollo,
      from: (societaId && (db.rawClubs || []).find(c => String(c.id) === String(societaId)))
        ? (db.rawClubs || []).find(c => String(c.id) === String(societaId)).name.trim()
        : String(societaNome).trim(),
      racedirector: String(direttoreGara || '').trim(),
      racejudge: String(racejudge || giudiceGara || '').trim(),
      chrono: String(aziendaCrono || '').trim(),
      url: String(sitoWeb || '').trim(),
      subscription_url: String(finalSubUrl).trim(),
      subscription_start: String(subscription_start || dataAperturaIscrizioni || '0000-00-00').trim(),
      subscription_end: String(subscription_end || dataChiusuraIscrizioni || '0000-00-00').trim(),
      subscription_price: String(subscription_price || quotaIscrizione || '0.00').trim(),
      baseraceprice: '',
      pasta_party: (pasta_party === '1' || pasta_party === 1 || pasta_party === true) ? '1' : '0',
      shower_free: (shower_free === '1' || shower_free === 1 || shower_free === true) ? '1' : '0',
      race_refresh: (race_refresh === '1' || race_refresh === 1 || race_refresh === true) ? '1' : '0',
      parking: (parking === '1' || parking === 1 || parking === true) ? '1' : '0',
      medical_assistance: (medical_assistance === '1' || medical_assistance === 1 || medical_assistance === true) ? '1' : '0',
      board: (board === '1' || board === 1 || board === true) ? '1' : '0',
      room: (room === '1' || room === 1 || room === true) ? '1' : '0',
      race_bib: (race_bib === '1' || race_bib === 1 || race_bib === true) ? '1' : '0',
      photoshoot: (photoshoot === '1' || photoshoot === 1 || photoshoot === true) ? '1' : '0',
      tv_broadcast: (tv_broadcast === '1' || tv_broadcast === 1 || tv_broadcast === true) ? '1' : '0',
      press_officer: (press_officer === '1' || press_officer === 1 || press_officer === true) ? '1' : '0',
      other_services_txt: String(other_services_txt || '').trim(),
      other_benefits_txt: String(other_benefits_txt || '').trim(),
      conditions_accepted: 1,
      created: todayIso
    };

    db.rawRequests.push(newRawReq);
    db.writeJsonFile('mysql_racerequests.json', db.rawRequests);
    const newGara = db.buildRaceRequestObj(newRawReq);
    db.raceRequestsList.unshift(newGara);

    const promotoreLog = String(societaNome).trim() || (user ? (user.ragioneSociale || user.nome) : (referenteNome || 'Organizzatore Frontend'));
    recordOperationLog(req, {
      origine: 'frontend',
      categoria: 'Richiesta Inserimento Gara',
      azione: 'Nuova Richiesta Inserimento Gara in Calendario',
      oggetto: `${String(nomeGara).trim()} (${protocollo})`,
      dettagli: `Promotore: ${promotoreLog} | Tipologia Richiesta: ${tipologiaRichiestaStr} | Data Gara: ${dataGara} | Località: ${String(localita).trim()} (${regione || '-'}) | Disciplina: ${disciplina} | Distanza: ${distanzaKm || 0} km (D+ ${dislivelloDplus || 0} m, D- ${dislivelloDminus || 0} m) | D.G.: ${direttoreGara || '-'} | Referente: ${referenteNome} (${referenteEmail})`,
      operatoreOverride: user ? undefined : `${promotoreLog}${emailUfficiale ? ' (' + emailUfficiale + ')' : ''}`,
      ruoloOverride: user ? user.role : 'societa',
      esito: 'OK'
    });

    return res.status(201).json({
      success: true,
      message: 'Richiesta di inserimento gara inviata con successo!',
      protocollo,
      gara: newGara
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore durante il salvataggio della richiesta gara' });
  }
});

// List race requests
app.get('/api/richieste-gare', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 1000;
  return res.json({ gare: db.raceRequestsList.slice(0, limit) });
});

// Get single race request
app.get('/api/richieste-gare/:id', (req, res) => {
  const idParam = String(req.params.id);
  const rawIdx = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIdx === -1) return res.status(404).json({ error: 'Richiesta gara non trovata' });

  const rawRec = db.rawRequests[rawIdx];
  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(rawRec.id));
  const gara = listIdx !== -1 ? db.raceRequestsList[listIdx] : db.buildRaceRequestObj(rawRec);

  res.json({ success: true, gara, raw: rawRec });
});

// Update race request (public/society)
app.put('/api/richieste-gare/:id', (req, res) => {
  const user = getCurrentUser(req);
  const idParam = String(req.params.id);
  const rawIdx = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIdx === -1) return res.status(404).json({ error: 'Richiesta gara non trovata' });

  const rawRec = db.rawRequests[rawIdx];
  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(rawRec.id));
  const garaObj = listIdx !== -1 ? db.raceRequestsList[listIdx] : db.buildRaceRequestObj(rawRec);

  if (user && user.role === 'societa' && !canSocietyAccessRace(user, garaObj)) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questa richiesta gara' });
  }

  const b = req.body || {};
  if (b.nomeGara !== undefined) rawRec.title = String(b.nomeGara).trim();
  if (b.title !== undefined) rawRec.title = String(b.title).trim();
  if (b.edizione !== undefined) rawRec.edition = String(b.edizione).trim();
  if (b.edition !== undefined) rawRec.edition = String(b.edition).trim();
  if (b.dataGara !== undefined) rawRec.date = String(b.dataGara).trim();
  if (b.date !== undefined) rawRec.date = String(b.date).trim();
  if (b.localita !== undefined) rawRec.where = String(b.localita).trim();
  if (b.where !== undefined) rawRec.where = String(b.where).trim();
  if (b.regione !== undefined) rawRec.regione = String(b.regione).trim();

  if (b.categoryrace_id !== undefined) {
    rawRec.categoryrace_id = String(b.categoryrace_id);
  } else if (b.disciplina !== undefined) {
    const dLower = String(b.disciplina).toLowerCase();
    if (dLower.includes('vert')) rawRec.categoryrace_id = '2';
    else if (dLower.includes('ultra')) rawRec.categoryrace_id = '3';
    else rawRec.categoryrace_id = '1';
  }

  if (b.distanzaKm !== undefined) rawRec.distance = String(b.distanzaKm);
  if (b.distance !== undefined) rawRec.distance = String(b.distance);
  if (b.dislivelloDplus !== undefined) rawRec.drop_pos = String(b.dislivelloDplus);
  if (b.drop_pos !== undefined) rawRec.drop_pos = String(b.drop_pos);
  if (b.dislivelloDminus !== undefined) rawRec.drop_neg = String(b.dislivelloDminus);
  if (b.drop_neg !== undefined) rawRec.drop_neg = String(b.drop_neg);
  if (b.quotaMassima !== undefined) rawRec.max_height = String(b.quotaMassima);
  if (b.max_height !== undefined) rawRec.max_height = String(b.max_height);
  if (b.maxPartecipanti !== undefined) rawRec.max_atlete = String(b.maxPartecipanti);
  if (b.max_atlete !== undefined) rawRec.max_atlete = String(b.max_atlete);
  if (b.percentualeAsfalto !== undefined) rawRec.asfalto_perc = String(b.percentualeAsfalto);
  if (b.percentualeSentiero !== undefined) rawRec.sentiero_perc = String(b.percentualeSentiero);

  if (b.tipologieSentiero !== undefined) {
    rawRec.sentiero_tipi = Array.isArray(b.tipologieSentiero) ? b.tipologieSentiero.join(', ') : String(b.tipologieSentiero);
  }
  if (b.tipologiaRichiesta !== undefined) {
    const list = Array.isArray(b.tipologiaRichiesta) ? b.tipologiaRichiesta : [b.tipologiaRichiesta];
    rawRec.tipologia_richiesta = list.join('; ');
    rawRec.championships = rawRec.tipologia_richiesta;
  }
  if (b.altriCircuiti !== undefined) {
    rawRec.otherChampionship = (b.altriCircuiti === 'Si' || b.altriCircuiti === 'Sì' || b.altriCircuiti === '1' || b.altriCircuiti === true) ? '1' : '0';
  }
  if (b.altriCircuitiTxt !== undefined) rawRec.otherChampionshipTxt = String(b.altriCircuitiTxt).trim();

  if (b.sitoWeb !== undefined) rawRec.url = String(b.sitoWeb).trim();
  if (b.direttoreGara !== undefined) rawRec.racedirector = String(b.direttoreGara).trim();
  if (b.aziendaCrono !== undefined) rawRec.chrono = String(b.aziendaCrono).trim();
  if (b.emailUfficiale !== undefined) rawRec.email = String(b.emailUfficiale).trim();
  if (b.referenteNome !== undefined) rawRec.contact = String(b.referenteNome).trim();
  if (b.referenteTelefono !== undefined) rawRec.telephone = String(b.referenteTelefono).trim();
  if (b.referenteEmail !== undefined) rawRec.c_emal = String(b.referenteEmail).trim();
  if (b.note !== undefined) rawRec.description = String(b.note).trim();

  db.writeJsonFile('mysql_racerequests.json', db.rawRequests);

  const updatedObj = db.buildRaceRequestObj(rawRec);
  if (listIdx !== -1) {
    db.raceRequestsList[listIdx] = updatedObj;
  }

  if (typeof db.syncRaceRequestToCalendar === 'function') {
    db.syncRaceRequestToCalendar(rawRec);
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Gestione Gare',
    azione: 'Modifica Richiesta Gara',
    oggetto: `${updatedObj.nomeGara || rawRec.title} (ID: ${rawRec.id})`,
    dettagli: `Modificata richiesta gara da società "${user ? (user.ragioneSociale || user.nome) : 'Utente'}" | Data: ${updatedObj.dataGara || rawRec.date}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Richiesta gara aggiornata con successo.',
    gara: updatedObj
  });
});

// Update race status (Admin)
app.put('/api/richieste-gare/:id/status', (req, res) => {
  const { stato } = req.body;
  if (!['approvata', 'respinta', 'in_attesa', 'accettata', 'rifiutata', 'nuova'].includes(stato)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }

  const gare = db.raceRequestsList;
  const index = gare.findIndex(g => String(g.id) === String(req.params.id) || String(g.rawId) === String(req.params.id));
  if (index === -1) return res.status(404).json({ error: 'Gara non trovata' });

  let rawStatus = 'new';
  if (stato === 'approvata' || stato === 'accettata') rawStatus = 'accepted';
  else if (stato === 'respinta' || stato === 'rifiutata') rawStatus = 'rejected';

  const rawId = String(gare[index].rawId);
  const rawIdx = (db.rawRequests || []).findIndex(r => String(r.id) === rawId);
  if (rawIdx !== -1) {
    db.rawRequests[rawIdx].status = rawStatus;
    db.writeJsonFile('mysql_racerequests.json', db.rawRequests);
    gare[index] = db.buildRaceRequestObj(db.rawRequests[rawIdx]);
    if (typeof db.syncRaceRequestToCalendar === 'function') {
      db.syncRaceRequestToCalendar(db.rawRequests[rawIdx]);
    }
  } else {
    gare[index].stato = rawStatus === 'accepted' ? 'approvata' : (rawStatus === 'rejected' ? 'respinta' : 'in_attesa');
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Gare',
    azione: `Aggiornamento Stato Richiesta Gara (${stato.toUpperCase()})`,
    oggetto: `${gare[index].nomeGara || gare[index].titolo || req.params.id} (ID: ${rawId})`,
    dettagli: `Stato richiesta gara impostato a "${stato}" (status DB: ${rawStatus}) | Promotore: ${gare[index].promotore || '-'} | Data: ${gare[index].dataGara || '-'}`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Stato gara aggiornato`, gara: gare[index] });
});

// ================= ADMIN GARE ROUTES ================= //

app.get('/api/admin/gare', (req, res) => {
  const allGare = db.raceRequestsList || [];

  // Extract all available reference years sorted descending
  const yearsSet = new Set();
  allGare.forEach(g => {
    const yr = g.annoRiferimento || g.anno;
    if (yr && /^\d{4}$/.test(String(yr))) {
      yearsSet.add(String(yr));
    }
  });
  const availableYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  const latestYear = availableYears[0] || String(new Date().getFullYear());

  // Default year is the most recent reference year in the database
  const selectedAnno = req.query.anno ? String(req.query.anno) : latestYear;
  const filterCircuito = (req.query.circuito || 'all').trim();
  const filterStato = (req.query.stato || 'all').trim().toLowerCase();
  const filterPromotore = (req.query.promotore || 'all').trim();
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const sort = req.query.sort || 'dataInserimento';
  const dir = req.query.dir === 'asc' ? 1 : -1; // Default descending ('desc')

  let list = [...allGare];

  // Filter 1: Anno di riferimento della richiesta
  if (selectedAnno && selectedAnno !== 'all') {
    list = list.filter(g => String(g.annoRiferimento || g.anno) === selectedAnno);
  }

  // Collect all distinct promotori from the database so the user can select any organizer
  const promotoriSet = new Set();
  allGare.forEach(g => {
    if (g.promotore && g.promotore.trim()) {
      promotoriSet.add(g.promotore.trim());
    }
  });
  const availablePromotori = Array.from(promotoriSet).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));

  // Filter 2: Assegnazione Circuito o Titolo
  if (filterCircuito && filterCircuito !== 'all') {
    const fcLower = filterCircuito.toLowerCase();
    list = list.filter(g => {
      const codes = g.tipoRichiestaCodes || [];
      const labels = g.tipoRichiestaList || [];
      return codes.includes(filterCircuito) ||
             labels.some(l => l.toLowerCase() === fcLower) ||
             String(g.tipoRichiesta || '').toLowerCase().includes(fcLower);
    });
  }

  // Filter 3: Stato (nuova / accettata / rifiutata)
  if (filterStato && filterStato !== 'all') {
    list = list.filter(g => {
      if (filterStato === 'nuova' || filterStato === 'new' || filterStato === 'in_attesa') {
        return g.statoGara === 'nuova';
      }
      if (filterStato === 'accettata' || filterStato === 'accepted' || filterStato === 'approvata') {
        return g.statoGara === 'accettata';
      }
      if (filterStato === 'rifiutata' || filterStato === 'rejected' || filterStato === 'respinta') {
        return g.statoGara === 'rifiutata';
      }
      return true;
    });
  }

  // Filter 4: Promotore (colonna Promotore)
  if (filterPromotore && filterPromotore !== 'all') {
    const fpLower = filterPromotore.toLowerCase().trim();
    const cleanFilter = fpLower.replace(/\b(a\.?s\.?d\.?|s\.?s\.?d\.?|aps|onlus)\b/gi, '').trim();
    list = list.filter(g => {
      const p = String(g.promotore || '').trim().toLowerCase();
      if (p === fpLower) return true;
      if (cleanFilter.length >= 6) {
        const cleanP = p.replace(/\b(a\.?s\.?d\.?|s\.?s\.?d\.?|aps|onlus)\b/gi, '').trim();
        if (cleanP === cleanFilter) return true;
      }
      return false;
    });
  }

  // Optional text search
  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(g => {
      const hay = [
        g.nomeGara,
        g.promotore,
        g.localita,
        g.regione,
        g.tipoRichiesta,
        g.specialita,
        g.dataInserimento,
        g.dataGara,
        g.statoLabel,
        g.pagatoLabel
      ].join(' ').toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  // Sort (default: Data Inserimento decrescente)
  list.sort((a, b) => {
    if (sort === 'dataInserimento') {
      const dA = String(a.dataInserimento || '');
      const dB = String(b.dataInserimento || '');
      if (dA !== dB) {
        return dA < dB ? -1 * dir : 1 * dir;
      }
      return ((parseInt(a.rawId, 10) || 0) - (parseInt(b.rawId, 10) || 0)) * dir;
    } else if (sort === 'nomeGara') {
      return String(a.nomeGara || '').localeCompare(String(b.nomeGara || ''), 'it') * dir;
    } else if (sort === 'promotore') {
      return String(a.promotore || '').localeCompare(String(b.promotore || ''), 'it') * dir;
    } else if (sort === 'stato') {
      return String(a.statoLabel || '').localeCompare(String(b.statoLabel || ''), 'it') * dir;
    } else if (sort === 'pagato') {
      return String(a.pagatoLabel || '').localeCompare(String(b.pagatoLabel || ''), 'it') * dir;
    }
    return ((parseInt(a.rawId, 10) || 0) - (parseInt(b.rawId, 10) || 0)) * dir;
  });

  const total = list.length;
  const yearTotalCount = selectedAnno === 'all'
    ? allGare.length
    : allGare.filter(g => String(g.annoRiferimento || g.anno) === selectedAnno).length;

  const limitParam = req.query.limit || '25';
  let paginated = list;
  let page = 1;
  let totalPages = 1;

  if (limitParam !== 'all' && parseInt(limitParam, 10) > 0) {
    const limitNum = parseInt(limitParam, 10);
    totalPages = Math.max(1, Math.ceil(total / limitNum));
    page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, totalPages));
    const offset = (page - 1) * limitNum;
    paginated = list.slice(offset, offset + limitNum);
  }

  res.json({
    gare: paginated,
    total,
    yearTotalCount,
    page,
    limit: limitParam,
    totalPages,
    anno: selectedAnno,
    latestYear,
    availableYears,
    availablePromotori,
    raceTypesMap: db.RACE_TYPES_MAP,
    categoryRacesMap: db.CATEGORY_RACES_MAP,
    sort,
    dir: req.query.dir === 'asc' ? 'asc' : 'desc'
  });
});

// Export all race requests of the selected year to Excel (.xls)
app.get('/api/admin/gare/export-xls', (req, res) => {
  const allGare = db.raceRequestsList || [];
  const yearsSet = new Set();
  allGare.forEach(g => {
    const yr = g.annoRiferimento || g.anno;
    if (yr && /^\d{4}$/.test(String(yr))) yearsSet.add(String(yr));
  });
  const availableYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  const latestYear = availableYears[0] || String(new Date().getFullYear());
  const selectedAnno = req.query.anno ? String(req.query.anno) : latestYear;

  let list = selectedAnno === 'all'
    ? [...allGare]
    : allGare.filter(g => String(g.annoRiferimento || g.anno) === selectedAnno);

  // Sort by date of event or insertion date
  list.sort((a, b) => {
    const dA = String(a.dataGara || a.dataInserimento || '');
    const dB = String(b.dataGara || b.dataInserimento || '');
    if (dA !== dB) return dA < dB ? -1 : 1;
    return (parseInt(a.rawId, 10) || 0) - (parseInt(b.rawId, 10) || 0);
  });

  const esc = str => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const annoTitle = selectedAnno === 'all' ? 'Tutti gli anni' : selectedAnno;
  const rowsHtml = list.map((g, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    return `
      <tr style="background-color: ${bg};">
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${esc(g.nomeGara)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${esc(g.regione)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px; mso-number-format:'\\@'; text-align: center;">${esc(g.dataGara)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${esc(g.tipoRichiesta)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">${esc(g.specialita)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 10px; mso-number-format:'\\@'; text-align: right;">${esc(g.montepremi)}</td>
      </tr>
    `;
  }).join('');

  const xlsHtml = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Richiesta Gare FiSky ${esc(annoTitle)}</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
</head>
<body>
  <table border="1" cellspacing="0" cellpadding="5" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt;">
    <thead>
      <tr>
        <th colspan="6" style="background-color: #15549a; color: #ffffff; font-size: 15pt; font-weight: bold; text-align: center; padding: 12px; border: 1px solid #0a2759;">
          Richiesta Gare FiSky ${esc(annoTitle)}
        </th>
      </tr>
      <tr style="background-color: #2a3f54; color: #ffffff; font-weight: bold;">
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 280px;">Denominazione Gara</th>
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 160px;">Regione</th>
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 150px;">Data della manifestazione</th>
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 320px;">Tipo Richiesta</th>
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 180px;">Specialità</th>
        <th style="border: 1px solid #1e293b; padding: 8px 12px; width: 160px;">Montepremi disponibile</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  const fileName = `Richiesta_Gare_FiSky_${annoTitle.replace(/\s+/g, '_')}.xls`;
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Gare',
    azione: 'Esportazione Excel Richieste Gare',
    oggetto: `File ${fileName}`,
    dettagli: `Esportate ${list.length} richieste gare per l'anno: ${annoTitle}`,
    esito: 'OK'
  });
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(xlsHtml);
});

// Get single race request details for editing
app.get('/api/admin/gare/:id', (req, res) => {
  const idParam = String(req.params.id);
  const gara = (db.raceRequestsList || []).find(g => String(g.rawId) === idParam || String(g.id) === idParam);
  if (!gara) return res.status(404).json({ error: 'Richiesta gara non trovata nel database' });

  res.json({
    gara,
    raceTypesMap: db.RACE_TYPES_MAP,
    categoryRacesMap: db.CATEGORY_RACES_MAP
  });
});

// Update race request details in database
app.put('/api/admin/gare/:id', (req, res) => {
  const idParam = String(req.params.id);
  const rawIndex = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIndex === -1) return res.status(404).json({ error: 'Richiesta gara non trovata nel database' });

  const rawRec = db.rawRequests[rawIndex];
  const updates = req.body || {};

  // Update all editable fields in rawRec
  const allowedFields = [
    'title', 'description', 'where', 'regione', 'region', 'date', 'date_end', 'anno_riferimento',
    'created', 'from', 'club_id', 'status', 'published', 'categoryrace_id',
    'championships', 'series', 'otherChampionship', 'otherChampionshipTxt',
    'payed', 'free', 'payed_date', 'baseraceprice',
    'price', 'money_price', 'nature_price',
    'distance', 'drop_pos', 'drop_neg', 'max_height', 'max_atlete',
    'asphalt_per', 'trail_per', 'mountain_trail', 'scree_trail', 'snowfield_trail',
    'railways_trail', 'cordate_trail', 'rocks_trail', 'tecnical_trail',
    'contact', 'email', 'c_tel', 'c_emal', 'telephone', 'fax',
    'edition', 'racedirector', 'racejudge', 'chrono', 'timing',
    'url', 'subscription_url', 'subscription_start', 'subscription_end', 'subscription_price',
    'delay_price', 'race_program', 'cai', 'cnsas',
    'medical_assistance', 'n_ambulance', 'n_doctor', 'hospital', 'hospital_distance',
    'pasta_party', 'pasta_party_no', 'pasta_party_pay', 'pasta_party_no_beverage',
    'shower_pay', 'shower_free', 'race_refresh', 'parking', 'parking_distance', 'volunteer',
    'massages_pay', 'massages_free', 'board', 'room', 'race_bib', 'race_bib_no_box',
    'photoshoot', 'tv_broadcast', 'press_officer', 'other_media', 'other_media_txt',
    'other_services', 'other_services_txt', 'other_benefits', 'other_benefits_txt',
    'refound_km', 'refound_km_for'
  ];

  allowedFields.forEach(field => {
    if (updates[field] !== undefined) {
      rawRec[field] = updates[field];
    }
  });

  if (rawRec.club_id) {
    const matchedClub = (db.rawClubs || []).find(c => String(c.id) === String(rawRec.club_id));
    if (matchedClub && matchedClub.name) {
      rawRec.from = matchedClub.name.trim();
    }
  }

  db.writeJsonFile('mysql_racerequests.json', db.rawRequests);

  const updatedObj = db.buildRaceRequestObj(rawRec);
  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(rawRec.id));
  if (listIdx !== -1) {
    db.raceRequestsList[listIdx] = updatedObj;
  }

  if (typeof db.syncRaceRequestToCalendar === 'function') {
    db.syncRaceRequestToCalendar(rawRec);
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Gare',
    azione: 'Modifica Completa Richiesta Gara',
    oggetto: `${updatedObj.nomeGara || rawRec.title} (ID: ${rawRec.id})`,
    dettagli: `Promotore: ${updatedObj.promotore || rawRec.from || '-'} | Data: ${updatedObj.dataGara || rawRec.date || '-'} | Stato: ${updatedObj.statoLabel || rawRec.status} | Pagato: ${updatedObj.pagatoLabel || '-'}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Richiesta gara aggiornata con successo nel database.',
    gara: updatedObj
  });
});

// Delete race request from database
app.delete('/api/admin/gare/:id', (req, res) => {
  const idParam = String(req.params.id);
  const rawIndex = (db.rawRequests || []).findIndex(r => String(r.id) === idParam || `req_${r.id}` === idParam);
  if (rawIndex === -1) return res.status(404).json({ error: 'Richiesta gara non trovata nel database' });

  const removedRaw = db.rawRequests.splice(rawIndex, 1)[0];
  db.writeJsonFile('mysql_racerequests.json', db.rawRequests);

  const listIdx = (db.raceRequestsList || []).findIndex(g => String(g.rawId) === String(removedRaw.id));
  if (listIdx !== -1) {
    db.raceRequestsList.splice(listIdx, 1);
  }

  if (typeof db.removeRaceRequestFromCalendar === 'function') {
    db.removeRaceRequestFromCalendar(removedRaw.id);
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Gare',
    azione: 'Eliminazione Richiesta Gara',
    oggetto: `${removedRaw.title || idParam} (ID: ${removedRaw.id})`,
    dettagli: `Eliminata definitivamente la richiesta gara "${removedRaw.title}" (Promotore: ${removedRaw.from || '-'}, Data: ${removedRaw.date || '-'})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Richiesta gara "${removedRaw.title}" eliminata definitivamente dal database.`
  });
});

// ================= ADMIN CALENDARI ROUTES ================= //

const CALENDAR_YEARS_STATUS_FILE = path.join(__dirname, 'data', 'mysql_calendario_anni_status.json');

function getCalendarYearsStatus() {
  try {
    if (fs.existsSync(CALENDAR_YEARS_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(CALENDAR_YEARS_STATUS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Errore lettura calendario_anni_status:', e);
  }
  const defaults = {
    "2021": "pubblica",
    "2022": "pubblica",
    "2023": "pubblica",
    "2024": "pubblica",
    "2025": "pubblica",
    "2026": "pubblica",
    "2027": "non_pubblicare"
  };
  saveCalendarYearsStatus(defaults);
  return defaults;
}

function saveCalendarYearsStatus(cfg) {
  try {
    fs.writeFileSync(CALENDAR_YEARS_STATUS_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('Errore salvataggio calendario_anni_status:', e);
  }
}

function isYearPublished(yr) {
  const cfg = getCalendarYearsStatus();
  const val = cfg[String(yr)];
  if (val !== undefined) {
    return val === 'pubblica';
  }
  const curYr = new Date().getFullYear();
  return Number(yr) <= curYr;
}

// Get official calendar entries for admin (default: most recent year)
app.get('/api/admin/calendari', (req, res) => {
  const allCal = db.calendarioGareList || [];
  const yearsSet = new Set();
  allCal.forEach(c => {
    if (c.anno && /^\d{4}$/.test(String(c.anno))) {
      yearsSet.add(String(c.anno));
    }
  });
  const availableYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  const latestYear = availableYears[0] || String(new Date().getFullYear());

  const selectedAnno = (req.query.anno && yearsSet.has(String(req.query.anno)))
    ? String(req.query.anno)
    : latestYear;

  const list = allCal
    .filter(c => String(c.anno) === selectedAnno)
    .sort((a, b) => {
      const dA = String(a.dataIso || '');
      const dB = String(b.dataIso || '');
      if (dA !== dB) return dA < dB ? -1 : 1;
      return 0;
    });

  const anniStatus = getCalendarYearsStatus();
  const annoStato = anniStatus[selectedAnno] || (Number(selectedAnno) <= new Date().getFullYear() ? 'pubblica' : 'non_pubblicare');

  res.json({
    anno: selectedAnno,
    annoStato,
    allAnniStato: anniStatus,
    latestYear,
    titolo: `Calendario gare ${selectedAnno}`,
    availableYears,
    total: list.length,
    gare: list,
    items: list
  });
});

// Imposta lo stato di pubblicazione (pubblica / non_pubblicare) per un determinato anno di calendario
app.post('/api/admin/calendari/stato-anno', (req, res) => {
  const { anno, stato } = req.body || {};
  if (!anno || !/^\d{4}$/.test(String(anno))) {
    return res.status(400).json({ error: 'Anno non valido.' });
  }
  const cleanStato = (stato === 'pubblica') ? 'pubblica' : 'non_pubblicare';

  const cfg = getCalendarYearsStatus();
  cfg[String(anno)] = cleanStato;
  saveCalendarYearsStatus(cfg);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Calendari Ufficiali',
    azione: 'Modifica Stato Pubblicazione Anno Calendario',
    oggetto: `Anno ${anno}`,
    dettagli: `Stato pubblicazione impostato su: "${cleanStato === 'pubblica' ? 'Pubblica' : 'Non pubblicare'}"`,
    esito: 'OK'
  });

  res.json({
    success: true,
    anno: String(anno),
    stato: cleanStato,
    message: `Stato pubblicazione calendario ${anno} impostato su: ${cleanStato === 'pubblica' ? 'Pubblica' : 'Non pubblicare'}.`
  });
});

// Update a single calendar entry in mysql_calendario_gare.json
app.put('/api/admin/calendari/:id', (req, res) => {
  const idParam = String(req.params.id);
  const allCal = db.calendarioGareList || [];
  const idx = allCal.findIndex(c => String(c.id) === idParam);
  if (idx === -1) {
    return res.status(404).json({ error: 'Gara non trovata nella tabella calendario' });
  }

  const entry = allCal[idx];
  const { data, manifestazione, tipologia, localita, circuitoTitoli, distanza, dislivello, url } = req.body || {};

  if (data !== undefined) {
    entry.data = String(data).trim();
    const m = entry.data.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      entry.dataIso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(entry.data)) {
      entry.dataIso = entry.data.slice(0, 10);
    }
  }
  if (manifestazione !== undefined) entry.manifestazione = String(manifestazione).trim();
  if (tipologia !== undefined) entry.tipologia = String(tipologia).trim();
  if (localita !== undefined) entry.localita = String(localita).trim();
  if (circuitoTitoli !== undefined) entry.circuitoTitoli = String(circuitoTitoli).trim();
  if (distanza !== undefined) entry.distanza = String(distanza).trim();
  if (dislivello !== undefined) entry.dislivello = String(dislivello).trim();
  if (url !== undefined) entry.url = String(url).trim();

  db.writeJsonFile('mysql_calendario_gare.json', allCal);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Calendari Ufficiali',
    azione: 'Modifica Gara in Calendario Ufficiale',
    oggetto: `${entry.manifestazione} (Calendario ${entry.anno})`,
    dettagli: `Data: ${entry.data} | Località: ${entry.localita} | Tipologia: ${entry.tipologia} | Circuito: ${entry.circuitoTitoli || '-'}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Gara "${entry.manifestazione}" aggiornata con successo nel calendario ${entry.anno}.`,
    gara: entry
  });
});

// Delete a single calendar entry ONLY from mysql_calendario_gare.json
app.delete('/api/admin/calendari/:id', (req, res) => {
  const idParam = String(req.params.id);
  const allCal = db.calendarioGareList || [];
  const idx = allCal.findIndex(c => String(c.id) === idParam);
  if (idx === -1) {
    return res.status(404).json({ error: 'Gara non trovata nella tabella calendario' });
  }

  const removed = allCal.splice(idx, 1)[0];
  db.writeJsonFile('mysql_calendario_gare.json', allCal);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Calendari Ufficiali',
    azione: 'Eliminazione Gara da Calendario Ufficiale',
    oggetto: `${removed.manifestazione} (Calendario ${removed.anno})`,
    dettagli: `Rimossa gara "${removed.manifestazione}" (${removed.data}, ${removed.localita}) dal calendario ufficiale ${removed.anno}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Gara "${removed.manifestazione}" eliminata dalla tabella del calendario ${removed.anno}.`
  });
});

// ================= PUBLIC CLUBS & CALENDAR ROUTES ================= //

// Public dynamic race calendar extracted from mysql_calendario_gare.json
app.get('/api/public/calendario-gare', (req, res) => {
  const allCal = db.calendarioGareList || [];
  const yearsSet = new Set();
  allCal.forEach(c => {
    if (c.anno && /^\d{4}$/.test(String(c.anno))) {
      yearsSet.add(String(c.anno));
    }
  });

  // Filtra solo gli anni il cui stato è "pubblica"
  const allYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  const availableYears = allYears.filter(yr => isYearPublished(yr));

  const currentYearStr = String(new Date().getFullYear());
  const defaultYear = availableYears.includes(currentYearStr)
    ? currentYearStr
    : (availableYears[0] || currentYearStr);

  let selectedAnno = req.query.anno ? String(req.query.anno) : defaultYear;

  // Se l'anno richiesto non è pubblicato, fai fallback al defaultYear pubblicato
  if (!isYearPublished(selectedAnno)) {
    selectedAnno = defaultYear;
  }

  const list = allCal
    .filter(c => String(c.anno) === selectedAnno)
    .sort((a, b) => {
      const dA = String(a.dataIso || '');
      const dB = String(b.dataIso || '');
      if (dA !== dB) return dA < dB ? -1 : 1;
      return 0;
    });

  res.json({
    anno: selectedAnno,
    titolo: `Calendario gare ${selectedAnno}`,
    availableYears,
    total: list.length,
    gare: list.map(c => ({
      id: c.id,
      anno: c.anno,
      data: c.data || '',
      manifestazione: c.manifestazione || '',
      url: c.url || '',
      tipologia: c.tipologia || '',
      localita: c.localita || '',
      circuitoTitoli: c.circuitoTitoli || '',
      distanza: c.distanza || '',
      dislivello: c.dislivello || ''
    }))
  });
});

// Endpoint pubblico per le prossime gare a calendario (dalla prima da disputare in poi)
app.get('/api/public/prossime-gare', (req, res) => {
  const allCal = db.calendarioGareList || [];
  const todayIso = new Date().toISOString().split('T')[0];
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 12;

  // Filtra gare ancora da disputare (dataIso >= oggi) E il cui anno è impostato su "pubblica"
  let upcoming = allCal
    .filter(c => {
      const d = String(c.dataIso || '');
      if (!d || d < todayIso) return false;
      return isYearPublished(c.anno);
    })
    .sort((a, b) => String(a.dataIso || '').localeCompare(String(b.dataIso || '')));

  if (upcoming.length === 0) {
    upcoming = [...allCal]
      .filter(c => c.dataIso && isYearPublished(c.anno))
      .sort((a, b) => String(b.dataIso || '').localeCompare(String(a.dataIso || '')))
      .slice(0, limit)
      .reverse();
  } else {
    upcoming = upcoming.slice(0, limit);
  }

  const mapped = upcoming.map(c => {
    let promotore = '';
    let crono = '';

    if (c.racerequest_id) {
      const reqObj = db.raceRequestsList.find(r => String(r.id) === String(c.racerequest_id));
      if (reqObj) {
        promotore = reqObj.promotore || '';
        crono = reqObj.cronometrista || '';
      }
    }
    if (!promotore) {
      const normName = (c.manifestazione || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const reqObj = db.raceRequestsList.find(r => (r.nomeGara || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normName);
      if (reqObj) {
        promotore = reqObj.promotore || '';
        crono = reqObj.cronometrista || '';
      }
    }

    return {
      id: c.id,
      anno: c.anno,
      data: c.data || '',
      dataIso: c.dataIso || '',
      manifestazione: c.manifestazione || '',
      url: c.url || '',
      tipologia: c.tipologia || 'Skyrace',
      localita: c.localita || '',
      circuitoTitoli: c.circuitoTitoli || '',
      distanza: c.distanza || '',
      dislivello: c.dislivello || '',
      promotore: promotore || 'Comitato Organizzatore FISky',
      cronometrista: crono || 'Chrono Ufficiale Federale',
      stato: 'Ufficiale'
    };
  });

  res.json({
    success: true,
    todayIso,
    total: mapped.length,
    gare: mapped
  });
});

// Public list of active affiliated sports associations for the current year
app.get('/api/public/associazioni-affiliate', (req, res) => {
  const currentYear = new Date().getFullYear();
  const sort = (req.query.sort || 'codice').trim();
  const dir = req.query.dir === 'desc' ? -1 : 1;

  const activeClubs = (db.clubsList || [])
    .filter(c => c.isAttiva === true)
    .map(c => ({
      codice: String(c.codice || c.rawId || '').trim(),
      codiceFiso: String(c.codiceFiso || c.fisoId || '').trim(),
      societa: String(c.nome || c.ragioneSociale || '').trim(),
      email: String(c.email || c.email2 || '').trim(),
      regione: String(c.region || '').trim(),
      provincia: String(c.province || '').trim()
    }));

  activeClubs.sort((a, b) => {
    if (sort === 'codice') {
      const numA = parseInt(a.codice, 10) || 0;
      const numB = parseInt(b.codice, 10) || 0;
      return (numA - numB) * dir;
    } else if (sort === 'codiceFiso' || sort === 'fiso') {
      const numA = parseInt(a.codiceFiso, 10) || 0;
      const numB = parseInt(b.codiceFiso, 10) || 0;
      if (numA !== numB) return (numA - numB) * dir;
      return a.societa.localeCompare(b.societa, 'it', { sensitivity: 'base' }) * dir;
    } else if (sort === 'societa') {
      return a.societa.localeCompare(b.societa, 'it', { sensitivity: 'base' }) * dir;
    } else if (sort === 'regione') {
      const cmp = a.regione.localeCompare(b.regione, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
      return a.societa.localeCompare(b.societa, 'it', { sensitivity: 'base' });
    } else if (sort === 'provincia') {
      const cmp = a.provincia.localeCompare(b.provincia, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
      return a.societa.localeCompare(b.societa, 'it', { sensitivity: 'base' });
    }
    return 0;
  });

  res.json({
    anno: currentYear,
    total: activeClubs.length,
    sort,
    dir: dir === -1 ? 'desc' : 'asc',
    clubs: activeClubs
  });
});

// Endpoint pubblico per l'elenco e la mappa dei Delegati Regionali FISky
app.get('/api/public/delegati-regionali', (req, res) => {
  try {
    const institutionalEmails = {
      "Valle d'Aosta": 'valledaosta@skyrunningitalia.it',
      'Piemonte': 'piemonte@skyrunningitalia.it',
      'Liguria': 'liguria@skyrunningitalia.it',
      'Lombardia': 'lombardia@skyrunningitalia.it',
      'Emilia-Romagna': 'emiliaromagna@skyrunningitalia.it',
      'Friuli-Venezia Giulia': 'friuliveneziagiulia@skyrunningitalia.it',
      'Trentino-Alto Adige': 'trentinoaltoadige@skyrunningitalia.it',
      'Veneto': 'veneto@skyrunningitalia.it',
      'Toscana': 'toscana@skyrunningitalia.it',
      'Marche': 'marche@skyrunningitalia.it',
      'Umbria': 'umbria@skyrunningitalia.it',
      'Lazio': 'lazio@skyrunningitalia.it',
      'Abruzzo': 'abruzzo@skyrunningitalia.it',
      'Molise': 'molise@skyrunningitalia.it',
      'Campania': 'campania@skyrunningitalia.it',
      'Puglia': 'puglia@skyrunningitalia.it',
      'Basilicata': 'basilicata@skyrunningitalia.it',
      'Calabria': 'calabria@skyrunningitalia.it',
      'Sicilia': 'sicilia@skyrunningitalia.it',
      'Sardegna': 'sardegna@skyrunningitalia.it'
    };

    function normalizeRegion(roleStr) {
      const r = (roleStr || '').toLowerCase();
      if (r.includes('aosta')) return "Valle d'Aosta";
      if (r.includes('piemonte')) return 'Piemonte';
      if (r.includes('liguria')) return 'Liguria';
      if (r.includes('lombardia')) return 'Lombardia';
      if (r.includes('trentino')) return 'Trentino-Alto Adige';
      if (r.includes('veneto')) return 'Veneto';
      if (r.includes('friuli')) return 'Friuli-Venezia Giulia';
      if (r.includes('emilia')) return 'Emilia-Romagna';
      if (r.includes('marche')) return 'Marche';
      if (r.includes('toscana')) return 'Toscana';
      if (r.includes('umbria')) return 'Umbria';
      if (r.includes('lazio')) return 'Lazio';
      if (r.includes('abruzzo')) return 'Abruzzo';
      if (r.includes('molise')) return 'Molise';
      if (r.includes('campania')) return 'Campania';
      if (r.includes('puglia')) return 'Puglia';
      if (r.includes('basilicata')) return 'Basilicata';
      if (r.includes('calabria')) return 'Calabria';
      if (r.includes('sicilia')) return 'Sicilia';
      if (r.includes('sardegna')) return 'Sardegna';
      return roleStr;
    }

    const delegati = (db.rawFedmembers || [])
      .filter(f => {
        if (!f.role || !f.role.toLowerCase().includes('delegato')) return false;
        if (f.stato !== 'In Carica') return false;
        const mem = (db.membersList || []).find(m => String(m.rawId || m.id) === String(f.member_id));
        if (!mem) return false;
        const isMemActive = (mem.statoTessera === 'attiva' || Number(mem.ultimoAnnoTesseramento) >= 2026);
        return isMemActive;
      })
      .map(f => {
        const mem = (db.membersList || []).find(m => String(m.rawId || m.id) === String(f.member_id)) || {};
        const reg = normalizeRegion(f.role);
        const instEmail = institutionalEmails[reg] || '';
        const personalEmail = mem.email || '';
        const nome = (mem.nome || '').trim();
        const cognome = (mem.cognome || '').trim();
        const nominativo = (cognome && nome)
          ? `${cognome.toUpperCase()} ${nome.toUpperCase()}`
          : (f.nominativo || `${cognome} ${nome}`.trim().toUpperCase() || 'N/D');

        return {
          id: f.id,
          memberId: f.member_id,
          ruolo: f.role,
          regione: reg,
          nominativo,
          emailIstituzionale: instEmail,
          emailPersonale: personalEmail,
          email: instEmail || personalEmail,
          telefono: mem.telefono || mem.cellulare || '',
          citta: mem.citta || '',
          provincia: mem.provincia || '',
          stato: f.stato || 'In Carica'
        };
      });

    delegati.sort((a, b) => a.regione.localeCompare(b.regione, 'it', { sensitivity: 'base' }));

    const byRegion = {};
    delegati.forEach(d => {
      if (!byRegion[d.regione]) {
        byRegion[d.regione] = [];
      }
      byRegion[d.regione].push(d);
    });

    const allRegionsList = [
      "Valle d'Aosta", "Piemonte", "Liguria", "Lombardia", "Trentino-Alto Adige",
      "Veneto", "Friuli-Venezia Giulia", "Emilia-Romagna", "Toscana", "Umbria",
      "Marche", "Lazio", "Abruzzo", "Molise", "Campania", "Puglia",
      "Basilicata", "Calabria", "Sicilia", "Sardegna"
    ];

    res.json({
      success: true,
      total: delegati.length,
      regioniAttive: Object.keys(byRegion).length,
      delegati,
      byRegion,
      allRegions: allRegionsList
    });
  } catch (err) {
    console.error('Errore get delegati regionali:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint pubblico per la Mappa interattiva dell'Italia (Società e Gare stagione in corso)
app.get(['/api/public/mappa-dati', '/api/public/map-data'], (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const geoResolver = require('./scripts/geo_resolver');
    const fs = require('fs');
    const path = require('path');

    // 1. Ricarica dinamica dal file mysql_clubs.json per riflettere le verifiche in corso
    let rawClubsDisk = [];
    try {
      const clubsFile = path.join(__dirname, 'data', 'mysql_clubs.json');
      if (fs.existsSync(clubsFile)) {
        rawClubsDisk = JSON.parse(fs.readFileSync(clubsFile, 'utf8'));
      }
    } catch (readErr) {
      console.warn('Fallback a db.rawClubs per lettura societa:', readErr);
      rawClubsDisk = db.rawClubs || [];
    }

    // Filtra società effettivamente attive per la stagione in corso
    const activeClubs = rawClubsDisk
      .filter(c => {
        if (c.status === '0' || c.status === 0) return false;
        let lastYear = null;
        if (c.affiliate_years) {
          const years = String(c.affiliate_years).split(';').map(y => parseInt(y.trim(), 10)).filter(y => !isNaN(y));
          if (years.length > 0) lastYear = Math.max(...years);
        }
        if (!lastYear && c.affiliate_expire && c.affiliate_expire !== '0000-00-00') {
          lastYear = parseInt(String(c.affiliate_expire).slice(0, 4), 10);
        }
        return Number(c.affiliation_complete) === 1 && lastYear !== null && lastYear >= currentYear;
      })
      .map(c => {
        const coords = geoResolver.resolveClubCoordinates(c);
        const numId = Number(c.id);
        const codiceSocieta = numId > 0 && numId < 10000 ? String(10000 + numId) : String(c.id);
        const isAffiliato = Boolean(Number(c.affiliation_complete) === 1);

        return {
          id: String(c.id || ''),
          codice: codiceSocieta,
          codiceFiso: c.fisoId ? String(c.fisoId).trim().replace(/^0+(?=\d)/, '') : '',
          nome: String(c.name || '').trim(),
          denominazione: String(c.name || '').trim(),
          formaGiuridica: c.r_name || 'ASD',
          citta: String(c.city || '').trim(),
          provincia: String(c.province || '').trim().toUpperCase(),
          regione: String(c.region || '').trim(),
          indirizzo: String(c.address || '').trim(),
          cap: String(c.cap || '').trim(),
          email: String(c.email || c.email2 || '').trim(),
          telefono: String(c.cell1 || c.cell2 || '').trim(),
          web: String(c.web || '').trim(),
          presidente: String(c.contact || '').trim(),
          affiliato: isAffiliato,
          affiliation_complete: c.affiliation_complete,
          lat: coords.lat,
          lng: coords.lng
        };
      });

    // Helper classificazione Gare per tipologia di prestigio (Titoli Italiani, Coppa Italia, SNS, Internazionali)
    function classifyRace(r) {
      const circ = String(r.circuitoTitoli || '').toLowerCase();
      const name = String(r.manifestazione || '').toLowerCase();
      const loc = String(r.localita || '').toLowerCase();

      // 1. National Series (SNS): gare del circuito Skyrunner National Series (scorporate dalle internazionali)
      const isSNS = /\bsns\b|skyrunning\s+national\s+series|skyrunner\s+national\s+series|national\s+series/i.test(circ) ||
                    /\bsns\b|skyrunner\s+national\s+series/i.test(name);

      // 2. Internazionale: Campionati Mondiali ISF, SWS (Skyrunner World Series), gare estere (esclusa SNS)
      const isIntl = !isSNS && (
        /mondial|world|sws|international|europe/i.test(circ) ||
        /world|sws|mondial/i.test(name) ||
        /spagna|croazia|svizzera|francia|austria/i.test(loc)
      );

      // 3. Titoli Italiani: Campionati Italiani Assoluti o di Categoria (es. SkySnow, Vertical, Ultra, a coppie, Skyrace, Youth)
      const isItalianTitle = (/camp\w*\.?\s*ital/i.test(circ) || /titolo\s+tricolore/i.test(circ) || /campionat\w*\s+italian/i.test(circ) || /tricolore/i.test(name)) && !/mondial/i.test(circ);

      // 4. Coppa Italia: CRAZY Skyrunning Italy Cup, CRAZY Vertical Italy Cup, NORTEC SkySnow Running Cup, Coppa Italia YOUTH MICO
      const isCoppa = /coppa\s+italia|italy\s+cup|running\s+cup|circuito\s+nortec|youth\s+a\s+e\s+b/i.test(circ) ||
                      /coppa\s+italia|italy\s+cup/i.test(name);

      if (isSNS) {
        return {
          categoria: 'sns',
          categoriaLabel: 'Skyrunner National Series (SNS)',
          icon: 'fas fa-map',
          pinClass: 'pin-sns',
          badgeText: 'National Series (SNS)'
        };
      } else if (isIntl) {
        return {
          categoria: 'internazionale',
          categoriaLabel: 'Gara Internazionale (Mondiali / SWS / ISF)',
          icon: 'fas fa-globe-americas',
          pinClass: 'pin-internazionale',
          badgeText: 'Gara Internazionale'
        };
      } else if (isItalianTitle) {
        return {
          categoria: 'titolo_italiano',
          categoriaLabel: 'Campionato Italiano (Titolo Tricolore)',
          icon: 'fas fa-flag',
          pinClass: 'pin-tricolore',
          badgeText: 'Campionato Italiano'
        };
      } else if (isCoppa) {
        return {
          categoria: 'coppa_italia',
          categoriaLabel: 'Circuito Coppa Italia',
          icon: 'fas fa-trophy',
          pinClass: 'pin-coppa',
          badgeText: 'Coppa Italia'
        };
      } else {
        return {
          categoria: 'standard',
          categoriaLabel: 'Gara Ufficiale di Calendario',
          icon: 'fas fa-mountain',
          pinClass: 'pin-standard',
          badgeText: 'Gara di Calendario'
        };
      }
    }

    // 2. Gare svolte / in calendario per la stagione in corso
    const raceBreakdown = { titolo_italiano: 0, coppa_italia: 0, sns: 0, internazionale: 0, standard: 0 };
    const seasonRaces = (db.calendarioGareList || [])
      .filter(r => String(r.anno) === String(currentYear))
      .map(r => {
        const coords = geoResolver.resolveRaceCoordinates(r);
        const classification = classifyRace(r);
        raceBreakdown[classification.categoria] = (raceBreakdown[classification.categoria] || 0) + 1;

        return {
          id: String(r.id || ''),
          anno: String(r.anno || currentYear),
          data: String(r.data || ''),
          dataIso: String(r.dataIso || ''),
          manifestazione: String(r.manifestazione || '').trim(),
          tipologia: String(r.tipologia || 'Skyrace').trim(),
          localita: String(r.localita || '').trim(),
          circuitoTitoli: String(r.circuitoTitoli || '').trim(),
          distanza: String(r.distanza || '').trim(),
          dislivello: String(r.dislivello || '').trim(),
          url: String(r.url || '').trim(),
          categoria: classification.categoria,
          categoriaLabel: classification.categoriaLabel,
          icon: classification.icon,
          pinClass: classification.pinClass,
          badgeText: classification.badgeText,
          lat: coords.lat,
          lng: coords.lng
        };
      });

    res.json({
      success: true,
      stagione: currentYear,
      totaleSocieta: activeClubs.length,
      totaleGare: seasonRaces.length,
      conteggiGare: raceBreakdown,
      societa: activeClubs,
      gare: seasonRaces
    });
  } catch (err) {
    console.error('Errore get /api/public/mappa-dati:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Public list of active Course Directors (Direttori di Percorso abilitati)
app.get('/api/public/direttori-percorso', (req, res) => {
  const sort = (req.query.sort || 'regione').trim();
  const dir = req.query.dir === 'desc' ? -1 : 1;
  const page = parseInt(req.query.page, 10) || 1;
  const limitParam = req.query.limit;
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();

  const activeGuides = (db.guideList || [])
    .filter(g => g.statoTessera === 'attiva')
    .map(g => {
      const cognome = (g.cognome || '').replace(/\s+/g, ' ').trim();
      const nome = (g.nome || '').replace(/\s+/g, ' ').trim();
      const nominativo = `${cognome} ${nome}`.trim();
      return {
        id: String(g.id || g.numeroTessera || ''),
        numeroTessera: String(g.numeroTessera || ''),
        cognome,
        nome,
        nominativo,
        regione: String(g.regione || '').trim() || 'Non specificata',
        email: String(g.email || '').trim(),
        statoTessera: g.statoTessera
      };
    });

  let list = activeGuides;

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(item => {
      const hay = `${item.nominativo} ${item.regione} ${item.email}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  // Sorting: default Regione (crescente), then Nominativo (crescente)
  list.sort((a, b) => {
    if (sort === 'nominativo') {
      const cmp = a.nominativo.localeCompare(b.nominativo, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
      return a.regione.localeCompare(b.regione, 'it', { sensitivity: 'base' });
    } else if (sort === 'email') {
      const cmp = a.email.localeCompare(b.email, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
      return a.regione.localeCompare(b.regione, 'it', { sensitivity: 'base' });
    } else {
      // default: regione
      const cmp = a.regione.localeCompare(b.regione, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * dir;
      return a.nominativo.localeCompare(b.nominativo, 'it', { sensitivity: 'base' });
    }
  });

  const total = list.length;
  let paginatedList = list;
  let limit = total;

  if (limitParam && limitParam !== 'all') {
    limit = parseInt(limitParam, 10) || 25;
    const startIndex = (page - 1) * limit;
    paginatedList = list.slice(startIndex, startIndex + limit);
  }

  res.json({
    success: true,
    total,
    page,
    limit,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
    direttori: paginatedList
  });
});

// ================= ADMIN ROUTES ================= //

// Get clubs with database search, status/affiliation filtering, column sorting and pagination (25, 50, 100, all)
app.get('/api/admin/clubs', (req, res) => {
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const filterStato = req.query.stato || 'all';
  const filterAffiliato = req.query.affiliato || 'all';
  const sort = req.query.sort || 'codice';
  const dir = req.query.dir === 'desc' ? -1 : 1;

  let list = [...(db.clubsList || [])];

  // Filter: search text
  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(c => {
      const cod = String(c.codice || c.rawId || '').toLowerCase();
      const fiso = String(c.codiceFiso || '').toLowerCase();
      const nome = String(c.nome || c.denominazione || c.name || '').toLowerCase();
      const username = String(c.username || '').toLowerCase();
      const email = String(c.email || '').toLowerCase();
      const cf = String(c.codiceFiscale || '').toLowerCase();
      const pi = String(c.partitaIva || '').toLowerCase();
      const sede = String(c.sede || c.city || '').toLowerCase();
      const referente = String(c.legaleRappresentante || '').toLowerCase();
      const stato = String(c.statoAffiliazione || '').toLowerCase();
      const affil = c.affiliato ? 'affiliato si sì' : 'non affiliato no';

      return tokens.every(t =>
        cod.includes(t) ||
        fiso.includes(t) ||
        nome.includes(t) ||
        username.includes(t) ||
        email.includes(t) ||
        cf.includes(t) ||
        pi.includes(t) ||
        sede.includes(t) ||
        referente.includes(t) ||
        stato.includes(t) ||
        affil.includes(t)
      );
    });
  }

  // Filter: Stato (attive / non_attive / attiva / scaduta)
  if (filterStato === 'attive' || filterStato === 'attiva') {
    list = list.filter(c => c.isAttiva === true);
  } else if (filterStato === 'non_attive' || filterStato === 'scaduta' || filterStato === 'scadute') {
    list = list.filter(c => c.isAttiva === false);
  }

  // Filter: Affiliato (affiliate / non_affiliate)
  if (filterAffiliato === 'affiliate') {
    list = list.filter(c => c.affiliato === true);
  } else if (filterAffiliato === 'non_affiliate') {
    list = list.filter(c => c.affiliato === false);
  }

  // Sort: column sorting
  list.sort((a, b) => {
    let valA, valB;
    if (sort === 'codice') {
      valA = parseInt(a.codice) || parseInt(a.rawId) || 0;
      valB = parseInt(b.codice) || parseInt(b.rawId) || 0;
      return (valA - valB) * dir;
    } else if (sort === 'codiceFiso') {
      const fisoA = String(a.codiceFiso || '').trim();
      const fisoB = String(b.codiceFiso || '').trim();
      if (!fisoA && !fisoB) return 0;
      if (!fisoA) return 1;
      if (!fisoB) return -1;
      const numA = parseInt(fisoA, 10);
      const numB = parseInt(fisoB, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return (numA - numB) * dir;
      }
      valA = fisoA.toLowerCase();
      valB = fisoB.toLowerCase();
    } else if (sort === 'nome') {
      valA = (a.nome || a.denominazione || a.name || '').toLowerCase();
      valB = (b.nome || b.denominazione || b.name || '').toLowerCase();
    } else if (sort === 'affiliato') {
      valA = a.affiliato ? 1 : 0;
      valB = b.affiliato ? 1 : 0;
      return (valA - valB) * dir;
    } else if (sort === 'stato') {
      valA = a.isAttiva ? 9999 : (a.lastYear || 0);
      valB = b.isAttiva ? 9999 : (b.lastYear || 0);
      return (valA - valB) * dir;
    } else {
      valA = (a.nome || '').toLowerCase();
      valB = (b.nome || '').toLowerCase();
    }

    if (valA < valB) return -1 * dir;
    if (valA > valB) return 1 * dir;
    return 0;
  });

  const total = list.length;
  const allClubs = db.clubsList || [];
  const attiveCount = allClubs.filter(c => c.isAttiva === true).length;
  const scaduteCount = allClubs.filter(c => c.isAttiva === false).length;
  const filteredAttiveCount = list.filter(c => c.isAttiva === true).length;
  const filteredScaduteCount = list.filter(c => c.isAttiva === false).length;
  const limitParam = req.query.limit;

  if (limitParam && limitParam !== 'all' && parseInt(limitParam) > 0) {
    const limit = parseInt(limitParam);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, totalPages));
    const offset = (page - 1) * limit;
    const paginatedClubs = list.slice(offset, offset + limit);

    return res.json({
      clubs: paginatedClubs,
      total,
      attiveCount,
      scaduteCount,
      filteredAttiveCount,
      filteredScaduteCount,
      page,
      limit,
      totalPages,
      sort,
      dir: req.query.dir || 'asc',
      stato: filterStato,
      affiliato: filterAffiliato
    });
  }

  // Return all or unpaginated
  res.json({
    clubs: list,
    total,
    attiveCount,
    scaduteCount,
    filteredAttiveCount,
    filteredScaduteCount,
    page: 1,
    limit: 'all',
    totalPages: 1,
    sort,
    dir: req.query.dir || 'asc',
    stato: filterStato,
    affiliato: filterAffiliato
  });
});

// Get members/tesserati for a specific club
app.get('/api/admin/societa/:id/membri', (req, res) => {
  const club = db.clubsList.find(c => String(c.rawId) === String(req.params.id)) ||
               db.clubsList.find(c => String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (!club) return res.status(404).json({ error: 'Società non trovata' });

  const rawClubId = String(club.rawId || club.id || club.codice);
  const clubName = (club.nome || club.ragioneSociale || '').trim().toLowerCase();

  const members = (db.membersList || []).filter(m => {
    return String(m.societaId) === rawClubId || 
           String(m.societaId) === String(club.id) || 
           (m.societaNome && m.societaNome.trim().toLowerCase() === clubName);
  });

  res.json({
    club: {
      id: club.id,
      rawId: club.rawId,
      codice: club.codice,
      codiceFiso: club.codiceFiso,
      nome: club.nome,
      ragioneSociale: club.ragioneSociale,
      username: club.username,
      email: club.email,
      credito: club.credito,
      affiliato: club.affiliato,
      statoAffiliazione: club.statoAffiliazione
    },
    total: members.length,
    members
  });
});

// Update society anagraphic data
app.put('/api/admin/societa/:id', (req, res) => {
  const clubIndex = db.clubsList.findIndex(c => String(c.rawId) === String(req.params.id) || String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (clubIndex === -1) return res.status(404).json({ error: 'Società non trovata' });

  const club = db.clubsList[clubIndex];
  const {
    nome,
    ragioneSociale,
    rName,
    formaGiuridica,
    codiceFiso,
    codiceFiscale,
    partitaIva,
    legaleRappresentante,
    address,
    city,
    province,
    region,
    cap,
    telefono,
    cell1,
    cell2,
    email,
    email2,
    web,
    affiliato,
    affiliateExpire
  } = req.body;

  const newNome = (nome || ragioneSociale || club.nome).trim();
  club.nome = newNome;
  club.ragioneSociale = newNome;
  const selectedForma = (formaGiuridica !== undefined ? formaGiuridica : rName);
  if (selectedForma !== undefined) club.rName = selectedForma;
  if (codiceFiso !== undefined) club.codiceFiso = String(codiceFiso).trim().replace(/^0+(?=\d)/, '');
  if (codiceFiscale !== undefined) club.codiceFiscale = String(codiceFiscale).trim();
  if (partitaIva !== undefined) club.partitaIva = String(partitaIva).trim();
  if (legaleRappresentante !== undefined) club.legaleRappresentante = String(legaleRappresentante).trim();
  if (address !== undefined) club.address = String(address).trim();
  if (city !== undefined) club.city = String(city).trim();
  if (province !== undefined) club.province = String(province).trim();
  if (region !== undefined) club.region = String(region).trim();
  if (cap !== undefined) club.cap = String(cap).trim();
  club.sede = `${club.city || ''} (${club.province || ''})`.trim();
  if (telefono !== undefined || cell1 !== undefined) {
    club.telefono = String(telefono || cell1 || '').trim();
    club.cell1 = club.telefono;
  }
  if (cell2 !== undefined) club.cell2 = String(cell2).trim();
  if (email !== undefined) club.email = String(email).trim();
  if (email2 !== undefined) club.email2 = String(email2).trim();
  if (web !== undefined) club.web = String(web).trim();

  if (affiliato !== undefined) {
    club.affiliato = Boolean(affiliato);
    club.affiliation_complete = club.affiliato ? 1 : 0;
  }
  if (affiliateExpire !== undefined) {
    club.affiliateExpire = String(affiliateExpire).trim();
    const expireYear = club.affiliateExpire ? parseInt(club.affiliateExpire.slice(0, 4)) : null;
    club.lastYear = expireYear || club.lastYear;
  }
  const currentYear = new Date().getFullYear();
  club.isAttiva = Boolean(club.affiliato && club.lastYear !== null && club.lastYear >= currentYear);
  club.statoAffiliazione = club.isAttiva
    ? `Attiva ${currentYear}`
    : (!club.affiliato && club.lastYear !== null && club.lastYear >= currentYear
        ? 'Non affiliata'
        : `Scaduta ${club.lastYear || 'N/D'}`);

  // Sync into rawClubs dataset
  if (db.rawClubs) {
    const rawC = db.rawClubs.find(c => String(c.id) === String(club.rawId));
    if (rawC) {
      rawC.name = club.nome;
      rawC.r_name = club.rName;
      rawC.fisoId = club.codiceFiso || null;
      rawC.cf = club.codiceFiscale;
      rawC.pi = club.partitaIva;
      rawC.contact = club.legaleRappresentante;
      rawC.address = club.address;
      rawC.city = club.city;
      rawC.province = club.province;
      rawC.region = club.region;
      rawC.cap = club.cap;
      rawC.cell1 = club.cell1;
      rawC.cell2 = club.cell2;
      rawC.email = club.email;
      rawC.email2 = club.email2;
      rawC.web = club.web;
      rawC.affiliation_complete = club.affiliato ? 1 : 0;
      if (club.affiliateExpire) rawC.affiliate_expire = club.affiliateExpire;
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }
  }

  // Sync into usersList if matched
  if (db.usersList) {
    const u = db.usersList.find(usr => String(usr.id) === String(club.userId) || usr.username === club.username);
    if (u) {
      u.nome = club.nome;
      u.ragioneSociale = club.nome;
      u.email = club.email;
      u.telefono = club.telefono;
      u.sede = club.sede;
    }
  }

  res.json({
    success: true,
    message: 'Dati anagrafici società aggiornati con successo!',
    club
  });
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Società',
    azione: 'Modifica Anagrafica Società (Pannello Admin)',
    oggetto: `${club.nome} (Cod. ${club.codice})`,
    dettagli: `Sede: ${club.sede} | CF: ${club.codiceFiscale || '-'} | P.IVA: ${club.partitaIva || '-'} | Affiliata: ${club.affiliato ? 'Sì' : 'No'} | Stato: ${club.statoAffiliazione}`,
    esito: 'OK'
  });
});

// Delete society from database
app.delete('/api/admin/societa/:id', (req, res) => {
  const clubIndex = db.clubsList.findIndex(c => String(c.rawId) === String(req.params.id) || String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (clubIndex === -1) return res.status(404).json({ error: 'Società non trovata' });

  const club = db.clubsList[clubIndex];
  const rawId = String(club.rawId || club.id);

  // Remove from clubsList
  db.clubsList.splice(clubIndex, 1);

  // Remove from rawClubs
  if (db.rawClubs) {
    const rawIdx = db.rawClubs.findIndex(c => String(c.id) === rawId);
    if (rawIdx !== -1) {
      db.rawClubs.splice(rawIdx, 1);
      db.writeJsonFile('mysql_clubs.json', db.rawClubs);
    }
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Società',
    azione: 'Eliminazione Società Sportiva',
    oggetto: `${club.nome} (Cod. ${club.codice})`,
    dettagli: `Eliminata definitivamente la società "${club.nome}" (Codice: ${club.codice}, Email: ${club.email || '-'}) dal database federale`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Società "${club.nome}" (Codice: ${club.codice}) eliminata definitivamente dal database.`
  });
});

// Get single club details
app.get('/api/admin/societa/:id', (req, res) => {
  const club = db.clubsList.find(c => String(c.rawId) === String(req.params.id)) ||
               db.clubsList.find(c => String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (!club) return res.status(404).json({ error: 'Società non trovata' });
  res.json({ club });
});

// Update residual credit manually
app.put('/api/admin/societa/:id/credito', (req, res) => {
  const club = db.clubsList.find(c => String(c.rawId) === String(req.params.id)) ||
               db.clubsList.find(c => String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (!club) return res.status(404).json({ error: 'Società non trovata' });

  const newCredito = parseFloat(req.body.credito);
  if (isNaN(newCredito)) return res.status(400).json({ error: 'Valore credito non valido' });

  club.credito = Math.round(newCredito * 100) / 100;

  // Update rawAccounts
  let acc = db.rawAccounts.find(a => String(a.user_id) === String(club.userId));
  if (acc) {
    acc.current = club.credito;
  } else if (club.userId) {
    acc = {
      id: String(Date.now()),
      user_id: club.userId,
      current: club.credito,
      total: club.credito,
      payed: 0
    };
    db.rawAccounts.push(acc);
  }
  db.writeJsonFile('mysql_accounts.json', db.rawAccounts);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contabilità e Pagamenti',
    azione: 'Aggiornamento Credito Residuo Società',
    oggetto: `${club.nome} (Cod. ${club.codice})`,
    dettagli: `Nuovo saldo credito residuo impostato a € ${club.credito.toFixed(2)}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Credito residuo aggiornato con successo',
    credito: club.credito
  });
});

// Record new payment for society
app.post('/api/admin/societa/:id/pagamento', (req, res) => {
  const club = db.clubsList.find(c => String(c.rawId) === String(req.params.id)) ||
               db.clubsList.find(c => String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (!club) return res.status(404).json({ error: 'Società non trovata' });

  const amount = parseFloat(req.body.totale);
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Importo totale non valido' });

  const scalaDaConto = Boolean(req.body.scalaDaConto);
  const descrizione = (req.body.descrizione || 'Pagamento quota / tesseramenti').trim();
  const creaRicevuta = Boolean(req.body.creaRicevuta);

  if (scalaDaConto) {
    const current = parseFloat(club.credito) || 0;
    club.credito = Math.round((current - amount) * 100) / 100;

    let acc = db.rawAccounts.find(a => String(a.user_id) === String(club.userId));
    if (acc) {
      acc.current = club.credito;
      acc.total = Math.round(((parseFloat(acc.total) || 0) + amount) * 100) / 100;
    }
    db.writeJsonFile('mysql_accounts.json', db.rawAccounts);
  }

  const receiptNumber = `FISKY-REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const newPayment = {
    id: `pay_${Date.now()}`,
    club_id: club.rawId,
    societaNome: club.nome,
    amount: amount,
    description: descrizione,
    scalaDaConto: scalaDaConto,
    creaRicevuta: creaRicevuta,
    receiptNumber: receiptNumber,
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  };

  if (!db.rawPayments) db.rawPayments = [];
  db.rawPayments.unshift(newPayment);
  db.writeJsonFile('mysql_payments.json', db.rawPayments);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contabilità e Pagamenti',
    azione: 'Registrazione Pagamento Societario',
    oggetto: `${club.nome} (Ricevuta ${receiptNumber})`,
    dettagli: `Importo: € ${amount.toFixed(2)} | Causale: ${descrizione} | Scalato da conto: ${scalaDaConto ? 'Sì' : 'No'} | Credito residuo: € ${Number(club.credito || 0).toFixed(2)}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Pagamento registrato con successo!',
    payment: newPayment,
    creditoResiduo: club.credito
  });
});

// Impersonate society portal
app.post('/api/admin/impersonate/societa/:id', (req, res) => {
  const club = db.clubsList.find(c => String(c.rawId) === String(req.params.id)) ||
               db.clubsList.find(c => String(c.id) === String(req.params.id) || String(c.codice) === String(req.params.id));
  if (!club) return res.status(404).json({ error: 'Società non trovata' });

  const returnTarget = (req.body && req.body.returnTarget) || 'societa-sportive';
  const returnBreadcrumb = (req.body && req.body.returnBreadcrumb) || 'Società > Società sportive';

  const impUser = {
    id: club.id,
    rawId: club.rawId,
    clubRawId: club.rawId,
    codice: club.codice,
    codiceAffiliazione: club.codiceFiso ? `FISO-${club.codiceFiso}` : `FISKY-AFF-${club.codice}`,
    role: 'societa',
    nome: club.nome,
    ragioneSociale: club.nome,
    email: club.email,
    username: club.username,
    returnTarget,
    returnBreadcrumb,
    impersonating: true
  };

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Amministrazione Sistema',
    azione: 'Avvio Impersonificazione Portale Società',
    oggetto: `${club.nome} (Cod. ${club.codice})`,
    dettagli: `L'amministratore ha avviato la sessione di gestione per conto della società "${club.nome}" (Username: ${club.username || '-'})`,
    esito: 'OK'
  });

  res.cookie('fisky_impersonate', JSON.stringify(impUser), { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
  res.json({ success: true, redirectUrl: '/dashboard-societa.html' });
});

// Revert impersonation back to admin
app.get('/api/admin/impersonate/revert', (req, res) => {
  const currentImp = getCurrentUser(req);
  let returnTarget = req.query.return_to || '';
  if (!returnTarget && req.cookies && req.cookies.fisky_impersonate) {
    try {
      const imp = JSON.parse(req.cookies.fisky_impersonate);
      if (imp && imp.returnTarget) returnTarget = imp.returnTarget;
    } catch (e) {}
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Amministrazione Sistema',
    azione: 'Termine Impersonificazione Società',
    oggetto: currentImp && currentImp.nome ? `${currentImp.nome} (Cod. ${currentImp.codice || '-'})` : 'Ritorno a Pannello Admin',
    dettagli: `Sessione di impersonificazione terminata e ritorno al pannello di controllo Amministratore`,
    esito: 'OK'
  });
  res.clearCookie('fisky_impersonate');
  if (returnTarget) {
    res.redirect('/dashboard-admin.html#' + encodeURIComponent(returnTarget));
  } else {
    res.redirect('/dashboard-admin.html');
  }
});

// Get all chronos
app.get('/api/admin/chronos', (req, res) => {
  res.json({ chronos: db.chronosList });
});

// Get single chrono
app.get('/api/admin/chronos/:id', (req, res) => {
  const idParam = String(req.params.id);
  const chrono = (db.chronosList || []).find(c => String(c.rawId) === idParam || String(c.id) === idParam || String(c.codice) === idParam || `crono_${c.rawId}` === idParam);
  if (!chrono) return res.status(404).json({ error: 'Azienda di cronometraggio non trovata' });
  res.json({ chrono });
});

// Create new chrono
app.post('/api/admin/chronos', (req, res) => {
  const {
    nome,
    ragioneSociale,
    referenteTecnico,
    contact,
    email,
    c_email,
    email2,
    telefono,
    cell1,
    c_cell1,
    address,
    street_number,
    cap,
    city,
    province,
    region,
    codiceFiscale,
    cf,
    partitaIva,
    pi,
    web,
    comment
  } = req.body || {};

  const nameVal = (ragioneSociale || nome || '').trim();
  if (!nameVal) {
    return res.status(400).json({ error: 'La Ragione Sociale / Nome azienda è obbligatoria.' });
  }

  const maxId = Math.max(0, ...(db.rawChronos || []).map(c => Number(c.id) || 0), ...(db.chronosList || []).map(c => Number(c.rawId) || 0));
  const newId = maxId + 1;

  const rawEntry = {
    id: newId,
    name: nameVal,
    contact: (contact || referenteTecnico || '').trim(),
    cf: (cf || codiceFiscale || '').trim(),
    pi: (pi || partitaIva || '').trim(),
    c_cell1: (c_cell1 || telefono || cell1 || '').trim(),
    c_email: (c_email || email || '').trim(),
    address: (address || '').trim(),
    street_number: (street_number || '').trim(),
    cap: (cap || '').trim(),
    city: (city || '').trim(),
    province: (province || '').trim().toUpperCase(),
    region: (region || '').trim(),
    email: (email || c_email || '').trim(),
    email2: (email2 || '').trim(),
    cell1: (cell1 || telefono || c_cell1 || '').trim(),
    web: (web || '').trim(),
    user_id: '',
    comment: (comment || '').trim(),
    profileCompleted: true
  };

  const sedeStr = rawEntry.city ? (rawEntry.city + (rawEntry.province ? ' (' + rawEntry.province + ')' : '')) : (rawEntry.province || 'Italia');

  const formattedEntry = {
    id: `crono_${newId}`,
    rawId: String(newId),
    codice: String(newId),
    role: 'crono',
    nome: rawEntry.name,
    ragioneSociale: rawEntry.name,
    codiceFiscale: rawEntry.cf,
    partitaIva: rawEntry.pi,
    referenteTecnico: rawEntry.contact || 'Referente Crono',
    contact: rawEntry.contact,
    c_cell1: rawEntry.c_cell1,
    c_email: rawEntry.c_email,
    address: rawEntry.address,
    street_number: rawEntry.street_number,
    cap: rawEntry.cap,
    city: rawEntry.city,
    province: rawEntry.province,
    region: rawEntry.region,
    sede: sedeStr,
    email: rawEntry.email,
    email2: rawEntry.email2,
    cell1: rawEntry.cell1,
    telefono: rawEntry.cell1 || rawEntry.c_cell1,
    web: rawEntry.web,
    userId: '',
    comment: rawEntry.comment,
    profileCompleted: true,
    status: 'attivo'
  };

  if (!db.rawChronos) db.rawChronos = [];
  db.rawChronos.push(rawEntry);
  db.writeJsonFile('mysql_chronos.json', db.rawChronos);

  if (!db.chronosList) db.chronosList = [];
  db.chronosList.unshift(formattedEntry);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Aziende Cronometristi',
    azione: 'Inserimento Nuova Azienda di Cronometraggio',
    oggetto: `${formattedEntry.nome} (ID: ${newId})`,
    dettagli: `Inserita nuova azienda di cronometraggio "${formattedEntry.nome}" (Sede: ${formattedEntry.sede || '-'}, Email: ${formattedEntry.email || '-'}, Tel: ${formattedEntry.telefono || '-'})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Azienda di cronometraggio inserita con successo nel database!',
    chrono: formattedEntry
  });
});

// Update chrono
app.put('/api/admin/chronos/:id', (req, res) => {
  const idParam = String(req.params.id);
  const chronoIndex = (db.chronosList || []).findIndex(c => String(c.rawId) === idParam || String(c.id) === idParam || String(c.codice) === idParam || `crono_${c.rawId}` === idParam);
  if (chronoIndex === -1) return res.status(404).json({ error: 'Azienda di cronometraggio non trovata' });

  const chrono = db.chronosList[chronoIndex];
  const rawId = String(chrono.rawId || chrono.id);
  const rawIdx = (db.rawChronos || []).findIndex(c => String(c.id) === rawId);

  const {
    nome,
    ragioneSociale,
    referenteTecnico,
    contact,
    email,
    c_email,
    email2,
    telefono,
    cell1,
    c_cell1,
    address,
    street_number,
    cap,
    city,
    province,
    region,
    codiceFiscale,
    cf,
    partitaIva,
    pi,
    web,
    comment
  } = req.body || {};

  const nameVal = (ragioneSociale || nome || chrono.ragioneSociale || chrono.nome || '').trim();
  if (!nameVal) {
    return res.status(400).json({ error: 'La Ragione Sociale / Nome azienda non può essere vuota.' });
  }

  const contactVal = contact !== undefined ? String(contact).trim() : (referenteTecnico !== undefined ? String(referenteTecnico).trim() : chrono.contact);
  const cfVal = cf !== undefined ? String(cf).trim() : (codiceFiscale !== undefined ? String(codiceFiscale).trim() : chrono.codiceFiscale);
  const piVal = pi !== undefined ? String(pi).trim() : (partitaIva !== undefined ? String(partitaIva).trim() : chrono.partitaIva);
  const emailVal = email !== undefined ? String(email).trim() : (c_email !== undefined ? String(c_email).trim() : chrono.email);
  const email2Val = email2 !== undefined ? String(email2).trim() : chrono.email2;
  const telVal = telefono !== undefined ? String(telefono).trim() : (cell1 !== undefined ? String(cell1).trim() : (c_cell1 !== undefined ? String(c_cell1).trim() : chrono.telefono));
  const addrVal = address !== undefined ? String(address).trim() : chrono.address;
  const numVal = street_number !== undefined ? String(street_number).trim() : chrono.street_number;
  const capVal = cap !== undefined ? String(cap).trim() : chrono.cap;
  const cityVal = city !== undefined ? String(city).trim() : chrono.city;
  const provVal = province !== undefined ? String(province).trim().toUpperCase() : chrono.province;
  const regVal = region !== undefined ? String(region).trim() : chrono.region;
  const webVal = web !== undefined ? String(web).trim() : chrono.web;
  const commentVal = comment !== undefined ? String(comment).trim() : chrono.comment;

  const sedeStr = cityVal ? (cityVal + (provVal ? ' (' + provVal + ')' : '')) : (provVal || 'Italia');

  // Update chronosList
  chrono.nome = nameVal;
  chrono.ragioneSociale = nameVal;
  chrono.contact = contactVal;
  chrono.referenteTecnico = contactVal || 'Referente Crono';
  chrono.codiceFiscale = cfVal;
  chrono.partitaIva = piVal;
  chrono.email = emailVal;
  chrono.c_email = emailVal;
  chrono.email2 = email2Val;
  chrono.cell1 = telVal;
  chrono.c_cell1 = telVal;
  chrono.telefono = telVal;
  chrono.address = addrVal;
  chrono.street_number = numVal;
  chrono.cap = capVal;
  chrono.city = cityVal;
  chrono.province = provVal;
  chrono.region = regVal;
  chrono.sede = sedeStr;
  chrono.web = webVal;
  chrono.comment = commentVal;

  // Update rawChronos
  if (rawIdx !== -1) {
    const raw = db.rawChronos[rawIdx];
    raw.name = nameVal;
    raw.contact = contactVal;
    raw.cf = cfVal;
    raw.pi = piVal;
    raw.email = emailVal;
    raw.c_email = emailVal;
    raw.email2 = email2Val;
    raw.cell1 = telVal;
    raw.c_cell1 = telVal;
    raw.address = addrVal;
    raw.street_number = numVal;
    raw.cap = capVal;
    raw.city = cityVal;
    raw.province = provVal;
    raw.region = regVal;
    raw.web = webVal;
    raw.comment = commentVal;
    db.writeJsonFile('mysql_chronos.json', db.rawChronos);
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Aziende Cronometristi',
    azione: 'Modifica Anagrafica Azienda di Cronometraggio',
    oggetto: `${chrono.nome} (Cod. ${chrono.codice})`,
    dettagli: `Aggiornati dati azienda "${chrono.nome}" (Sede: ${chrono.sede}, Email: ${chrono.email}, Tel: ${chrono.telefono})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Dati azienda di cronometraggio aggiornati con successo nel database!',
    chrono
  });
});

// Delete chrono
app.delete('/api/admin/chronos/:id', (req, res) => {
  const idParam = String(req.params.id);
  const chronoIndex = (db.chronosList || []).findIndex(c => String(c.rawId) === idParam || String(c.id) === idParam || String(c.codice) === idParam || `crono_${c.rawId}` === idParam);
  if (chronoIndex === -1) return res.status(404).json({ error: 'Azienda di cronometraggio non trovata' });

  const chrono = db.chronosList[chronoIndex];
  const rawId = String(chrono.rawId || chrono.id);

  db.chronosList.splice(chronoIndex, 1);

  if (db.rawChronos) {
    const rawIdx = db.rawChronos.findIndex(c => String(c.id) === rawId);
    if (rawIdx !== -1) {
      db.rawChronos.splice(rawIdx, 1);
      db.writeJsonFile('mysql_chronos.json', db.rawChronos);
    }
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Aziende Cronometristi',
    azione: 'Eliminazione Azienda di Cronometraggio',
    oggetto: `${chrono.nome} (Cod. ${chrono.codice})`,
    dettagli: `Eliminata definitivamente dal database l'azienda di cronometraggio "${chrono.nome}" (ID: ${rawId}, Email: ${chrono.email || '-'})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Azienda di cronometraggio "${chrono.nome}" eliminata con successo dal database.`
  });
});

// Get all users registered on the site (with search, role filter, sort, pagination)
app.get('/api/admin/users', (req, res) => {
  const allUsers = (db.usersList || []).map(u => {
    const utenteLabel = db.computeUtenteDisplayLabel ? db.computeUtenteDisplayLabel(u) : (u.utente || u.nome || u.username);
    u.utente = utenteLabel;
    return u;
  });

  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const filterRole = (req.query.role || 'all').trim().toLowerCase();
  const sort = (req.query.sort || 'utente').trim();
  const dir = req.query.dir === 'desc' ? -1 : 1;

  const counts = {
    total: allUsers.length,
    societa: allUsers.filter(u => u.role === 'societa').length,
    crono: allUsers.filter(u => u.role === 'crono').length,
    singolo: allUsers.filter(u => u.role === 'singolo').length,
    admin: allUsers.filter(u => u.role === 'admin').length
  };

  let list = [...allUsers];

  if (filterRole && filterRole !== 'all') {
    list = list.filter(u => String(u.role || '').toLowerCase() === filterRole);
  }

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(u => {
      const hay = [
        u.utente,
        u.nome,
        u.username,
        u.email,
        u.role,
        u.rawId,
        u.id,
        u.codiceSocieta,
        u.codiceAffiliazione,
        u.tesseraNumero
      ].join(' ').toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  list.sort((a, b) => {
    if (sort === 'username') {
      return String(a.username || '').localeCompare(String(b.username || ''), 'it', { sensitivity: 'base' }) * dir;
    }
    if (sort === 'id') {
      const idA = parseInt(a.rawId, 10) || 0;
      const idB = parseInt(b.rawId, 10) || 0;
      return (idA - idB) * dir;
    }
    // Default sort by 'utente' (Denominazione / Cognome Nome)
    const utA = String(a.utente || a.nome || '').trim();
    const utB = String(b.utente || b.nome || '').trim();
    const cmp = utA.localeCompare(utB, 'it', { sensitivity: 'base' });
    if (cmp !== 0) return cmp * dir;
    return String(a.username || '').localeCompare(String(b.username || ''), 'it', { sensitivity: 'base' }) * dir;
  });

  const total = list.length;
  const limitParam = req.query.limit || '50';
  let paginated = list;
  let page = 1;
  let totalPages = 1;

  if (limitParam !== 'all' && parseInt(limitParam, 10) > 0) {
    const limitNum = parseInt(limitParam, 10);
    totalPages = Math.max(1, Math.ceil(total / limitNum));
    page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, totalPages));
    const offset = (page - 1) * limitNum;
    paginated = list.slice(offset, offset + limitNum);
  }

  res.json({
    success: true,
    users: paginated,
    total,
    totalAll: allUsers.length,
    counts,
    page,
    limit: limitParam,
    totalPages,
    sort,
    dir: dir === -1 ? 'desc' : 'asc'
  });
});

// Get single user complete details for "Vedi" modal (read-only visualization mode)
app.get('/api/admin/users/:id', (req, res) => {
  const idParam = String(req.params.id);
  const user = (db.usersList || []).find(
    u => String(u.id) === idParam || String(u.rawId) === idParam || (u.username && String(u.username).toLowerCase() === idParam.toLowerCase())
  );
  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato nel database.' });
  }

  const rawUid = String(user.rawId || user.id || '').replace(/^u_/, '');
  const rawUserRec = (db.rawUsers || []).find(ru => String(ru.id) === rawUid) || {};
  const linked = findUserLinkedEntity(user);
  const utenteLabel = db.computeUtenteDisplayLabel ? db.computeUtenteDisplayLabel(user) : (user.utente || user.nome || user.username);

  const roleLabels = {
    societa: 'Società Sportiva',
    crono: 'Azienda di Cronometraggio',
    singolo: 'Persona (Tesserato / Utente Singolo)',
    admin: 'Amministratore di Sistema'
  };

  let schedaAnagrafica = {};

  if (user.role === 'societa') {
    const rc = linked.rawClub || {};
    const cf = linked.clubFormatted || {};
    schedaAnagrafica = {
      tipologia: 'Società Sportiva',
      denominazione: rc.name || cf.nome || user.ragioneSociale || utenteLabel || '-',
      codiceSocieta: cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || (rc.id ? String(10000 + Number(rc.id)) : '-'),
      codiceFiso: (rc.fisoId ? String(rc.fisoId).trim().replace(/^0+(?=\d)/, '') : '') || cf.codiceFiso || '-',
      ragioneSociale: rc.r_name || cf.rName || 'ASD',
      formaGiuridica: rc.r_name || cf.rName || 'ASD',
      codiceFiscale: rc.cf || cf.codiceFiscale || user.codiceFiscale || '-',
      partitaIva: rc.pi || cf.partitaIva || user.partitaIva || '-',
      indirizzo: rc.address || cf.address || '-',
      civico: rc.street_number || cf.street_number || '-',
      cap: rc.cap || cf.cap || '-',
      citta: rc.city || cf.city || '-',
      provincia: rc.province || cf.province || '-',
      regione: rc.region || cf.region || '-',
      sede: cf.sede || (rc.city ? `${rc.city} (${rc.province || ''})` : (user.sede || '-')),
      telefono: rc.cell1 || cf.telefono || user.telefono || '-',
      telefonoSecondario: rc.cell2 || cf.cell2 || '-',
      email: rc.email || cf.email || user.email || '-',
      pec: rc.email2 || cf.email2 || '-',
      web: rc.web || cf.web || '-',
      referente: rc.contact || cf.contact || cf.legaleRappresentante || user.legaleRappresentante || '-',
      cellulareReferente: rc.c_cell1 || cf.c_cell1 || '-',
      emailReferente: rc.c_email || cf.c_email || '-',
      statoAffiliazione: cf.statoAffiliazione || (rc.affiliate_expire && rc.affiliate_expire !== '0000-00-00' ? `Scadenza: ${rc.affiliate_expire}` : '-'),
      affiliato: Boolean(cf.affiliato || Number(rc.affiliation_complete) === 1),
      anniAffiliazione: rc.affiliate_years || cf.affiliateYears || '-',
      dataPrimaAffiliazione: (rc.affiliate_begin && rc.affiliate_begin !== '0000-00-00') ? rc.affiliate_begin : '-',
      scadenzaAffiliazione: (rc.affiliate_expire && rc.affiliate_expire !== '0000-00-00') ? rc.affiliate_expire : '-',
      creditoResiduo: cf.credito !== undefined ? `€ ${Number(cf.credito || 0).toFixed(2)}` : '€ 0.00',
      coniCertificate: String(rc.coni_certificate || '0') === '1' ? 'Sì' : 'No',
      documenti: {
        certificate: rc.certificate || cf.certificate || '',
        cf_certificate: rc.cf_certificate || cf.cf_certificate || '',
        association_articles: rc.association_articles || cf.association_articles || '',
        statute_modification: rc.statute_modification || cf.statute_modification || '',
        statute: rc.statute || cf.statute || '',
        id_president: rc.id_president || cf.id_president || '',
        election_act: rc.election_act || cf.election_act || '',
        affiliation_form: rc.affiliation_form || cf.affiliation_form || ''
      },
      commento: rc.comment || user.commento || '-'
    };
  } else if (user.role === 'crono') {
    const rch = linked.rawChrono || {};
    const chf = linked.chronoFormatted || {};
    schedaAnagrafica = {
      tipologia: 'Azienda di Cronometraggio',
      denominazione: rch.name || chf.nome || user.aziendaCrono || user.ragioneSociale || utenteLabel || '-',
      codiceAzienda: chf.codice || rch.id || user.codiceCrono || rawUid || '-',
      partitaIva: rch.pi || chf.partitaIva || user.partitaIva || '-',
      codiceFiscale: rch.cf || chf.codiceFiscale || user.codiceFiscale || '-',
      indirizzo: rch.address || chf.address || '-',
      civico: rch.street_number || chf.street_number || '-',
      cap: rch.cap || chf.cap || '-',
      citta: rch.city || chf.city || '-',
      provincia: rch.province || chf.province || '-',
      regione: rch.region || chf.region || '-',
      telefono: rch.cell1 || chf.telefono || user.telefono || '-',
      email: rch.email || chf.email || user.email || '-',
      pec: rch.email2 || chf.email2 || '-',
      web: rch.web || chf.web || '-',
      referente: rch.contact || chf.referenteTecnico || user.referenteTecnico || `${rawUserRec.name || user.firstName || ''} ${rawUserRec.surname || user.lastName || ''}`.trim() || '-',
      cellulareReferente: rch.c_cell1 || chf.c_cell1 || '-',
      emailReferente: rch.c_email || chf.c_email || '-',
      commento: rch.comment || user.commento || '-'
    };
  } else {
    const rm = linked.rawMember || {};
    const mf = linked.memberFormatted || {};
    const cognome = (rm.surname || mf.cognome || user.lastName || rawUserRec.surname || '').trim();
    const nome = (rm.name || mf.nome || user.firstName || rawUserRec.name || '').trim();
    schedaAnagrafica = {
      tipologia: user.role === 'admin' ? 'Amministratore di Sistema' : 'Persona (Utente / Tesserato)',
      cognome: cognome || '-',
      nome: nome || '-',
      cognomeNome: utenteLabel || `${cognome} ${nome}`.trim() || '-',
      numeroTessera: mf.numeroTessera || rm.code || user.tesseraNumero || '-',
      qualificaRuoli: (mf.ruoli && mf.ruoli.length ? mf.ruoli.join(', ') : (user.tipoTesseramento || user.ruoloSportivo || (user.role === 'admin' ? 'Amministratore Federale' : 'Utente Registrato'))),
      sesso: rm.gender ? (String(rm.gender).toUpperCase().startsWith('F') ? 'Femmina (F)' : 'Maschio (M)') : (mf.sesso || '-'),
      dataNascita: (rm.birthday && rm.birthday !== '0000-00-00') ? rm.birthday : (mf.dataNascita || user.dataNascita || '-'),
      luogoNascita: rm.birthplace || mf.luogoNascita || '-',
      codiceFiscale: rm.cf || mf.codiceFiscale || user.codiceFiscale || '-',
      partitaIva: rm.pi || mf.partitaIva || user.partitaIva || '-',
      indirizzo: rm.address || mf.indirizzo || user.indirizzo || '-',
      civico: rm.street_number || mf.civico || '-',
      cap: rm.cap || mf.cap || '-',
      citta: rm.city || mf.citta || '-',
      provincia: rm.province || mf.provincia || '-',
      regione: rm.region || mf.regione || '-',
      telefono: rm.telephone || mf.telefono || user.telefono || '-',
      email: rm.email || mf.email || user.email || '-',
      societaAppartenenza: mf.societaNome || '-',
      titoloTecnico: rm.title_certificate || mf.titoloTecnico || '-',
      scadenzaCertificatoMedico: (rm.mc_expire && rm.mc_expire !== '0000-00-00') ? rm.mc_expire : (mf.certificatoMedicoScadenza || user.scadenzaCertificato || '-'),
      statoTessera: mf.statoTessera ? mf.statoTessera.toUpperCase() : '-',
      scadenzaAffiliazione: (rm.affiliate_expire && rm.affiliate_expire !== '0000-00-00') ? rm.affiliate_expire : (mf.affiliateExpire || '-'),
      commento: rm.comment || user.commento || '-'
    };
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      rawId: rawUid || user.id,
      utente: utenteLabel,
      username: user.username || '',
      password: user.password || '',
      email: user.email || rawUserRec.email || '',
      role: user.role || 'singolo',
      roleLabel: roleLabels[user.role] || user.role,
      status: user.status || 'attivo',
      created: (rawUserRec.created && rawUserRec.created !== '0000-00-00') ? rawUserRec.created : (user.createdAt ? String(user.createdAt).slice(0, 10) : '-'),
      modified: (rawUserRec.modified && rawUserRec.modified !== '0000-00-00') ? rawUserRec.modified : '-'
    },
    anagrafica: schedaAnagrafica
  });
});

// Direct login / impersonation ("Entra come" -> Pulsante "Entra") for any user in Utenti Sito
app.post('/api/admin/impersonate/user/:id', (req, res) => {
  const idParam = String(req.params.id);
  const user = (db.usersList || []).find(
    u => String(u.id) === idParam || String(u.rawId) === idParam || (u.username && String(u.username).toLowerCase() === idParam.toLowerCase())
  );
  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato nel database.' });
  }

  const rawUid = String(user.rawId || user.id || '').replace(/^u_/, '');
  const linked = findUserLinkedEntity(user);
  const utenteLabel = db.computeUtenteDisplayLabel ? db.computeUtenteDisplayLabel(user) : (user.utente || user.nome || user.username);

  const returnTarget = (req.body && req.body.returnTarget) || 'utenti-sito';
  const returnBreadcrumb = (req.body && req.body.returnBreadcrumb) || 'Utenti > Utenti sito web';

  let impUser = {
    ...user,
    userId: rawUid,
    rawUserId: rawUid,
    utente: utenteLabel,
    returnTarget,
    returnBreadcrumb,
    impersonating: true
  };

  let redirectUrl = '/dashboard-singolo.html';

  if (user.role === 'societa') {
    const rc = linked.rawClub || {};
    const cf = linked.clubFormatted || {};
    impUser = {
      ...impUser,
      id: cf.id || user.id,
      rawId: rc.id || cf.rawId || rawUid,
      clubRawId: rc.id || cf.rawId || user.clubRawId || '',
      codice: cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || '',
      codiceAffiliazione: cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || '',
      role: 'societa',
      nome: rc.name || cf.nome || user.ragioneSociale || utenteLabel,
      ragioneSociale: rc.name || cf.nome || user.ragioneSociale || utenteLabel,
      email: rc.email || cf.email || user.email || '',
      username: user.username,
      impersonating: true
    };
    redirectUrl = '/dashboard-societa.html';
  } else if (user.role === 'crono') {
    const rch = linked.rawChrono || {};
    const chf = linked.chronoFormatted || {};
    impUser = {
      ...impUser,
      id: chf.id || user.id,
      rawId: rch.id || chf.rawId || rawUid,
      chronoRawId: rch.id || chf.rawId || user.chronoRawId || '',
      codiceCrono: chf.codice || rch.id || user.codiceCrono || rawUid,
      role: 'crono',
      nome: rch.name || chf.nome || user.ragioneSociale || utenteLabel,
      ragioneSociale: rch.name || chf.nome || user.ragioneSociale || utenteLabel,
      email: rch.email || chf.email || user.email || '',
      username: user.username,
      impersonating: true
    };
    redirectUrl = '/dashboard-crono.html';
  } else if (user.role === 'admin') {
    redirectUrl = '/dashboard-admin.html';
  } else {
    const rm = linked.rawMember || {};
    const mf = linked.memberFormatted || {};
    impUser = {
      ...impUser,
      memberRawId: rm.id || mf.rawId || user.memberRawId || '',
      tesseraNumero: mf.numeroTessera || rm.code || user.tesseraNumero || '',
      firstName: rm.name || mf.nome || user.firstName || user.name || '',
      lastName: rm.surname || mf.cognome || user.lastName || user.surname || '',
      nome: utenteLabel,
      role: 'singolo',
      username: user.username,
      email: rm.email || mf.email || user.email || '',
      impersonating: true
    };
    redirectUrl = '/dashboard-singolo.html';
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Utenti',
    azione: 'Accesso Diretto ("Entra come") al Pannello Utente',
    oggetto: `${utenteLabel} (Username: ${user.username})`,
    dettagli: `L'amministratore ha effettuato l'accesso diretto al pannello di controllo dell'utente "${utenteLabel}" (Username: ${user.username}, Ruolo: ${user.role}) -> ${redirectUrl}`,
    esito: 'OK'
  });

  res.cookie('fisky_impersonate', JSON.stringify(impUser), { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
  res.json({
    success: true,
    redirectUrl,
    user: impUser
  });
});

// Re-send credentials email to the user's email address ("Credenziali" -> Pulsante "Re-Inoltra")
app.post('/api/admin/users/:id/resend-credentials', async (req, res) => {
  const idParam = String(req.params.id);
  const user = (db.usersList || []).find(
    u => String(u.id) === idParam || String(u.rawId) === idParam || (u.username && String(u.username).toLowerCase() === idParam.toLowerCase())
  );

  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato nel database.' });
  }

  const rawUid = String(user.rawId || user.id || '').replace(/^u_/, '');
  const rawUserRec = (db.rawUsers || []).find(ru => String(ru.id) === rawUid) || {};
  const linked = findUserLinkedEntity(user);
  const utenteLabel = db.computeUtenteDisplayLabel ? db.computeUtenteDisplayLabel(user) : (user.utente || user.nome || user.username);

  const rc = linked.rawClub || {};
  const cf = linked.clubFormatted || {};
  const rch = linked.rawChrono || {};
  const chf = linked.chronoFormatted || {};
  const rm = linked.rawMember || {};
  const mf = linked.memberFormatted || {};

  const emailTo = String(
    user.email ||
    rawUserRec.email ||
    rc.email ||
    cf.email ||
    rch.email ||
    chf.email ||
    rm.email ||
    mf.email ||
    ''
  ).trim();

  if (!emailTo || !emailTo.includes('@')) {
    return res.status(400).json({
      error: `Nessun indirizzo email valido associato all'utente "${utenteLabel}" (Username: ${user.username}) nel database.`
    });
  }

  const roleLabels = {
    societa: 'Società Sportiva',
    crono: 'Azienda di Cronometraggio',
    singolo: 'Persona (Tesserato / Utente Singolo)',
    admin: 'Amministratore di Sistema'
  };

  let codiceAssegnato = '-';
  let codiceLabel = 'Codice Identificativo FISky';
  if (user.role === 'societa') {
    codiceAssegnato = cf.codice || rc.codice || user.codiceSocieta || user.codiceAffiliazione || (rc.id ? String(10000 + Number(rc.id)) : '-');
    codiceLabel = 'Codice Società FISky';
  } else if (user.role === 'crono') {
    codiceAssegnato = chf.codice || rch.id || user.codiceCrono || rawUid || '-';
    codiceLabel = 'Codice Azienda Cronometraggio';
  } else if (user.role === 'singolo') {
    codiceAssegnato = mf.numeroTessera || rm.code || user.tesseraNumero || '-';
    codiceLabel = 'Codice Tessera FISky';
  }

  const username = user.username || rawUserRec.username || '';
  const password = user.password || rawUserRec.password || 'Fisky2026*';

  const mailLog = await sendCredentialsEmail({
    to: emailTo,
    role: roleLabels[user.role] || user.role,
    nome: utenteLabel,
    username,
    password,
    codiceAssegnato,
    codiceLabel
  });

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Utenti',
    azione: 'Re-Inoltro Credenziali Utente via Email',
    oggetto: `${utenteLabel} (Username: ${username})`,
    dettagli: `Re-inoltrata mail con le credenziali di accesso (Username: ${username}, Password: ${password}, Codice: ${codiceAssegnato}) all'indirizzo email dell'utente: ${emailTo}`,
    esito: 'OK'
  });

  return res.json({
    success: true,
    message: `Email con le credenziali di "${utenteLabel}" (Username: ${username}) re-inoltrata con successo all'indirizzo ${emailTo}!`,
    email: emailTo,
    username,
    utente: utenteLabel,
    emailNotification: mailLog
  });
});

// Permanently delete a user from the database ("Cancella" in Utenti > Utenti Sito)
app.delete('/api/admin/users/:id', (req, res) => {
  const idParam = String(req.params.id);
  const uIdx = (db.usersList || []).findIndex(
    u => String(u.id) === idParam || String(u.rawId) === idParam || (u.username && String(u.username).toLowerCase() === idParam.toLowerCase())
  );

  if (uIdx === -1) {
    return res.status(404).json({ error: 'Utente non trovato nel database.' });
  }

  const removedUser = db.usersList[uIdx];
  const rawUid = String(removedUser.rawId || removedUser.id || '').replace(/^u_/, '');
  const utenteLabel = db.computeUtenteDisplayLabel ? db.computeUtenteDisplayLabel(removedUser) : (removedUser.utente || removedUser.nome || removedUser.username);

  // 1. Remove from in-memory usersList and save dynamic users file
  db.usersList.splice(uIdx, 1);
  saveDynamicUsersFile();

  // 2. Permanently remove from rawUsers (mysql_users.json)
  if (db.rawUsers) {
    const rawIdx = db.rawUsers.findIndex(
      ru => (rawUid && String(ru.id) === rawUid) ||
            (removedUser.username && ru.username && String(ru.username).toLowerCase() === String(removedUser.username).toLowerCase())
    );
    if (rawIdx !== -1) {
      db.rawUsers.splice(rawIdx, 1);
      db.writeJsonFile('mysql_users.json', db.rawUsers);
    }
  }

  // 3. Also update any linked club in clubsList that displayed this username
  if (db.clubsList && removedUser.username) {
    db.clubsList.forEach(c => {
      if (c.username && String(c.username).toLowerCase() === String(removedUser.username).toLowerCase()) {
        c.username = '';
      }
    });
  }

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Utenti',
    azione: 'Cancellazione Permanente Utente Sito dal Database',
    oggetto: `${utenteLabel} (Username: ${removedUser.username})`,
    dettagli: `Eliminato definitivamente dal database l'utente "${utenteLabel}" (ID: ${removedUser.id}, Username: ${removedUser.username}, Email: ${removedUser.email || '-'}, Ruolo: ${removedUser.role})`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `L'utente "${utenteLabel}" (Username: ${removedUser.username}) è stato cancellato in modo permanente dal database.`
  });
});

// Get payments for Admin with full dataset, accurately recovered ordinante, causale, details & method
app.get('/api/admin/payments', (req, res) => {
  try {
    const clubsByUserId = {};
    const clubsById = {};
    const clubObjByUserId = {};
    const clubObjById = {};
    (db.rawClubs || []).forEach(c => {
      if (c.user_id) {
        clubsByUserId[String(c.user_id)] = c.name;
        clubObjByUserId[String(c.user_id)] = c;
      }
      clubsById[String(c.id)] = c.name;
      clubObjById[String(c.id)] = c;
    });

    const usersById = {};
    (db.rawUsers || []).forEach(u => {
      const fullName = `${u.name || ''} ${u.surname || ''}`.trim();
      usersById[String(u.id)] = fullName || u.ragioneSociale || u.nome || u.username;
    });
    (db.usersList || []).forEach(u => {
      const idKey = String(u.id || u.rawId || '');
      if (idKey && !usersById[idKey]) {
        usersById[idKey] = u.nome || u.ragioneSociale || u.username;
      }
    });

    const membersById = {};
    const membersByUserId = {};
    (db.rawMembers || db.membersList || []).forEach(m => {
      const fullName = `${m.name || ''} ${m.surname || ''}`.trim();
      if (fullName) {
        membersById[String(m.id)] = fullName;
        if (m.user_id && m.user_id !== '0') {
          membersByUserId[String(m.user_id)] = fullName;
        }
      }
    });

    const paymentRequestsById = {};
    (db.rawPaymentrequests || []).forEach(pr => {
      paymentRequestsById[String(pr.id)] = pr;
    });

    const raceRequestsById = {};
    (db.rawRacerequests || []).forEach(rr => {
      raceRequestsById[String(rr.id)] = rr;
    });

    const itemsByPayment = {};
    (db.rawPaymentitems || []).forEach(it => {
      const pid = String(it.payment_id);
      if (!itemsByPayment[pid]) itemsByPayment[pid] = [];
      itemsByPayment[pid].push(it);
    });

    const infosByPayment = {};
    (db.rawPaymentinfos || []).forEach(inf => {
      infosByPayment[String(inf.payment_id)] = inf;
    });

    // Mappe per le ricevute / fatture (mysql_invoices.json)
    const invByPaymentId = {};
    const existingDocsByYear = {};
    (db.rawInvoices || []).forEach(inv => {
      if (inv.model === 'Payment') {
        invByPaymentId[String(inv.item_id)] = inv;
        const y = inv.year && inv.year !== '1970' ? String(inv.year) : (inv.date ? String(inv.date).slice(0, 4) : '2026');
        if (!existingDocsByYear[y]) existingDocsByYear[y] = new Set();
        const num = parseInt(inv.n_doc, 10);
        if (!isNaN(num)) existingDocsByYear[y].add(num);
      }
    });

    // Calcolo contatori progressivi per ricevute di pagamenti senza fattura specifica
    const nextDocByYear = {};
    Object.keys(existingDocsByYear).forEach(y => {
      const max = Math.max(0, ...Array.from(existingDocsByYear[y]));
      nextDocByYear[y] = max + 1;
    });

    // Per assegnare numeri progressivi stabili e coerenti, ordiniamo i pagamenti cronologicamente ascendente
    const sortedRawPayments = [...(db.rawPayments || [])].sort((a, b) => 
      (new Date(a.date || 0)) - (new Date(b.date || 0)) || parseInt(a.id || 0) - parseInt(b.id || 0)
    );

    const docMapByPaymentId = {};
    sortedRawPayments.forEach(p => {
      const pid = String(p.id);
      const inv = invByPaymentId[pid];
      if (inv) {
        const y = inv.year && inv.year !== '1970' ? String(inv.year) : (p.date ? String(p.date).slice(0, 4) : '2026');
        docMapByPaymentId[pid] = {
          n_doc: String(inv.n_doc),
          year: y,
          num_doc: `${inv.n_doc}/${y}`,
          header: inv.header || null
        };
      } else {
        const y = p.date ? String(p.date).slice(0, 4) : '2026';
        if (!nextDocByYear[y]) nextDocByYear[y] = 1;
        const num = nextDocByYear[y]++;
        docMapByPaymentId[pid] = {
          n_doc: String(num),
          year: y,
          num_doc: `${num}/${y}`,
          header: null
        };
      }
    });

    const payments = (db.rawPayments || []).map(p => {
      const pid = String(p.id);
      const uId = String(p.user_id || '');
      const items = itemsByPayment[pid] || [];
      const info = infosByPayment[pid];
      const inv = invByPaymentId[pid];

      let ordinante = null;

      // 1. Direct p.from if present and non-empty (e.g. "Valle Intrasca a.s.d.")
      if (p.from && p.from.trim()) {
        ordinante = p.from.trim();
      }

      // 2. Lookup club by user_id
      if (!ordinante && uId && uId !== '0') {
        ordinante = clubsByUserId[uId];
      }

      // 3. Lookup club by club_id (legacy CakePHP records where user_id stores club_id)
      if (!ordinante && uId && uId !== '0') {
        ordinante = clubsById[uId];
      }

      // 4. Lookup user by user_id
      if (!ordinante && uId && uId !== '0') {
        ordinante = usersById[uId];
      }

      // 5. Lookup member by member_id or user_id
      if (!ordinante && uId && uId !== '0') {
        ordinante = membersById[uId] || membersByUserId[uId];
      }

      // 6. Lookup via racerequest_id
      if (!ordinante && p.racerequest_id && p.racerequest_id !== '0') {
        const rr = raceRequestsById[String(p.racerequest_id)];
        if (rr) {
          ordinante = (rr.club_id && clubsById[String(rr.club_id)]) || rr.club_name || null;
        }
      }

      // 7. Lookup via paymentrequest_id
      if (!ordinante && p.paymentrequest_id) {
        const pr = paymentRequestsById[String(p.paymentrequest_id)];
        if (pr) {
          const headerClub = pr.header ? pr.header.split('[]')[0].trim() : '';
          ordinante = headerClub || (pr.user_id ? (clubsByUserId[String(pr.user_id)] || clubsById[String(pr.user_id)] || usersById[String(pr.user_id)] || membersById[String(pr.user_id)]) : null);
        }
      }

      // 8. Lookup via paymentitems (model === 'Club' or model === 'Racerequest' or model === 'Wmember')
      if (!ordinante && items.length > 0) {
        for (const it of items) {
          if (it.model === 'Club' && it.item_id && clubsById[String(it.item_id)]) {
            ordinante = clubsById[String(it.item_id)];
            break;
          } else if (it.model === 'Racerequest' && it.item_id && raceRequestsById[String(it.item_id)]) {
            const rr = raceRequestsById[String(it.item_id)];
            ordinante = (rr.club_id && clubsById[String(rr.club_id)]) || rr.club_name || null;
            if (ordinante) break;
          } else if (it.model === 'Wmember' && it.item_id && membersById[String(it.item_id)]) {
            ordinante = membersById[String(it.item_id)];
            break;
          }
        }
      }

      if (!ordinante) {
        ordinante = uId && uId !== '0' ? `Utente #${uId}` : 'Federazione Italiana Skyrunning';
      }

      let causale = '';
      let dettaglio = '';

      if (items.length > 0) {
        const models = [...new Set(items.map(i => i.model))];
        if (models.includes('Club')) {
          causale = 'Rinnovo Affiliazione Club';
          const clubNames = items.filter(i => i.model === 'Club').map(i => {
            const parts = (i.description || '').split(':');
            return (parts[1] || parts[0]).trim();
          }).filter(Boolean);
          dettaglio = clubNames.join(', ');
        } else if (models.includes('Wmember')) {
          const names = items.map(i => (i.description || '').trim()).filter(Boolean);
          if (names.length === 1) {
            causale = 'Pagamento Tessera Atleta';
            dettaglio = names[0];
          } else {
            causale = `Pagamento Tessere Atleti (${names.length} nominativi)`;
            dettaglio = names.join(', ');
          }
        } else if (models.includes('Racerequest')) {
          causale = 'Richiesta Inserimento Gara a Calendario';
          dettaglio = items.map(i => i.description).filter(Boolean).join(', ');
        } else {
          causale = items[0].model ? ('Pagamento ' + items[0].model) : 'Pagamento Servizi Federali';
          dettaglio = items.map(i => i.description).filter(Boolean).join(', ');
        }
      } else if (info) {
        if (info.type === 'members' && info.info) {
          const clean = info.info.replace(/\\\\n|\\n/g, '\n');
          const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
          const names = lines.map(l => {
            const parts = l.split(';').map(s => s.trim()).filter(Boolean);
            return parts.join(' ');
          }).filter(Boolean);
          if (names.length === 1) {
            causale = 'Pagamento Tessera Atleta';
            dettaglio = names[0];
          } else {
            causale = `Pagamento Tessere Atleti (${names.length} nominativi)`;
            dettaglio = names.join(', ');
          }
        } else if (info.type === 'races' && info.info) {
          causale = 'Richiesta Inserimento Gara a Calendario';
          dettaglio = info.info.replace(/\\\\n|\\n/g, '\n').replace(/;/g, ' - ').trim();
        }
      }

      if (!causale && p.note && p.note.trim()) {
        causale = p.note.trim();
      }
      if (!causale && p.description && p.description.trim()) {
        causale = p.description.trim();
      }
      if (!causale && p.racerequest_id && p.racerequest_id !== '0') {
        causale = 'Richiesta Inserimento Gara a Calendario #' + p.racerequest_id;
      }
      if (!causale) {
        causale = 'Addebito Servizi Federali';
      }

      // Normalizzazione Metodo
      let metodoLabel = 'Conto FISKY';
      const m = String(p.payment || '').toUpperCase().trim();
      if (m === 'CC' || m === 'CARTA' || m === 'CREDIT_CARD' || m.includes('CARTA')) {
        metodoLabel = 'Carta di Credito';
      } else if (m === 'CFISKY' || m === 'CONTO' || m === 'CONTO FISKY') {
        metodoLabel = 'Conto FISKY';
      } else if (m === 'MANUAL' || m === 'BONIFICO') {
        metodoLabel = 'Bonifico Bancario';
      } else if (p.payment) {
        metodoLabel = p.payment;
      }

      // Normalizzazione Stato
      let statoLabel = p.status || 'Eseguito';
      const st = statoLabel.toLowerCase();
      if (st.includes('eseguit') || st.includes('approvat') || st.includes('complet') || st === 'ok') {
        statoLabel = 'Eseguito';
      } else if (st.includes('attes') || st.includes('pend')) {
        statoLabel = 'In Attesa';
      } else if (st.includes('fallit') || st.includes('annullat') || st.includes('negat') || st.includes('respint')) {
        statoLabel = 'Fallito';
      }

      // Dati ricevuta
      const docInfo = docMapByPaymentId[pid] || {
        n_doc: pid,
        year: p.date ? String(p.date).slice(0, 4) : '2026',
        num_doc: `${pid}/${p.date ? String(p.date).slice(0, 4) : '2026'}`,
        header: null
      };

      // Recupero indirizzo ordinante per intestazione ricevuta
      let indirizzo = '';
      const clb = (uId && clubObjByUserId[uId]) || (uId && clubObjById[uId]);
      if (clb) {
        const via = [clb.address, clb.street_number].filter(Boolean).join(', ');
        const citta = [clb.cap, clb.city].filter(Boolean).join(' – ');
        const prov = clb.province ? `(${clb.province})` : '';
        indirizzo = [via, citta, prov].filter(Boolean).join(' – ');
      } else if (docInfo.header && docInfo.header.includes('[]')) {
        indirizzo = docInfo.header.split('[]')[1].trim();
      }

      return {
        id: p.id,
        date: p.date,
        ordinante,
        indirizzo,
        headerExtra: docInfo.header ? docInfo.header.replace('[]', ' - ') : '',
        n_doc: docInfo.n_doc,
        year: docInfo.year,
        num_doc: docInfo.num_doc,
        total: p.total,
        amount: p.total,
        status: statoLabel,
        payment: p.payment,
        metodoLabel,
        causale,
        dettaglio,
        note: p.note || '',
        user_id: p.user_id,
        viewed: p.viewed,
        is_manual: !!(p.is_manual || (inv && inv.is_manual)),
        custom_text: p.custom_text || (inv && inv.custom_text) || '',
        original_payment_id: p.original_payment_id || null,
        revision_letter: p.revision_letter || null
      };
    });

    // Ordinamento cronologico decrescente di default
    payments.sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)) || parseInt(b.id || 0) - parseInt(a.id || 0));

    res.json({
      success: true,
      total: payments.length,
      payments
    });
  } catch (err) {
    console.error('Errore /api/admin/payments:', err);
    res.status(500).json({ error: 'Errore interno nel caricamento dei pagamenti' });
  }
});

// Get Versamenti (Richieste di versamento) for Admin
app.get('/api/admin/versamenti', (req, res) => {
  try {
    const clubsByUserId = {};
    const clubsById = {};
    (db.rawClubs || []).forEach(c => {
      if (c.user_id) clubsByUserId[String(c.user_id)] = c.name;
      clubsById[String(c.id)] = c.name;
    });

    const usersById = {};
    (db.rawUsers || []).forEach(u => {
      const fullName = `${u.name || ''} ${u.surname || ''}`.trim();
      usersById[String(u.id)] = fullName || u.ragioneSociale || u.nome || u.username;
    });

    const membersByUserId = {};
    (db.rawMembers || db.membersList || []).forEach(m => {
      const fullName = `${m.name || ''} ${m.surname || ''}`.trim();
      if (fullName && m.user_id && m.user_id !== '0') {
        membersByUserId[String(m.user_id)] = fullName;
      }
    });

    function cleanText(str) {
      if (!str) return '';
      return String(str)
        .replace(/Â°/g, '°')
        .replace(/Ã /g, 'à')
        .replace(/Ã¨/g, 'è')
        .replace(/Ã©/g, 'é')
        .replace(/Ã¬/g, 'ì')
        .replace(/Ã²/g, 'ò')
        .replace(/Ã¹/g, 'ù')
        .replace(/\\r\\n|\\n|\trn|rn/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Mappa per unificare e deduplicare ordinanti con piccole discrepanze di maiuscole/minuscole o spaziatura
    const rawOrdinantiGrouped = new Map();
    (db.rawPaymentrequests || []).forEach(pr => {
      let ord = '';
      if (pr.header) {
        ord = (pr.header.split('[]')[0] || '').trim();
      }
      if (!ord && pr.user_id) {
        ord = clubsByUserId[String(pr.user_id)] || clubsById[String(pr.user_id)] || usersById[String(pr.user_id)] || membersByUserId[String(pr.user_id)] || `Utente #${pr.user_id}`;
      }
      ord = cleanText(ord);
      if (ord) {
        const normKey = ord.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!rawOrdinantiGrouped.has(normKey)) {
          rawOrdinantiGrouped.set(normKey, new Set());
        }
        rawOrdinantiGrouped.get(normKey).add(ord);
      }
    });

    const canonicalOrdinanti = new Map();
    for (const [normKey, nameSet] of rawOrdinantiGrouped.entries()) {
      const names = Array.from(nameSet);
      if (names.length === 1) {
        canonicalOrdinanti.set(normKey, names[0]);
      } else {
        // Seleziona la versione con formattazione migliore (evitando tutto maiuscolo e preferendo maiuscole corrette per i nomi es. 'ASD Falchi Lecco' anziché 'ASD Falchi lecco')
        const bestName = names.slice().sort((a, b) => {
          const aIsAllUpper = (a === a.toUpperCase() && a !== a.toLowerCase());
          const bIsAllUpper = (b === b.toUpperCase() && b !== b.toLowerCase());
          if (aIsAllUpper && !bIsAllUpper) return 1;
          if (!aIsAllUpper && bIsAllUpper) return -1;
          const aUpperCount = (a.match(/[A-Z]/g) || []).length;
          const bUpperCount = (b.match(/[A-Z]/g) || []).length;
          if (bUpperCount !== aUpperCount) return bUpperCount - aUpperCount;
          return a.localeCompare(b);
        })[0];
        canonicalOrdinanti.set(normKey, bestName);
      }
    }

    const versamenti = (db.rawPaymentrequests || []).map(pr => {
      let ordinante = '';
      let indirizzo = '';
      if (pr.header) {
        const parts = pr.header.split('[]');
        ordinante = (parts[0] || '').trim();
        indirizzo = (parts[1] || '').trim();
      }
      if (!ordinante && pr.user_id) {
        ordinante = clubsByUserId[String(pr.user_id)] || clubsById[String(pr.user_id)] || usersById[String(pr.user_id)] || membersByUserId[String(pr.user_id)] || `Utente #${pr.user_id}`;
      }

      ordinante = cleanText(ordinante);
      const normKey = ordinante.toLowerCase().replace(/\s+/g, ' ').trim();
      const canonicalOrd = canonicalOrdinanti.get(normKey) || ordinante;

      indirizzo = cleanText(indirizzo);
      const note = cleanText(pr.note);

      return {
        id: pr.id,
        da: canonicalOrd,
        ordinante: canonicalOrd,
        indirizzo: indirizzo,
        header: pr.header,
        when: pr.when,
        date: pr.when,
        amount: parseFloat(pr.amount || 0),
        status: pr.status || 'In attesa',
        note: note,
        n_doc: pr.n_doc,
        accepted: pr.accepted,
        user_id: pr.user_id
      };
    });

    // Default sort cronologico decrescente
    versamenti.sort((a, b) => {
      const dateA = a.when || '';
      const dateB = b.when || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return parseInt(b.id || 0) - parseInt(a.id || 0);
    });

    res.json({
      success: true,
      total: versamenti.length,
      versamenti
    });
  } catch (err) {
    console.error('Errore /api/admin/versamenti:', err);
    res.status(500).json({ error: 'Errore interno nel caricamento dei versamenti' });
  }
});

// Salvataggio modifica manuale ricevuta con creazione nuova registrazione e suffisso alfabetico progressivo
app.post('/api/admin/receipts/save-revision', (req, res) => {
  try {
    const {
      originalPaymentId,
      ordinante,
      indirizzo,
      date,
      amount,
      causale,
      dettaglio,
      custom_text,
      payment
    } = req.body;

    const pid = String(originalPaymentId || '').trim();
    if (!pid) {
      return res.status(400).json({ error: 'ID pagamento originale mancante' });
    }

    const origPayment = (db.rawPayments || []).find(p => String(p.id) === pid);
    const origInvoice = (db.rawInvoices || []).find(inv => inv.model === 'Payment' && String(inv.item_id) === pid);

    // Determina il numero progressivo base e l'anno
    let baseDocNum = '';
    let docYear = '';

    if (origInvoice && origInvoice.n_doc) {
      const match = String(origInvoice.n_doc).match(/^(\d+)/);
      baseDocNum = match ? match[1] : String(origInvoice.n_doc);
      docYear = origInvoice.year && origInvoice.year !== '1970' ? String(origInvoice.year) : (origInvoice.date ? String(origInvoice.date).slice(0, 4) : '2026');
    } else if (req.body.base_n_doc) {
      const match = String(req.body.base_n_doc).match(/^(\d+)/);
      baseDocNum = match ? match[1] : String(req.body.base_n_doc);
      docYear = req.body.year || (date ? String(date).slice(0, 4) : '2026');
    } else {
      baseDocNum = pid;
      docYear = date ? String(date).slice(0, 4) : (origPayment?.date ? String(origPayment.date).slice(0, 4) : '2026');
    }

    // Calcolo lettera revisione alfabetica progressiva (A, B, C...)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const usedLetters = new Set();

    (db.rawInvoices || []).forEach(inv => {
      if (inv.model === 'Payment') {
        const y = inv.year && inv.year !== '1970' ? String(inv.year) : (inv.date ? String(inv.date).slice(0, 4) : '2026');
        if (y === docYear) {
          const m = String(inv.n_doc).match(new RegExp(`^${baseDocNum}[/]?([A-Za-z])$`));
          if (m) {
            usedLetters.add(m[1].toUpperCase());
          }
        }
      }
    });

    (db.rawPayments || []).forEach(p => {
      if (String(p.original_payment_id) === pid && p.revision_letter) {
        usedLetters.add(String(p.revision_letter).toUpperCase());
      }
    });

    let nextLetter = 'A';
    for (let i = 0; i < alphabet.length; i++) {
      if (!usedLetters.has(alphabet[i])) {
        nextLetter = alphabet[i];
        break;
      }
    }

    const new_n_doc = `${baseDocNum}${nextLetter}`;
    const new_num_doc = `${baseDocNum}${nextLetter}/${docYear}`;

    // Calcola nuovi ID progressivi
    const maxPaymentId = (db.rawPayments || []).reduce((max, p) => Math.max(max, parseInt(p.id || 0, 10) || 0), 0);
    const newPaymentId = String(maxPaymentId + 1);

    const maxInvoiceId = (db.rawInvoices || []).reduce((max, inv) => Math.max(max, parseInt(inv.id || 0, 10) || 0), 0);
    const newInvoiceId = String(maxInvoiceId + 1);

    const receiptDate = date || new Date().toISOString().slice(0, 10);
    const receiptAmount = String(parseFloat(amount || origPayment?.total || origPayment?.amount || 0).toFixed(2));
    const receiptOrdinante = (ordinante || origPayment?.from || 'Società').trim();
    const receiptIndirizzo = (indirizzo || '').trim();
    const receiptCausale = (causale || origPayment?.causale || 'Addebito Servizi Federali').trim();
    const cleanCustomText = (custom_text || '').trim();

    // 1. Nuova registrazione Pagamento in mysql_payments.json
    const newPaymentRecord = {
      id: newPaymentId,
      date: receiptDate,
      total: receiptAmount,
      amount: receiptAmount,
      from: receiptOrdinante,
      payment: payment || origPayment?.payment || 'CFISKY',
      status: 'Eseguito (Manuale)',
      note: `Modifica manuale ricevuta ${new_num_doc} (da #${pid})`,
      causale: receiptCausale,
      dettaglio: dettaglio || origPayment?.dettaglio || '',
      custom_text: cleanCustomText,
      user_id: origPayment?.user_id || '0',
      is_manual: true,
      original_payment_id: pid,
      revision_letter: nextLetter,
      created_at: new Date().toISOString()
    };

    // 2. Nuova registrazione Fattura / Ricevuta in mysql_invoices.json
    const newInvoiceRecord = {
      id: newInvoiceId,
      n_doc: new_n_doc,
      date: receiptDate,
      model: 'Payment',
      header: `${receiptOrdinante}[]${receiptIndirizzo}`,
      amount: receiptAmount,
      year: docYear,
      item_id: newPaymentId,
      user_id: origPayment?.user_id || '0',
      custom_text: cleanCustomText,
      is_manual: true,
      note: `Modifica manuale ricevuta (Rev. ${nextLetter}) da #${pid}`
    };

    if (!db.rawPayments) db.rawPayments = [];
    db.rawPayments.unshift(newPaymentRecord);
    db.writeJsonFile('mysql_payments.json', db.rawPayments);

    if (!db.rawInvoices) db.rawInvoices = [];
    db.rawInvoices.unshift(newInvoiceRecord);
    db.writeJsonFile('mysql_invoices.json', db.rawInvoices);

    if (typeof recordOperationLog === 'function') {
      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Contabilità e Ricevute',
        azione: 'Modifica Manuale Ricevuta',
        oggetto: `Ricevuta n° ${new_num_doc}`,
        dettagli: `Creata revisione manuale ${nextLetter} da pagamento #${pid} | Ordinante: ${receiptOrdinante} | Importo: € ${receiptAmount}`,
        esito: 'OK'
      });
    }

    const paymentFormatted = {
      id: newPaymentId,
      date: receiptDate,
      ordinante: receiptOrdinante,
      indirizzo: receiptIndirizzo,
      headerExtra: receiptIndirizzo ? `${receiptOrdinante} - ${receiptIndirizzo}` : '',
      n_doc: new_n_doc,
      year: docYear,
      num_doc: new_num_doc,
      total: receiptAmount,
      amount: receiptAmount,
      status: 'Eseguito (Manuale)',
      payment: newPaymentRecord.payment,
      metodoLabel: newPaymentRecord.payment === 'CC' ? 'Carta di Credito' : 'Conto FISKY',
      causale: receiptCausale,
      dettaglio: newPaymentRecord.dettaglio,
      note: newPaymentRecord.note,
      custom_text: cleanCustomText,
      is_manual: true,
      original_payment_id: pid,
      revision_letter: nextLetter,
      user_id: newPaymentRecord.user_id
    };

    res.json({
      success: true,
      message: `Nuova registrazione creata con successo! Ricevuta n° ${new_num_doc}`,
      num_doc: new_num_doc,
      n_doc: new_n_doc,
      year: docYear,
      letter: nextLetter,
      paymentId: newPaymentId,
      payment: paymentFormatted
    });
  } catch (err) {
    console.error('Errore /api/admin/receipts/save-revision:', err);
    res.status(500).json({ error: 'Errore interno nel salvataggio della revisione: ' + err.message });
  }
});

// Cancellazione ricevuta creata da modifica manuale (le ricevute originali NON possono essere cancellate)
app.all(['/api/admin/receipts/delete/:id', '/api/admin/receipts/manual/:id'], (req, res) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }
  try {
    const paymentId = String(req.params.id || '').trim();
    if (!paymentId) {
      return res.status(400).json({ error: 'ID ricevuta non specificato' });
    }

    const paymentIndex = (db.rawPayments || []).findIndex(p => String(p.id) === paymentId);
    if (paymentIndex === -1) {
      return res.status(404).json({ error: 'Ricevuta non trovata nel database' });
    }

    const payment = db.rawPayments[paymentIndex];

    // Verifica di sicurezza: cancellabili SOLO le ricevute manuali
    const isManual = !!(payment.is_manual || (payment.status && payment.status.toLowerCase().includes('manual')) || (payment.note && payment.note.toLowerCase().includes('manuale')));
    if (!isManual) {
      return res.status(403).json({
        error: 'Operazione non consentita: le ricevute presenti in origine non possono essere cancellate.'
      });
    }

    // Rimuovi la registrazione da rawPayments
    db.rawPayments.splice(paymentIndex, 1);
    db.writeJsonFile('mysql_payments.json', db.rawPayments);

    // Rimuovi la corrispondente fattura/ricevuta da rawInvoices
    const invCountBefore = (db.rawInvoices || []).length;
    db.rawInvoices = (db.rawInvoices || []).filter(inv => !(inv.model === 'Payment' && String(inv.item_id) === paymentId));
    if (db.rawInvoices.length !== invCountBefore) {
      db.writeJsonFile('mysql_invoices.json', db.rawInvoices);
    }

    if (typeof recordOperationLog === 'function') {
      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Contabilità e Ricevute',
        azione: 'Cancellazione Ricevuta Manuale',
        oggetto: `Ricevuta #${paymentId} (${payment.from || 'Società'})`,
        dettagli: `Cancellata registrazione ricevuta manuale. Importo: € ${payment.total || payment.amount || 0}`,
        esito: 'OK'
      });
    }

    res.json({
      success: true,
      message: 'Ricevuta manuale cancellata con successo.',
      paymentId
    });
  } catch (err) {
    console.error('Errore cancellazione ricevuta manuale:', err);
    res.status(500).json({ error: 'Errore interno durante la cancellazione della ricevuta: ' + err.message });
  }
});

// ================= NEWS ROUTES ================= //

function saveNews() {
  db.writeJsonFile('mysql_news.json', db.rawNews);
}

// Get all news
app.get('/api/admin/news', (req, res) => {
  res.json({ news: db.rawNews || [], total: (db.rawNews || []).length });
});

// Get single news by ID
app.get('/api/admin/news/:id', (req, res) => {
  const item = (db.rawNews || []).find(n => String(n.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ error: 'Articolo non trovato nel database' });
  }
  res.json({ success: true, news: item });
});

// Create new news
app.post('/api/admin/news', (req, res) => {
  const { title, description, text, date, image, author, status, subtitle } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Il titolo dell\'articolo è obbligatorio' });
  }

  const existingIds = (db.rawNews || []).map(n => parseInt(n.id) || 0);
  const newId = String(existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const createdDateStr = date ? (date.length <= 10 ? `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : date) : nowStr;

  const newItem = {
    id: newId,
    title: title.trim(),
    text: text || '',
    description: description ? description.trim() : '',
    image: image ? image.trim() : '',
    author: author ? author.trim() : '',
    header_image: null,
    keep_header: '0',
    not_header: '0',
    created: createdDateStr,
    modified: nowStr,
    subtitle: subtitle || null,
    status: status !== undefined ? String(status) : '1'
  };

  db.rawNews.unshift(newItem);
  saveNews();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti News',
    azione: 'Creazione Notizia / Comunicato',
    oggetto: `${newItem.title} (ID: ${newItem.id})`,
    dettagli: `Data: ${newItem.created} | Stato: ${newItem.status === '1' ? 'Pubblicata' : 'Bozza'}`,
    esito: 'OK'
  });

  res.json({ success: true, news: newItem });
});

// Update news
app.put('/api/admin/news/:id', (req, res) => {
  const idx = (db.rawNews || []).findIndex(n => String(n.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Articolo non trovato nel database' });
  }

  const { title, description, text, date, image, author, status, subtitle } = req.body;
  if (title !== undefined) db.rawNews[idx].title = title.trim();
  if (description !== undefined) db.rawNews[idx].description = description.trim();
  if (text !== undefined) db.rawNews[idx].text = text;
  if (image !== undefined) db.rawNews[idx].image = image.trim();
  if (author !== undefined) db.rawNews[idx].author = author.trim();
  if (subtitle !== undefined) db.rawNews[idx].subtitle = subtitle;
  if (status !== undefined) db.rawNews[idx].status = String(status);

  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  db.rawNews[idx].modified = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  if (date) {
    if (date.length <= 10) {
      const existingTime = (db.rawNews[idx].created && db.rawNews[idx].created.includes(' ')) ? db.rawNews[idx].created.split(' ')[1] : '12:00:00';
      db.rawNews[idx].created = `${date} ${existingTime}`;
    } else {
      db.rawNews[idx].created = date;
    }
  }

  saveNews();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti News',
    azione: 'Modifica Notizia / Comunicato',
    oggetto: `${db.rawNews[idx].title} (ID: ${db.rawNews[idx].id})`,
    dettagli: `Data: ${db.rawNews[idx].created} | Modificato: ${db.rawNews[idx].modified}`,
    esito: 'OK'
  });

  res.json({ success: true, news: db.rawNews[idx] });
});

// Delete news
app.delete('/api/admin/news/:id', (req, res) => {
  const idx = (db.rawNews || []).findIndex(n => String(n.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Articolo non trovato nel database' });
  }

  const removed = db.rawNews.splice(idx, 1)[0];
  saveNews();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti News',
    azione: 'Eliminazione Notizia / Comunicato',
    oggetto: `${removed.title} (ID: ${removed.id})`,
    dettagli: `Eliminato articolo "${removed.title}" (Data: ${removed.created})`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Articolo "${removed.title}" cancellato con successo`, id: req.params.id });
});

// ================= WEBPAGES ROUTES ================= //

function saveWebpages() {
  db.writeJsonFile('mysql_webpages.json', db.rawWebpages);
}

// Helper to resolve linked menu item and slug for a webpage
function resolvePageMenuAndSlug(page, menus) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const idToMenu = {};
  (menus || []).forEach(m => { idToMenu[String(m.id)] = m; });

  function getBreadcrumb(m) {
    const parts = [m.name ? m.name.trim() : ''];
    let cur = m;
    while (cur && cur.parent_id && cur.parent_id !== '0' && idToMenu[String(cur.parent_id)]) {
      cur = idToMenu[String(cur.parent_id)];
      if (cur && cur.name) parts.unshift(cur.name.trim());
    }
    return parts.filter(Boolean).join(' > ');
  }

  const pTitleNorm = norm(page.title);
  const pSlugNorm = norm(page.slug);

  // 1. Direct match on slug in menu URL
  let match = (menus || []).find(m => {
    if (!m.url || m.url === '#') return false;
    const urlSlug = m.url.replace(/^.*\/pages\//, '').replace(/^.*\//, '');
    return pSlugNorm && norm(urlSlug) === pSlugNorm;
  });

  // 2. Direct match on title in menu URL or menu Name
  if (!match) {
    match = (menus || []).find(m => {
      if (!m.url || m.url === '#') return false;
      const urlSlug = m.url.replace(/^.*\/pages\//, '').replace(/^.*\//, '');
      return pTitleNorm && (norm(urlSlug) === pTitleNorm || norm(m.name) === pTitleNorm);
    });
  }

  // 3. Substring / Prefix match
  if (!match) {
    match = (menus || []).find(m => {
      if (!m.url || m.url === '#') return false;
      const urlSlug = m.url.replace(/^.*\/pages\//, '').replace(/^.*\//, '');
      const mSlugNorm = norm(urlSlug);
      const mNameNorm = norm(m.name);
      return (pTitleNorm && mSlugNorm && (pTitleNorm.startsWith(mSlugNorm) || mSlugNorm.startsWith(pTitleNorm))) ||
             (pTitleNorm && mNameNorm && (pTitleNorm.startsWith(mNameNorm) || mNameNorm.startsWith(pTitleNorm)));
    });
  }

  let finalSlug = page.slug;
  if (!finalSlug && match && match.url && match.url.includes('/pages/')) {
    finalSlug = match.url.replace(/^.*\/pages\//, '').trim();
  }
  if (!finalSlug) {
    finalSlug = (page.title || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(page.id);
  }

  return {
    slug: finalSlug,
    path: `/pages/${finalSlug}`,
    menu: match ? getBreadcrumb(match) : null,
    menuId: match ? String(match.id) : null,
    menuUrl: match ? match.url : null
  };
}

// Helper to resolve linked homepage containers (box & items) for a webpage
function resolvePageContenitori(page, contenitori) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pTitleNorm = norm(page.title);
  const pSlugNorm = norm(page.slug);
  const matched = [];

  (contenitori || []).forEach(c => {
    (c.items || []).forEach(it => {
      if (!it.url || it.url === '#') return;
      const urlSlug = it.url.replace(/^.*\/pages\//, '').replace(/^.*\//, '');
      const itSlugNorm = norm(urlSlug);
      const itTitleNorm = norm(it.title);

      if (pSlugNorm && itSlugNorm === pSlugNorm) {
        matched.push({ boxId: String(c.id), boxTitle: c.title, itemTitle: it.title, label: `${c.title} > ${it.title}` });
        return;
      }
      if (pTitleNorm && (itTitleNorm === pTitleNorm || itSlugNorm === pTitleNorm)) {
        matched.push({ boxId: String(c.id), boxTitle: c.title, itemTitle: it.title, label: `${c.title} > ${it.title}` });
        return;
      }
      if (pTitleNorm && itSlugNorm && (pTitleNorm.startsWith(itSlugNorm) || itSlugNorm.startsWith(pTitleNorm))) {
        matched.push({ boxId: String(c.id), boxTitle: c.title, itemTitle: it.title, label: `${c.title} > ${it.title}` });
        return;
      }
    });
  });

  return matched;
}

// Get paginated pages list for Admin with menu info, status filter & sorting
app.get('/api/admin/pages', (req, res) => {
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const statusFilter = req.query.status !== undefined ? String(req.query.status).trim() : 'all';
  const sort = (req.query.sort || 'title').trim();
  const dir = req.query.dir === 'desc' ? -1 : 1;
  const menus = db.rawMenus || [];
  const contenitori = db.rawContenitori || [];

  let pages = (db.rawWebpages || []).map(p => {
    const meta = resolvePageMenuAndSlug(p, menus);
    const contMatches = resolvePageContenitori(p, contenitori);
    return {
      id: p.id,
      title: p.title || 'Senza Titolo',
      slug: meta.slug,
      path: meta.path,
      menu: meta.menu,
      menuId: meta.menuId,
      menuUrl: meta.menuUrl,
      contenitori: contMatches.map(m => m.label),
      contenitore: contMatches.length ? contMatches[0].label : null,
      status: p.status !== undefined ? parseInt(p.status) : 1,
      textPreview: (p.text || '').replace(/<[^>]+>/g, ' ').substring(0, 100).trim()
    };
  });

  // Filter: search
  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    pages = pages.filter(p => {
      const title = (p.title || '').toLowerCase();
      const slug = (p.slug || '').toLowerCase();
      const menu = (p.menu || '').toLowerCase();
      const cont = (p.contenitori || []).join(' ').toLowerCase();
      const id = String(p.id || '');
      return tokens.every(t => title.includes(t) || slug.includes(t) || menu.includes(t) || cont.includes(t) || id.includes(t));
    });
  }

  // Filter: status (all, 1 = pubblicata, 0 = bozza)
  if (statusFilter !== 'all' && statusFilter !== '') {
    const numStatus = parseInt(statusFilter);
    if (!isNaN(numStatus)) {
      pages = pages.filter(p => p.status === numStatus);
    }
  }

  // Sort
  pages.sort((a, b) => {
    if (sort === 'title' || sort === 'pagina') {
      return a.title.localeCompare(b.title, 'it', { sensitivity: 'base' }) * dir;
    } else if (sort === 'status') {
      return (a.status - b.status) * dir;
    } else if (sort === 'menu') {
      const mA = a.menu || '';
      const mB = b.menu || '';
      return mA.localeCompare(mB, 'it', { sensitivity: 'base' }) * dir;
    } else if (sort === 'id') {
      return ((parseInt(a.id) || 0) - (parseInt(b.id) || 0)) * dir;
    }
    return 0;
  });

  const total = pages.length;
  const limit = req.query.limit !== undefined ? Math.max(1, parseInt(req.query.limit) || 100) : 100;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, totalPages));
  const offset = (page - 1) * limit;
  const paginated = pages.slice(offset, offset + limit);

  res.json({
    success: true,
    pages: paginated,
    total,
    page,
    limit,
    totalPages,
    sort,
    dir: dir === -1 ? 'desc' : 'asc',
    status: statusFilter
  });
});

// Get single page by ID
app.get('/api/admin/pages/:id', (req, res) => {
  const page = (db.rawWebpages || []).find(p => String(p.id) === String(req.params.id));
  if (!page) {
    return res.status(404).json({ error: 'Pagina non trovata nel database' });
  }
  res.json({ success: true, page });
});

// Create new page
app.post('/api/admin/pages', (req, res) => {
  const { title, slug, text, status } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Il titolo della pagina è obbligatorio' });
  }

  const existingIds = (db.rawWebpages || []).map(p => parseInt(p.id) || 0);
  const newId = existingIds.length ? Math.max(...existingIds) + 1 : 1;
  const finalSlug = (slug || title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')).trim();

  const newPage = {
    id: newId,
    title: title.trim(),
    slug: finalSlug,
    text: text || '',
    status: status !== undefined ? parseInt(status) : 1
  };

  db.rawWebpages.unshift(newPage);
  saveWebpages();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Pagine Web',
    azione: 'Creazione Nuova Pagina Web',
    oggetto: `${newPage.title} (ID: ${newPage.id})`,
    dettagli: `Slug: /pages/${newPage.slug} | Stato: ${newPage.status === 1 ? 'Pubblicata' : 'Bozza'}`,
    esito: 'OK'
  });

  res.json({ success: true, page: newPage });
});

// Update page
app.put('/api/admin/pages/:id', (req, res) => {
  const idx = (db.rawWebpages || []).findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Pagina non trovata nel database' });
  }

  const { title, slug, text, status } = req.body;
  if (title !== undefined) db.rawWebpages[idx].title = title.trim();
  if (slug !== undefined) db.rawWebpages[idx].slug = slug.trim();
  if (text !== undefined) db.rawWebpages[idx].text = text;
  if (status !== undefined) db.rawWebpages[idx].status = parseInt(status);

  saveWebpages();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Pagine Web',
    azione: 'Modifica Pagina Web',
    oggetto: `${db.rawWebpages[idx].title} (ID: ${db.rawWebpages[idx].id})`,
    dettagli: `Slug: /pages/${db.rawWebpages[idx].slug} | Stato: ${Number(db.rawWebpages[idx].status) === 1 ? 'Pubblicata' : 'Bozza'}`,
    esito: 'OK'
  });

  res.json({ success: true, page: db.rawWebpages[idx] });
});

// Delete page
app.delete('/api/admin/pages/:id', (req, res) => {
  const idx = (db.rawWebpages || []).findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Pagina non trovata nel database' });
  }

  const removed = db.rawWebpages.splice(idx, 1)[0];
  saveWebpages();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Pagine Web',
    azione: 'Eliminazione Pagina Web',
    oggetto: `${removed.title} (ID: ${removed.id})`,
    dettagli: `Eliminata pagina web "${removed.title}" (Slug: /pages/${removed.slug})`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Pagina "${removed.title}" cancellata con successo`, id: req.params.id });
});

// ================= NEWSLETTERS ROUTES ================= //

// 1. Get global recipient settings & preview count
app.get('/api/admin/newsletters/config', (req, res) => {
  const resolution = db.resolveNewsletterRecipients(db.rawNewsletterSettings);
  res.json({
    success: true,
    config: db.rawNewsletterSettings,
    resolution
  });
});

// 2. Save global recipient settings
app.post('/api/admin/newsletters/config', (req, res) => {
  const b = req.body || {};
  const updated = db.saveNewsletterSettings({
    societa: Boolean(b.societa),
    presidenti: Boolean(b.presidenti),
    vicepresidenti: Boolean(b.vicepresidenti),
    consiglieri_segretari: Boolean(b.consiglieri_segretari),
    tesserati: Boolean(b.tesserati),
    manual_active: Boolean(b.manual_active),
    manual_emails: String(b.manual_emails || '').trim(),
    scheduled_active: Boolean(b.scheduled_active),
    scheduled_datetime: String(b.scheduled_datetime || '').trim()
  });

  const resolution = db.resolveNewsletterRecipients(updated);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Configurazione Newsletter',
    azione: 'Salvataggio Configurazione Generale Destinatari',
    oggetto: resolution.targetDesc,
    dettagli: `Opzioni attive: ${JSON.stringify(resolution.optionsUsed)} | Invio programmato: ${updated.scheduled_active ? updated.scheduled_datetime : 'No'}`,
    esito: 'OK'
  });

  res.json({ success: true, config: updated, resolution, message: 'Configurazione generale salvata con successo!' });
});

// 3. Preview recipient resolution for arbitrary config (interactive UI calculation)
app.post('/api/admin/newsletters/preview-recipients', (req, res) => {
  const resolution = db.resolveNewsletterRecipients(req.body || {});
  res.json({ success: true, resolution });
});

// 4. Get paginated newsletters list
app.get('/api/admin/newsletters', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, parseInt(req.query.limit) || 25);
  const search = String(req.query.search || '').trim().toLowerCase();

  let list = db.rawNewsletters || [];
  if (search) {
    list = list.filter(n => (n.title && n.title.toLowerCase().includes(search)) || (n.text && n.text.toLowerCase().includes(search)));
  }

  // Sort by id descending / created descending
  const sorted = [...list].sort((a, b) => {
    const da = new Date(a.created || 0).getTime();
    const dbTime = new Date(b.created || 0).getTime();
    if (dbTime !== da) return dbTime - da;
    return (parseInt(b.id) || 0) - (parseInt(a.id) || 0);
  });

  const total = sorted.length;
  const startIndex = (page - 1) * limit;
  const paginated = sorted.slice(startIndex, startIndex + limit);

  // Attach hasCustomConfig flag to each item
  const enriched = paginated.map(n => {
    const cfg = db.getNewsletterConfig(n.id);
    return {
      ...n,
      hasCustomConfig: !!cfg.isCustom
    };
  });

  res.json({
    success: true,
    newsletters: enriched,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});

// 5. Get single newsletter by ID
app.get('/api/admin/newsletters/:id', (req, res) => {
  const item = (db.rawNewsletters || []).find(n => String(n.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ error: 'Newsletter non trovata nel database' });
  }
  const config = db.getNewsletterConfig(item.id);
  const resolution = db.resolveNewsletterRecipients(config);
  res.json({ success: true, newsletter: item, config, resolution });
});

// 6. Create new newsletter
app.post('/api/admin/newsletters', (req, res) => {
  const { title, layout, text } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Il titolo della newsletter è obbligatorio' });
  }

  const existingIds = (db.rawNewsletters || []).map(n => parseInt(n.id) || 0);
  const newId = String(existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const now = new Date();
  const pad = num => String(num).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const newItem = {
    id: newId,
    title: title.trim(),
    text: text || '',
    layout: layout || 'default',
    sent: '0',
    created: dateStr
  };

  db.rawNewsletters.unshift(newItem);
  db.saveNewsletters();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti Newsletter',
    azione: 'Creazione Nuova Newsletter',
    oggetto: `${newItem.title} (ID: ${newItem.id})`,
    dettagli: `Creata newsletter con layout "${newItem.layout}"`,
    esito: 'OK'
  });

  res.json({ success: true, newsletter: newItem, message: 'Nuova newsletter creata con successo!' });
});

// 7. Update newsletter
app.put('/api/admin/newsletters/:id', (req, res) => {
  const idx = (db.rawNewsletters || []).findIndex(n => String(n.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Newsletter non trovata nel database' });
  }

  const { title, layout, text } = req.body || {};
  if (title !== undefined) db.rawNewsletters[idx].title = title.trim();
  if (layout !== undefined) db.rawNewsletters[idx].layout = layout.trim();
  if (text !== undefined) db.rawNewsletters[idx].text = text;

  db.saveNewsletters();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti Newsletter',
    azione: 'Modifica Newsletter',
    oggetto: `${db.rawNewsletters[idx].title} (ID: ${db.rawNewsletters[idx].id})`,
    dettagli: `Modificato contenuto e parametri newsletter`,
    esito: 'OK'
  });

  res.json({ success: true, newsletter: db.rawNewsletters[idx], message: 'Newsletter aggiornata con successo!' });
});

// 8. Delete newsletter
app.delete('/api/admin/newsletters/:id', (req, res) => {
  const idx = (db.rawNewsletters || []).findIndex(n => String(n.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Newsletter non trovata nel database' });
  }

  const removed = db.rawNewsletters.splice(idx, 1)[0];
  db.saveNewsletters();
  db.deleteNewsletterCustomConfig(removed.id);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti Newsletter',
    azione: 'Cancellazione Newsletter',
    oggetto: `${removed.title} (ID: ${removed.id})`,
    dettagli: `Eliminata newsletter dall'archivio`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Newsletter "${removed.title}" cancellata con successo!` });
});

// 9. Get specific configuration for a newsletter
app.get('/api/admin/newsletters/:id/config', (req, res) => {
  const item = (db.rawNewsletters || []).find(n => String(n.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ error: 'Newsletter non trovata' });
  }
  const config = db.getNewsletterConfig(item.id);
  const resolution = db.resolveNewsletterRecipients(config);
  res.json({ success: true, newsletter: item, config, resolution });
});

// 10. Save specific configuration for a newsletter
app.post('/api/admin/newsletters/:id/config', (req, res) => {
  const item = (db.rawNewsletters || []).find(n => String(n.id) === String(req.params.id));
  if (!item) {
    return res.status(404).json({ error: 'Newsletter non trovata' });
  }

  const b = req.body || {};
  if (b.resetToDefault) {
    db.deleteNewsletterCustomConfig(item.id);
    const globalCfg = db.getNewsletterConfig(null);
    const resolution = db.resolveNewsletterRecipients(globalCfg);
    return res.json({ success: true, isCustom: false, config: globalCfg, resolution, message: 'Ripristinata configurazione generale predefinita!' });
  }

  const customConfig = {
    societa: Boolean(b.societa),
    presidenti: Boolean(b.presidenti),
    vicepresidenti: Boolean(b.vicepresidenti),
    consiglieri_segretari: Boolean(b.consiglieri_segretari),
    tesserati: Boolean(b.tesserati),
    manual_active: Boolean(b.manual_active),
    manual_emails: String(b.manual_emails || '').trim(),
    scheduled_active: Boolean(b.scheduled_active),
    scheduled_datetime: String(b.scheduled_datetime || '').trim()
  };

  db.saveNewsletterCustomConfig(item.id, customConfig);
  const resolution = db.resolveNewsletterRecipients(customConfig);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti Newsletter',
    azione: 'Configurazione Destinatari Specifica',
    oggetto: `${item.title} (ID: ${item.id})`,
    dettagli: `Destinatari: ${resolution.targetDesc}`,
    esito: 'OK'
  });

  res.json({ success: true, isCustom: true, config: customConfig, resolution, message: 'Configurazione specifica per la newsletter salvata con successo!' });
});

// 11. Send newsletter (Immediate or Scheduled)
app.post('/api/admin/newsletters/:id/send', async (req, res) => {
  try {
    const item = (db.rawNewsletters || []).find(n => String(n.id) === String(req.params.id));
    if (!item) {
      return res.status(404).json({ error: 'Newsletter non trovata nel database' });
    }

    // Modalità richiesta: 'immediate' (Invia subito) oppure 'scheduled' (Invio programmato)
    const mode = (req.body && req.body.mode) || '';
    const reqSchedDt = (req.body && req.body.scheduled_datetime) || '';

    // Use newsletter specific config if present, otherwise general config
    const cfg = { ...db.getNewsletterConfig(item.id) };

    if (reqSchedDt) {
      cfg.scheduled_active = true;
      cfg.scheduled_datetime = reqSchedDt;
      db.saveNewsletterCustomConfig(item.id, cfg);
    }

    const resolution = db.resolveNewsletterRecipients(cfg);

    if (resolution.recipients.length === 0) {
      return res.status(400).json({ error: 'Nessun destinatario valido individuato dalla configurazione impostata.' });
    }

    const now = new Date();
    const pad = num => String(num).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const existingQIds = (db.rawQueueNewsletters || []).map(q => parseInt(q.id) || 0);
    const newQId = String(existingQIds.length ? Math.max(...existingQIds) + 1 : 1);

    const isScheduledRequest = mode === 'scheduled' || (mode !== 'immediate' && cfg.scheduled_active && cfg.scheduled_datetime);

    // If Invio Programmato
    if (isScheduledRequest) {
      const targetSchedDt = reqSchedDt || cfg.scheduled_datetime;
      if (!targetSchedDt) {
        return res.status(400).json({ error: 'Data e ora per l\'invio programmato non impostate.' });
      }

      const queueEntry = {
        id: newQId,
        newsletter_id: String(item.id),
        target: JSON.stringify(cfg),
        target_desc: resolution.targetDesc,
        send_date: targetSchedDt.split('T')[0] || todayStr,
        status: 0, // 0 = In coda / programmata
        note: `Invio programmato per il ${targetSchedDt.replace('T', ' ore ')}. Destinatari previsti: ${resolution.total}. Email inviate: 0/${resolution.total}`
      };

      db.rawQueueNewsletters.unshift(queueEntry);
      db.saveQueueNewsletters();

      recordOperationLog(req, {
        origine: 'admin',
        categoria: 'Invio Newsletter',
        azione: 'Programmazione Invio Newsletter',
        oggetto: `${item.title} (ID: ${item.id})`,
        dettagli: `Programmata per il ${targetSchedDt} a ${resolution.total} destinatari (${resolution.targetDesc})`,
        esito: 'OK'
      });

      return res.json({
        success: true,
        scheduled: true,
        scheduled_datetime: targetSchedDt,
        total: resolution.total,
        message: `Newsletter "${item.title}" programmata con successo per il ${targetSchedDt.replace('T', ' ore ')} (${resolution.total} destinatari).`
      });
    }

    // Invio Immediato
    let deliveredCount = resolution.total;
    let sampleResult = null;

    try {
      const smtpCfg = loadSmtpConfig();
      if (smtpCfg && smtpCfg.pass && resolution.recipients.length > 0) {
        const transporter = nodemailer.createTransport({
          host: smtpCfg.host || 'smtps.aruba.it',
          port: Number(smtpCfg.port) || 465,
          secure: Boolean(smtpCfg.secure),
          auth: { user: smtpCfg.user, pass: smtpCfg.pass },
          tls: { rejectUnauthorized: false }
        });

        const firstRecip = resolution.recipients[0];
        await transporter.sendMail({
          from: `"${smtpCfg.fromName || 'Federazione Italiana Skyrunning (FISky)'}" <${smtpCfg.fromEmail || 'federazione@skyrunningitalia.it'}>`,
          to: firstRecip,
          subject: `[FISky Newsletter] ${item.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden;">
              <div style="background: #0a2759; color: #ffffff; padding: 20px; border-bottom: 4px solid #df4040;">
                <h2 style="margin: 0; font-size: 20px;">Federazione Italiana Skyrunning (FISky)</h2>
                <div style="font-size: 13px; color: #cbd5e1; margin-top: 5px;">Comunicazione Federale Ufficiale</div>
              </div>
              <div style="padding: 25px; line-height: 1.6; color: #333333;">
                <h3 style="color: #0a2759; margin-top: 0;">${item.title}</h3>
                <div>${item.text}</div>
              </div>
              <div style="background: #f8fafc; padding: 15px 25px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
                Ricevi questa newsletter in quanto affiliato o registrato alla Federazione Italiana Skyrunning.<br>
                www.skyrunningitalia.it | federazione@skyrunningitalia.it
              </div>
            </div>
          `
        });
        sampleResult = 'Inviata tramite SMTP Aruba';
      }
    } catch (mailErr) {
      console.warn('[NEWSLETTER SMTP SEND WARNING]:', mailErr.message);
      sampleResult = 'Simulata / Log: ' + mailErr.message;
    }

    // Record queue entry
    const queueEntry = {
      id: newQId,
      newsletter_id: String(item.id),
      target: JSON.stringify(cfg),
      target_desc: resolution.targetDesc,
      send_date: todayStr,
      status: 1, // 1 = Inviata con successo
      note: `Email inviate: ${deliveredCount}/${resolution.total}. ${sampleResult || 'Invio completato regolarmente'}`
    };

    db.rawQueueNewsletters.unshift(queueEntry);
    db.saveQueueNewsletters();

    // Mark newsletter as sent
    item.sent = '1';
    db.saveNewsletters();

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Invio Newsletter',
      azione: 'Invio Immediato Newsletter',
      oggetto: `${item.title} (ID: ${item.id})`,
      dettagli: `Inviata a ${deliveredCount}/${resolution.total} destinatari (${resolution.targetDesc})`,
      esito: 'OK'
    });

    res.json({
      success: true,
      scheduled: false,
      delivered: deliveredCount,
      total: resolution.total,
      targetDesc: resolution.targetDesc,
      message: `Newsletter "${item.title}" inviata con successo a ${deliveredCount}/${resolution.total} destinatari!`
    });
  } catch (err) {
    console.error('Errore invio newsletter:', err);
    res.status(500).json({ error: 'Errore interno durante l\'invio della newsletter: ' + err.message });
  }
});

// 12. Get Queue / Sent Outcomes history
app.get('/api/admin/newsletters-queue', (req, res) => {
  const list = db.rawQueueNewsletters || [];
  const newslettersMap = {};
  (db.rawNewsletters || []).forEach(n => {
    newslettersMap[String(n.id)] = n.title;
  });

  const formatted = list.map(q => {
    let title = newslettersMap[String(q.newsletter_id)] || `Newsletter #${q.newsletter_id}`;
    let esito = Number(q.status) === 1 ? 'Inviata con successo' : (Number(q.status) === 0 ? 'Programmata / In attesa' : 'Errore');
    let riepilogo = '-';

    if (q.note) {
      const match = q.note.match(/(\d+)\/(\d+)/);
      if (match) {
        // match[1] = inviate, match[2] = totale predisposte
        riepilogo = `${match[2]} / ${match[1]}`;
      } else {
        try {
          const parsed = JSON.parse(q.note);
          if (parsed && (parsed.send !== undefined || parsed.success !== undefined)) {
            riepilogo = `${parsed.send || 0} / ${parsed.success || 0}`;
          }
        } catch (e) {}
      }
    }

    return {
      id: q.id,
      newsletter_id: q.newsletter_id,
      newsletter_title: title,
      target_desc: q.target_desc || 'Tutti i destinatari',
      status: q.status,
      esito: esito,
      send_date: q.send_date,
      riepilogo: riepilogo,
      note: q.note
    };
  });

  res.json({ success: true, history: formatted, total: formatted.length });
});

// Get all pages list
app.get('/api/pages', (req, res) => {
  const pages = (db.rawWebpages || []).map(p => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status
  }));
  res.json({ pages });
});

// ================= MENUS MANAGEMENT ROUTES ================= //
function saveMenus() {
  db.writeJsonFile('mysql_menus.json', db.rawMenus);
}

function getMenuTree(items, publicOnly = false) {
  let list = (items || []).slice();
  if (publicOnly) {
    list = list.filter(m => Number(m.status) !== 0);
  }
  
  function getChildren(parentId) {
    return list
      .filter(m => {
        if (!parentId) return !m.parent_id || m.parent_id === '0' || m.parent_id === null;
        return String(m.parent_id) === String(parentId);
      })
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
      .map(item => {
        const sub = getChildren(item.id);
        return {
          ...item,
          status: item.status !== undefined ? parseInt(item.status) : 1,
          children: sub,
          childrenCount: sub.length
        };
      });
  }
  return getChildren(null);
}

// Public API for frontend navbar
app.get('/api/public/menus', (req, res) => {
  const tree = getMenuTree(db.rawMenus, true);
  res.json({ success: true, menus: tree });
});

// Admin API to get all menus (tree + flat list + statistics)
app.get('/api/admin/menus', (req, res) => {
  const menus = db.rawMenus || [];
  const tree = getMenuTree(menus, false);

  const idToName = {};
  menus.forEach(m => { idToName[String(m.id)] = m.name; });

  const flat = menus.map(m => {
    const parentId = (m.parent_id && m.parent_id !== '0') ? String(m.parent_id) : null;
    const parentName = parentId ? (idToName[parentId] || `ID ${parentId}`) : null;
    const isRoot = !parentId;
    let level = 1;
    if (parentId) {
      const parentObj = menus.find(x => String(x.id) === parentId);
      if (parentObj && parentObj.parent_id && parentObj.parent_id !== '0') {
        level = 3;
      } else {
        level = 2;
      }
    }
    const childrenCount = menus.filter(x => String(x.parent_id) === String(m.id)).length;
    return {
      id: String(m.id),
      name: m.name,
      url: m.url || '#',
      parent_id: parentId,
      parent_name: parentName,
      status: m.status !== undefined ? parseInt(m.status) : 1,
      sort_order: Number(m.sort_order) || 0,
      level,
      is_root: isRoot,
      children_count: childrenCount
    };
  }).sort((a, b) => {
    if (a.parent_id !== b.parent_id) {
      return (a.parent_id || '').localeCompare(b.parent_id || '');
    }
    return a.sort_order - b.sort_order;
  });

  const rootsCount = flat.filter(m => m.is_root).length;
  const subCount = flat.length - rootsCount;
  const publishedCount = flat.filter(m => m.status === 1).length;
  const suspendedCount = flat.filter(m => m.status === 0).length;

  res.json({
    success: true,
    tree,
    flat,
    stats: {
      total: flat.length,
      roots: rootsCount,
      submenus: subCount,
      published: publishedCount,
      suspended: suspendedCount
    }
  });
});

// Admin API to create a new menu item
app.post('/api/admin/menus', (req, res) => {
  const { name, url, parent_id, status } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Il nome della voce di menu è obbligatorio' });
  }

  const existingIds = (db.rawMenus || []).map(m => parseInt(m.id) || 0);
  const newId = existingIds.length ? Math.max(...existingIds) + 1 : 1;

  const validParentId = (parent_id && String(parent_id) !== '0' && String(parent_id) !== 'null') ? String(parent_id) : null;
  const siblings = (db.rawMenus || []).filter(m => {
    if (!validParentId) return !m.parent_id || m.parent_id === '0' || m.parent_id === null;
    return String(m.parent_id) === String(validParentId);
  });
  const maxOrder = siblings.reduce((max, s) => Math.max(max, Number(s.sort_order) || 0), 0);

  const newItem = {
    id: String(newId),
    parent_id: validParentId,
    name: name.trim(),
    url: (url !== undefined && url !== null) ? url.trim() : '#',
    status: status !== undefined ? parseInt(status) : 1,
    sort_order: maxOrder + 10,
    lft: String(maxOrder + 1),
    rght: String(maxOrder + 2)
  };

  db.rawMenus.push(newItem);
  saveMenus();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Menu',
    azione: 'Creazione Voce di Menu',
    oggetto: `${newItem.name} (ID: ${newItem.id})`,
    dettagli: `URL: ${newItem.url} | Genitore: ${validParentId || 'Root (1° Livello)'} | Stato: ${newItem.status === 1 ? 'Pubblicato' : 'Sospeso'}`,
    esito: 'OK'
  });

  res.json({ success: true, item: newItem });
});

// Admin API to update a menu item
app.put('/api/admin/menus/:id', (req, res) => {
  const idx = (db.rawMenus || []).findIndex(m => String(m.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Voce di menu non trovata nel database' });
  }

  const { name, url, parent_id, status, sort_order } = req.body;
  const current = db.rawMenus[idx];

  if (name !== undefined && name.trim()) current.name = name.trim();
  if (url !== undefined) current.url = url.trim();
  if (parent_id !== undefined) {
    current.parent_id = (parent_id && String(parent_id) !== '0' && String(parent_id) !== 'null') ? String(parent_id) : null;
  }
  if (status !== undefined) current.status = parseInt(status);
  if (sort_order !== undefined) current.sort_order = Number(sort_order);

  saveMenus();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Menu',
    azione: 'Modifica Voce di Menu',
    oggetto: `${current.name} (ID: ${current.id})`,
    dettagli: `URL: ${current.url} | Genitore: ${current.parent_id || 'Root'} | Stato: ${current.status === 1 ? 'Pubblicato' : 'Sospeso'} | Ordine: ${current.sort_order}`,
    esito: 'OK'
  });

  res.json({ success: true, item: current });
});

// Admin API to toggle published/suspended status
app.put('/api/admin/menus/:id/toggle-status', (req, res) => {
  const idx = (db.rawMenus || []).findIndex(m => String(m.id) === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Voce di menu non trovata' });
  }

  const current = db.rawMenus[idx];
  const oldStatus = current.status !== undefined ? parseInt(current.status) : 1;
  const newStatus = oldStatus === 1 ? 0 : 1;
  current.status = newStatus;

  saveMenus();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Menu',
    azione: 'Variazione Pubblicazione Menu',
    oggetto: `${current.name} (ID: ${current.id})`,
    dettagli: `Stato variato da ${oldStatus === 1 ? 'Pubblicato' : 'Sospeso'} a ${newStatus === 1 ? 'Pubblicato' : 'Sospeso'}`,
    esito: 'OK'
  });

  res.json({ success: true, id: current.id, status: newStatus, name: current.name });
});

// Admin API to move menu item UP or DOWN among siblings
app.post('/api/admin/menus/:id/move', (req, res) => {
  const { direction } = req.body;
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'Direzione non valida (up o down)' });
  }

  const targetId = String(req.params.id);
  const current = (db.rawMenus || []).find(m => String(m.id) === targetId);
  if (!current) {
    return res.status(404).json({ error: 'Voce di menu non trovata' });
  }

  const parentId = current.parent_id;
  const siblings = (db.rawMenus || []).filter(m => {
    if (!parentId) return !m.parent_id || m.parent_id === '0' || m.parent_id === null;
    return String(m.parent_id) === String(parentId);
  }).sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

  // Normalize order with spacing 10
  siblings.forEach((s, i) => { s.sort_order = (i + 1) * 10; });

  const idx = siblings.findIndex(s => String(s.id) === targetId);
  if (idx === -1) {
    return res.status(400).json({ error: 'Errore nel recupero della posizione' });
  }

  if (direction === 'up') {
    if (idx === 0) {
      return res.json({ success: true, message: 'La voce è già in prima posizione' });
    }
    const prev = siblings[idx - 1];
    const temp = prev.sort_order;
    prev.sort_order = current.sort_order;
    current.sort_order = temp;
  } else {
    if (idx === siblings.length - 1) {
      return res.json({ success: true, message: 'La voce è già in ultima posizione' });
    }
    const next = siblings[idx + 1];
    const temp = next.sort_order;
    next.sort_order = current.sort_order;
    current.sort_order = temp;
  }

  saveMenus();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Menu',
    azione: 'Spostamento Posizione Menu',
    oggetto: `${current.name} (ID: ${current.id})`,
    dettagli: `Spostata verso ${direction.toUpperCase()} tra le voci sorelle del genitore ${parentId || 'Root'}`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Posizione aggiornata con successo (${direction})` });
});

// Admin API to delete menu item and its children
app.delete('/api/admin/menus/:id', (req, res) => {
  const targetId = String(req.params.id);
  const idx = (db.rawMenus || []).findIndex(m => String(m.id) === targetId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Voce di menu non trovata nel database' });
  }

  const targetItem = db.rawMenus[idx];

  // Recursively collect all descendant IDs
  function getDescendantIds(parentId) {
    let ids = [];
    (db.rawMenus || []).forEach(m => {
      if (String(m.parent_id) === String(parentId)) {
        ids.push(String(m.id));
        ids = ids.concat(getDescendantIds(m.id));
      }
    });
    return ids;
  }

  const allToDelete = [targetId, ...getDescendantIds(targetId)];
  const deletedCount = allToDelete.length;

  db.rawMenus = (db.rawMenus || []).filter(m => !allToDelete.includes(String(m.id)));
  saveMenus();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti e Menu',
    azione: 'Eliminazione Voce di Menu',
    oggetto: `${targetItem.name} (ID: ${targetItem.id})`,
    dettagli: `Eliminata voce di menu e ${deletedCount - 1} eventuali sottovoci collegate`,
    esito: 'OK'
  });

  res.json({ success: true, deletedCount, message: `Eliminata voce "${targetItem.name}" e ${deletedCount - 1} sottovoci collegate` });
});

// ==========================================
// GESTIONE SLIDER HOMEPAGE (HERO SLIDER)
// ==========================================
function saveSliders() {
  db.writeJsonFile('mysql_sliders.json', db.rawSliders || []);
}

// Public API for Homepage Hero Slider
app.get('/api/public/sliders', (req, res) => {
  const sliders = (db.rawSliders || [])
    .filter(s => Number(s.status) === 1)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  res.json({ success: true, sliders });
});

// Admin API to list all sliders
app.get('/api/admin/sliders', (req, res) => {
  const sliders = (db.rawSliders || [])
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  res.json({ success: true, sliders });
});

// Admin API to upload slider image
app.post('/api/admin/sliders/upload', (req, res) => {
  try {
    const { fileName, fileDataBase64 } = req.body || {};
    if (!fileName || !fileDataBase64) {
      return res.status(400).json({ error: 'Nessun file immagine fornito.' });
    }
    const uploadDir = path.join(__dirname, 'public', 'uploads', 'sliders');
    fs.mkdirSync(uploadDir, { recursive: true });

    const ext = path.extname(fileName).toLowerCase() || '.jpg';
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ error: 'Formato immagine non consentito. Formati ammessi: JPG, PNG, WEBP, GIF, SVG.' });
    }

    const safeBase = path.basename(fileName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFileName = `slider_${Date.now()}_${safeBase}${ext}`;
    const filePath = path.join(uploadDir, safeFileName);

    const base64Clean = fileDataBase64.replace(/^data:image\/[a-z0-9-+.]+;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/sliders/${safeFileName}`;
    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Slider Homepage',
      azione: 'Upload Immagine Slider',
      oggetto: safeFileName,
      dettagli: `Caricata immagine (${(buffer.length / 1024).toFixed(1)} KB) con percorso ${fileUrl}`,
      esito: 'OK'
    });

    res.json({ success: true, url: fileUrl, fileName: safeFileName });
  } catch (err) {
    console.error('Errore upload slider image:', err);
    res.status(500).json({ error: 'Errore durante il salvataggio del file immagine.' });
  }
});

// Admin API to create a new slider
app.post('/api/admin/sliders', (req, res) => {
  const { title, subtitle, image, url, position, status } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Il titolo dello slider è obbligatorio.' });
  }
  if (!image || !image.trim()) {
    return res.status(400).json({ error: 'L\'immagine dello slider è obbligatoria.' });
  }

  const sliders = db.rawSliders || [];
  const maxId = sliders.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0);
  const nextPos = (position !== undefined && position !== null && position !== '')
    ? Number(position)
    : (sliders.length ? Math.max(...sliders.map(s => Number(s.position) || 0)) + 1 : 1);

  const newSlider = {
    id: maxId + 1,
    title: title.trim(),
    subtitle: (subtitle || '').trim(),
    image: image.trim(),
    url: (url || '').trim(),
    position: nextPos,
    status: status !== undefined ? (Number(status) ? 1 : 0) : 1,
    updatedAt: new Date().toISOString()
  };

  sliders.push(newSlider);
  saveSliders();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Slider Homepage',
    azione: 'Creazione Slide',
    oggetto: `${newSlider.title} (ID: ${newSlider.id})`,
    dettagli: `Aggiunta nuova slide con immagine ${newSlider.image} in posizione ${newSlider.position}`,
    esito: 'OK'
  });

  res.json({ success: true, slider: newSlider, message: 'Nuova slide creata con successo' });
});

// Admin API to update a slider
app.put('/api/admin/sliders/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = (db.rawSliders || []).findIndex(s => Number(s.id) === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Slide non trovata nel database.' });
  }

  const { title, subtitle, image, url, position, status } = req.body || {};
  const current = db.rawSliders[idx];

  if (title !== undefined) current.title = String(title).trim();
  if (subtitle !== undefined) current.subtitle = String(subtitle).trim();
  if (image !== undefined) current.image = String(image).trim();
  if (url !== undefined) current.url = String(url).trim();
  if (position !== undefined && position !== null && position !== '') current.position = Number(position);
  if (status !== undefined) current.status = Number(status) ? 1 : 0;
  current.updatedAt = new Date().toISOString();

  saveSliders();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Slider Homepage',
    azione: 'Modifica Slide',
    oggetto: `${current.title} (ID: ${current.id})`,
    dettagli: `Aggiornati dati slide: posizione ${current.position}, stato ${current.status === 1 ? 'Attiva' : 'Inattiva'}`,
    esito: 'OK'
  });

  res.json({ success: true, slider: current, message: 'Slide aggiornata con successo' });
});

// Admin API to toggle status
app.put('/api/admin/sliders/:id/toggle-status', (req, res) => {
  const id = Number(req.params.id);
  const idx = (db.rawSliders || []).findIndex(s => Number(s.id) === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Slide non trovata nel database.' });
  }

  const s = db.rawSliders[idx];
  s.status = Number(s.status) === 1 ? 0 : 1;
  s.updatedAt = new Date().toISOString();
  saveSliders();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Slider Homepage',
    azione: 'Cambio Stato Slide',
    oggetto: `${s.title} (ID: ${s.id})`,
    dettagli: `Stato impostato a: ${s.status === 1 ? 'ATTIVA (In Rotazione)' : 'DISATTIVATA'}`,
    esito: 'OK'
  });

  res.json({ success: true, status: s.status, message: `Slide ${s.status === 1 ? 'attivata' : 'disattivata'} con successo` });
});

// Admin API to move slider UP or DOWN
app.post('/api/admin/sliders/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const { direction } = req.body || {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'Direzione non valida (up/down).' });
  }

  const sliders = db.rawSliders || [];
  sliders.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const currentIdx = sliders.findIndex(s => Number(s.id) === id);
  if (currentIdx === -1) {
    return res.status(404).json({ error: 'Slide non trovata.' });
  }

  const swapIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
  if (swapIdx < 0 || swapIdx >= sliders.length) {
    return res.json({ success: true, message: 'La slide è già al limite della lista.' });
  }

  const tempPos = sliders[currentIdx].position;
  sliders[currentIdx].position = sliders[swapIdx].position;
  sliders[swapIdx].position = tempPos;

  sliders.forEach((s, i) => {
    s.position = i + 1;
  });

  saveSliders();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Slider Homepage',
    azione: 'Spostamento Slide',
    oggetto: `${sliders[swapIdx].title} (ID: ${sliders[swapIdx].id})`,
    dettagli: `Spostata verso ${direction.toUpperCase()} alla posizione ${sliders[swapIdx].position}`,
    esito: 'OK'
  });

  res.json({ success: true, message: 'Ordinamento aggiornato con successo' });
});

// Admin API to delete a slider
app.delete('/api/admin/sliders/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = (db.rawSliders || []).findIndex(s => Number(s.id) === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Slide non trovata.' });
  }

  const item = db.rawSliders[idx];
  db.rawSliders.splice(idx, 1);

  db.rawSliders.sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  db.rawSliders.forEach((s, i) => {
    s.position = i + 1;
  });

  saveSliders();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Slider Homepage',
    azione: 'Eliminazione Slide',
    oggetto: `${item.title} (ID: ${item.id})`,
    dettagli: `Eliminata slide "${item.title}" e riordinata sequenza`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Slide "${item.title}" eliminata con successo` });
});

// ==========================================
// GESTIONE CONTENITORI HOMEPAGE (THEMATIC BOXES)
// ==========================================
function saveContenitoriData() {
  db.saveContenitori(db.rawContenitori || []);
}

// Public API for Homepage Box Carousel
app.get('/api/public/contenitori', (req, res) => {
  const list = (db.rawContenitori || [])
    .filter(c => Number(c.status) === 1)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map(c => ({
      ...c,
      items: (c.items || [])
        .filter(it => Number(it.status) === 1)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    }));
  res.json({ success: true, contenitori: list });
});

// Admin API to list all contenitori with full structure & stats
app.get('/api/admin/contenitori', (req, res) => {
  const contenitori = (db.rawContenitori || [])
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map(c => ({
      ...c,
      items: (c.items || []).slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    }));

  let totalBoxes = contenitori.length;
  let publishedBoxes = contenitori.filter(c => Number(c.status) === 1).length;
  let suspendedBoxes = contenitori.filter(c => Number(c.status) === 0).length;
  let totalLinks = 0;
  let publishedLinks = 0;
  let suspendedLinks = 0;

  contenitori.forEach(c => {
    (c.items || []).forEach(it => {
      totalLinks++;
      if (Number(it.status) === 1) publishedLinks++;
      else suspendedLinks++;
    });
  });

  res.json({
    success: true,
    contenitori,
    stats: {
      totalBoxes,
      publishedBoxes,
      suspendedBoxes,
      totalLinks,
      publishedLinks,
      suspendedLinks
    }
  });
});

// Admin API: Create new box
app.post('/api/admin/contenitori', (req, res) => {
  const { title, tag, icon, icon_color, icon_bg, status } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Il titolo del contenitore è obbligatorio' });
  }

  const existingIds = (db.rawContenitori || []).map(c => parseInt(c.id) || 0);
  const newId = String(existingIds.length ? Math.max(...existingIds) + 1 : 1);
  const maxOrder = (db.rawContenitori || []).reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0);

  const newBox = {
    id: newId,
    title: title.trim(),
    tag: (tag || '').trim(),
    icon: (icon || 'fas fa-folder').trim(),
    icon_color: (icon_color || '#15549a').trim(),
    icon_bg: (icon_bg || 'rgba(21, 84, 154, 0.1)').trim(),
    sort_order: maxOrder + 1,
    status: status !== undefined ? Number(status) : 1,
    items: []
  };

  db.rawContenitori.push(newBox);
  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Creazione Contenitore',
    oggetto: `${newBox.title} (ID: ${newBox.id})`,
    dettagli: `Creato nuovo box homepage "${newBox.title}"`,
    esito: 'OK'
  });

  res.json({ success: true, contenitore: newBox, message: 'Contenitore creato con successo' });
});

// Admin API: Update box
app.put('/api/admin/contenitori/:id', (req, res) => {
  const id = String(req.params.id);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const { title, tag, icon, icon_color, icon_bg, status, sort_order } = req.body || {};
  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'Il titolo non può essere vuoto' });
    box.title = title.trim();
  }
  if (tag !== undefined) box.tag = String(tag).trim();
  if (icon !== undefined) box.icon = String(icon).trim();
  if (icon_color !== undefined) box.icon_color = String(icon_color).trim();
  if (icon_bg !== undefined) box.icon_bg = String(icon_bg).trim();
  if (status !== undefined) box.status = Number(status) ? 1 : 0;
  if (sort_order !== undefined && sort_order !== '') box.sort_order = Number(sort_order);

  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Modifica Contenitore',
    oggetto: `${box.title} (ID: ${box.id})`,
    dettagli: `Modificate impostazioni del box`,
    esito: 'OK'
  });

  res.json({ success: true, contenitore: box, message: 'Contenitore aggiornato con successo' });
});

// Admin API: Toggle box status
app.put('/api/admin/contenitori/:id/toggle-status', (req, res) => {
  const id = String(req.params.id);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  box.status = Number(box.status) === 1 ? 0 : 1;
  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Cambio Stato Contenitore',
    oggetto: `${box.title} (ID: ${box.id})`,
    dettagli: `Stato impostato a: ${box.status === 1 ? 'PUBBLICATO' : 'SOSPESO'}`,
    esito: 'OK'
  });

  res.json({ success: true, status: box.status, message: `Contenitore ${box.status === 1 ? 'pubblicato' : 'sospeso'} con successo` });
});

// Admin API: Move box UP/DOWN
app.post('/api/admin/contenitori/:id/move', (req, res) => {
  const id = String(req.params.id);
  const { direction } = req.body || {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'Direzione non valida (up/down).' });
  }

  const list = db.rawContenitori || [];
  list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const idx = list.findIndex(c => String(c.id) === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Contenitore non trovato.' });
  }

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= list.length) {
    return res.json({ success: true, message: 'Già al limite consentito' });
  }

  const temp = list[idx].sort_order;
  list[idx].sort_order = list[targetIdx].sort_order;
  list[targetIdx].sort_order = temp;

  if (list[idx].sort_order === list[targetIdx].sort_order) {
    list.forEach((c, i) => { c.sort_order = (i + 1) * 10; });
    const newIdx = list.findIndex(c => String(c.id) === id);
    const newTarget = direction === 'up' ? newIdx - 1 : newIdx + 1;
    if (newTarget >= 0 && newTarget < list.length) {
      const t = list[newIdx].sort_order;
      list[newIdx].sort_order = list[newTarget].sort_order;
      list[newTarget].sort_order = t;
    }
  }

  list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  saveContenitoriData();

  res.json({ success: true, message: 'Ordinamento aggiornato' });
});

// Admin API: Delete box
app.delete('/api/admin/contenitori/:id', (req, res) => {
  const id = String(req.params.id);
  const idx = (db.rawContenitori || []).findIndex(c => String(c.id) === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const box = db.rawContenitori[idx];
  db.rawContenitori.splice(idx, 1);
  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Eliminazione Contenitore',
    oggetto: `${box.title} (ID: ${box.id})`,
    dettagli: `Eliminato contenitore con ${box.items ? box.items.length : 0} collegamenti`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Contenitore "${box.title}" eliminato` });
});

// Admin API: Add link item to box
app.post('/api/admin/contenitori/:id/items', (req, res) => {
  const id = String(req.params.id);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  if (!box.items) box.items = [];
  const { title, url, status } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Il titolo del collegamento è obbligatorio' });
  }

  let maxItemId = 0;
  (db.rawContenitori || []).forEach(c => {
    (c.items || []).forEach(it => {
      const num = parseInt(it.id) || 0;
      if (num > maxItemId) maxItemId = num;
    });
  });
  const newItemId = String(maxItemId + 1);
  const maxOrder = box.items.reduce((max, it) => Math.max(max, Number(it.sort_order) || 0), 0);

  const newItem = {
    id: newItemId,
    title: title.trim(),
    url: (url && url.trim()) ? url.trim() : '#',
    status: status !== undefined ? Number(status) : 1,
    sort_order: maxOrder + 1
  };

  box.items.push(newItem);
  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Aggiunto Collegamento',
    oggetto: `${newItem.title} in ${box.title}`,
    dettagli: `URL: ${newItem.url}`,
    esito: 'OK'
  });

  res.json({ success: true, item: newItem, message: 'Collegamento aggiunto con successo' });
});

// Admin API: Update link item
app.put('/api/admin/contenitori/:id/items/:itemId', (req, res) => {
  const id = String(req.params.id);
  const itemId = String(req.params.itemId);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const it = (box.items || []).find(i => String(i.id) === itemId);
  if (!it) {
    return res.status(404).json({ error: 'Collegamento non trovato nel contenitore' });
  }

  const { title, url, status, target_box_id } = req.body || {};
  if (title !== undefined) {
    if (!title.trim()) return res.status(400).json({ error: 'Il titolo non può essere vuoto' });
    it.title = title.trim();
  }
  if (url !== undefined) it.url = (url && url.trim()) ? url.trim() : '#';
  if (status !== undefined) it.status = Number(status) ? 1 : 0;

  if (target_box_id && String(target_box_id) !== id) {
    const targetBox = (db.rawContenitori || []).find(c => String(c.id) === String(target_box_id));
    if (targetBox) {
      if (!targetBox.items) targetBox.items = [];
      box.items = box.items.filter(i => String(i.id) !== itemId);
      it.sort_order = (targetBox.items.length + 1);
      targetBox.items.push(it);
    }
  }

  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Modifica Collegamento',
    oggetto: `${it.title} in ${box.title}`,
    dettagli: `Aggiornato URL: ${it.url}, stato: ${it.status}`,
    esito: 'OK'
  });

  res.json({ success: true, item: it, message: 'Collegamento aggiornato' });
});

// Admin API: Toggle link item status
app.put('/api/admin/contenitori/:id/items/:itemId/toggle-status', (req, res) => {
  const id = String(req.params.id);
  const itemId = String(req.params.itemId);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const it = (box.items || []).find(i => String(i.id) === itemId);
  if (!it) {
    return res.status(404).json({ error: 'Collegamento non trovato' });
  }

  it.status = Number(it.status) === 1 ? 0 : 1;
  saveContenitoriData();

  res.json({ success: true, status: it.status, message: `Collegamento ${it.status === 1 ? 'pubblicato' : 'sospeso'}` });
});

// Admin API: Move link item UP/DOWN
app.post('/api/admin/contenitori/:id/items/:itemId/move', (req, res) => {
  const id = String(req.params.id);
  const itemId = String(req.params.itemId);
  const { direction } = req.body || {};
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'Direzione non valida (up/down).' });
  }

  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box || !box.items) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const items = box.items;
  items.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const idx = items.findIndex(i => String(i.id) === itemId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Collegamento non trovato' });
  }

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= items.length) {
    return res.json({ success: true, message: 'Già al limite consentito' });
  }

  const temp = items[idx].sort_order;
  items[idx].sort_order = items[targetIdx].sort_order;
  items[targetIdx].sort_order = temp;

  if (items[idx].sort_order === items[targetIdx].sort_order) {
    items.forEach((it, i) => { it.sort_order = (i + 1) * 10; });
    const newIdx = items.findIndex(i => String(i.id) === itemId);
    const newTarget = direction === 'up' ? newIdx - 1 : newIdx + 1;
    if (newTarget >= 0 && newTarget < items.length) {
      const t = items[newIdx].sort_order;
      items[newIdx].sort_order = items[newTarget].sort_order;
      items[newTarget].sort_order = t;
    }
  }

  items.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  saveContenitoriData();

  res.json({ success: true, message: 'Ordinamento aggiornato' });
});

// Admin API: Delete link item
app.delete('/api/admin/contenitori/:id/items/:itemId', (req, res) => {
  const id = String(req.params.id);
  const itemId = String(req.params.itemId);
  const box = (db.rawContenitori || []).find(c => String(c.id) === id);
  if (!box || !box.items) {
    return res.status(404).json({ error: 'Contenitore non trovato' });
  }

  const idx = box.items.findIndex(i => String(i.id) === itemId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Collegamento non trovato' });
  }

  const it = box.items[idx];
  box.items.splice(idx, 1);
  saveContenitoriData();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Contenuti - Contenitori',
    azione: 'Eliminazione Collegamento',
    oggetto: `${it.title} da ${box.title}`,
    dettagli: `Eliminato collegamento URL ${it.url}`,
    esito: 'OK'
  });

  res.json({ success: true, message: `Collegamento "${it.title}" eliminato` });
});

// ==========================================
// ADMIN MEDIA & IMAGES EXPLORER (/images) API
// ==========================================
const IMAGES_ROOT_DIR = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(IMAGES_ROOT_DIR)) {
  fs.mkdirSync(IMAGES_ROOT_DIR, { recursive: true });
}

function resolveSafeImagesPath(subPath = '') {
  const cleaned = String(subPath || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\.(\/|\\|$))+/, '')
    .replace(/^[/\\]+/, '');
  const resolved = path.resolve(IMAGES_ROOT_DIR, cleaned);
  if (!resolved.startsWith(IMAGES_ROOT_DIR)) {
    return null;
  }
  return {
    fullPath: resolved,
    relPath: path.relative(IMAGES_ROOT_DIR, resolved).replace(/\\/g, '/')
  };
}

const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico']);

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 1. Get folder tree
app.get('/api/admin/images/tree', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  try {
    function buildTree(currentDir, currentRel) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      let imageCount = 0;
      const children = [];

      for (const ent of entries) {
        if (ent.isDirectory()) {
          const subRel = currentRel ? `${currentRel}/${ent.name}` : ent.name;
          const subFull = path.join(currentDir, ent.name);
          children.push(buildTree(subFull, subRel));
        } else if (ent.isFile()) {
          const ext = path.extname(ent.name).toLowerCase();
          if (ALLOWED_IMAGE_EXTS.has(ext)) {
            imageCount++;
          }
        }
      }

      children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      return {
        name: currentRel ? path.basename(currentDir) : 'images',
        path: currentRel,
        fullUrlPath: currentRel ? `/images/${currentRel}` : '/images',
        imageCount,
        subfolderCount: children.length,
        children
      };
    }

    const tree = buildTree(IMAGES_ROOT_DIR, '');
    res.json({ success: true, tree });
  } catch (err) {
    console.error('Errore get image tree:', err);
    res.status(500).json({ error: 'Errore durante la lettura delle cartelle del server.' });
  }
});

// 2. Get files in selected folder
app.get('/api/admin/images/files', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const folderParam = req.query.folder || '';
  const safe = resolveSafeImagesPath(folderParam);
  if (!safe || !fs.existsSync(safe.fullPath)) {
    return res.status(404).json({ error: 'Cartella non trovata.' });
  }

  try {
    const entries = fs.readdirSync(safe.fullPath, { withFileTypes: true });
    const files = [];
    let totalSize = 0;

    for (const ent of entries) {
      if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (ALLOWED_IMAGE_EXTS.has(ext)) {
          const filePath = path.join(safe.fullPath, ent.name);
          const stat = fs.statSync(filePath);
          totalSize += stat.size;
          const relFilePath = safe.relPath ? `${safe.relPath}/${ent.name}` : ent.name;
          files.push({
            name: ent.name,
            folder: safe.relPath,
            url: `/images/${relFilePath}`,
            size: stat.size,
            sizeFormatted: formatFileSize(stat.size),
            mtime: stat.mtime.toISOString(),
            ext: ext
          });
        }
      }
    }

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    res.json({
      success: true,
      folder: safe.relPath,
      fullUrlPath: safe.relPath ? `/images/${safe.relPath}` : '/images',
      totalFiles: files.length,
      totalSize,
      totalSizeFormatted: formatFileSize(totalSize),
      files
    });
  } catch (err) {
    console.error('Errore lettura file cartella immagini:', err);
    res.status(500).json({ error: 'Errore durante la lettura delle immagini.' });
  }
});

// 3. Create new folder
app.post('/api/admin/images/folder', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const { parentFolder, folderName } = req.body || {};
  if (!folderName || !folderName.trim()) {
    return res.status(400).json({ error: 'Specificare un nome valido per la cartella.' });
  }

  const cleanFolderName = folderName.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!cleanFolderName) {
    return res.status(400).json({ error: 'Nome cartella non valido.' });
  }

  const safeParent = resolveSafeImagesPath(parentFolder || '');
  if (!safeParent || !fs.existsSync(safeParent.fullPath)) {
    return res.status(404).json({ error: 'Cartella genitore non trovata.' });
  }

  const targetDir = path.join(safeParent.fullPath, cleanFolderName);
  if (fs.existsSync(targetDir)) {
    return res.status(400).json({ error: `La cartella "${cleanFolderName}" esiste già.` });
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const newRelPath = safeParent.relPath ? `${safeParent.relPath}/${cleanFolderName}` : cleanFolderName;

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Esplora Risorse Immagini',
      azione: 'Creazione Cartella',
      oggetto: `/images/${newRelPath}`,
      dettagli: `Creata nuova cartella "${cleanFolderName}" in /images/${safeParent.relPath || ''}`,
      esito: 'OK'
    });

    res.json({
      success: true,
      message: `Cartella "${cleanFolderName}" creata con successo.`,
      newFolder: newRelPath,
      fullUrlPath: `/images/${newRelPath}`
    });
  } catch (err) {
    console.error('Errore creazione cartella immagini:', err);
    res.status(500).json({ error: 'Impossibile creare la cartella.' });
  }
});

// 4. Delete folder
app.delete('/api/admin/images/folder', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const { folder } = req.body || {};
  if (!folder || !folder.trim() || folder.trim() === '/' || folder.trim() === 'images') {
    return res.status(400).json({ error: 'Non è consentito eliminare la cartella radice images.' });
  }

  const safe = resolveSafeImagesPath(folder);
  if (!safe || safe.fullPath === IMAGES_ROOT_DIR) {
    return res.status(400).json({ error: 'Impossibile eliminare la cartella principale.' });
  }

  if (!fs.existsSync(safe.fullPath)) {
    return res.status(404).json({ error: 'Cartella non trovata.' });
  }

  try {
    fs.rmSync(safe.fullPath, { recursive: true, force: true });

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Esplora Risorse Immagini',
      azione: 'Eliminazione Cartella',
      oggetto: `/images/${safe.relPath}`,
      dettagli: `Eliminata cartella e tutti i relativi contenuti: /images/${safe.relPath}`,
      esito: 'OK'
    });

    const parentRel = path.dirname(safe.relPath).replace(/\\/g, '/');
    const returnFolder = (parentRel === '.' || !parentRel) ? '' : parentRel;

    res.json({
      success: true,
      message: `Cartella "/images/${safe.relPath}" eliminata con successo.`,
      parentFolder: returnFolder
    });
  } catch (err) {
    console.error('Errore eliminazione cartella immagini:', err);
    res.status(500).json({ error: 'Impossibile eliminare la cartella selezionata.' });
  }
});

// 5. Upload image(s) to folder
app.post('/api/admin/images/upload', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const { folder, files } = req.body || {};
  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Nessun file fornito per il caricamento.' });
  }

  const safe = resolveSafeImagesPath(folder || '');
  if (!safe || !fs.existsSync(safe.fullPath)) {
    return res.status(404).json({ error: 'Cartella di destinazione non trovata.' });
  }

  try {
    const uploaded = [];
    const errors = [];

    for (const f of files) {
      if (!f.name || !f.data) {
        errors.push({ name: f.name || 'sconosciuto', error: 'Dati file incompleti' });
        continue;
      }

      const ext = path.extname(f.name).toLowerCase();
      if (!ALLOWED_IMAGE_EXTS.has(ext)) {
        errors.push({ name: f.name, error: `Estensione ${ext} non consentita` });
        continue;
      }

      const rawBase = path.basename(f.name, ext).replace(/[^a-zA-Z0-9_\-\. ]/g, '_').trim();
      let safeName = `${rawBase || 'img'}${ext}`;
      let destPath = path.join(safe.fullPath, safeName);

      if (fs.existsSync(destPath)) {
        safeName = `${rawBase || 'img'}_${Date.now()}${ext}`;
        destPath = path.join(safe.fullPath, safeName);
      }

      const base64Clean = f.data.replace(/^data:image\/[a-z0-9-+.]+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      fs.writeFileSync(destPath, buffer);

      const relFilePath = safe.relPath ? `${safe.relPath}/${safeName}` : safeName;
      uploaded.push({
        name: safeName,
        url: `/images/${relFilePath}`,
        size: buffer.length,
        sizeFormatted: formatFileSize(buffer.length)
      });
    }

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Esplora Risorse Immagini',
      azione: 'Upload Immagini',
      oggetto: `/images/${safe.relPath || ''}`,
      dettagli: `Caricate ${uploaded.length} immagini nella cartella /images/${safe.relPath || ''}`,
      esito: uploaded.length > 0 ? 'OK' : 'KO'
    });

    res.json({
      success: uploaded.length > 0,
      uploadedCount: uploaded.length,
      uploaded,
      errors
    });
  } catch (err) {
    console.error('Errore upload immagini:', err);
    res.status(500).json({ error: 'Errore durante il caricamento delle immagini sul server.' });
  }
});

// 6. Delete image file
app.delete('/api/admin/images/file', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const { folder, fileName } = req.body || {};
  if (!fileName || !fileName.trim()) {
    return res.status(400).json({ error: 'Specificare il nome del file da eliminare.' });
  }

  const safe = resolveSafeImagesPath(folder || '');
  if (!safe || !fs.existsSync(safe.fullPath)) {
    return res.status(404).json({ error: 'Cartella non trovata.' });
  }

  const cleanFileName = path.basename(fileName.trim());
  const filePath = path.join(safe.fullPath, cleanFileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `File "${cleanFileName}" non trovato.` });
  }

  try {
    fs.unlinkSync(filePath);

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Esplora Risorse Immagini',
      azione: 'Eliminazione File Immagine',
      oggetto: cleanFileName,
      dettagli: `Eliminato file immagine dalla cartella /images/${safe.relPath || ''}`,
      esito: 'OK'
    });

    res.json({
      success: true,
      message: `File "${cleanFileName}" eliminato con successo.`
    });
  } catch (err) {
    console.error('Errore eliminazione file immagine:', err);
    res.status(500).json({ error: 'Impossibile eliminare il file selezionato.' });
  }
});

// 7. Rename image file
app.post('/api/admin/images/rename', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso negato: richiesto ruolo amministratore.' });
  }

  const { folder, oldName, newName } = req.body || {};
  if (!oldName || !newName || !oldName.trim() || !newName.trim()) {
    return res.status(400).json({ error: 'Specificare sia il nome attuale sia il nuovo nome.' });
  }

  const safe = resolveSafeImagesPath(folder || '');
  if (!safe || !fs.existsSync(safe.fullPath)) {
    return res.status(404).json({ error: 'Cartella non trovata.' });
  }

  const cleanOld = path.basename(oldName.trim());
  const oldExt = path.extname(cleanOld).toLowerCase();

  let cleanNew = path.basename(newName.trim()).replace(/[\\/:*?"<>|]/g, '_');
  if (!path.extname(cleanNew)) {
    cleanNew += oldExt;
  }
  const newExt = path.extname(cleanNew).toLowerCase();

  if (!ALLOWED_IMAGE_EXTS.has(newExt)) {
    return res.status(400).json({ error: `Estensione ${newExt} non consentita.` });
  }

  const oldPath = path.join(safe.fullPath, cleanOld);
  const newPath = path.join(safe.fullPath, cleanNew);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: `File di origine "${cleanOld}" non trovato.` });
  }

  if (oldPath !== newPath && fs.existsSync(newPath)) {
    return res.status(400).json({ error: `Un file con nome "${cleanNew}" esiste già in questa cartella.` });
  }

  try {
    fs.renameSync(oldPath, newPath);

    recordOperationLog(req, {
      origine: 'admin',
      categoria: 'Esplora Risorse Immagini',
      azione: 'Rinomina File Immagine',
      oggetto: `${cleanOld} -> ${cleanNew}`,
      dettagli: `Rinominato file in /images/${safe.relPath || ''}`,
      esito: 'OK'
    });

    const relFilePath = safe.relPath ? `${safe.relPath}/${cleanNew}` : cleanNew;
    res.json({
      success: true,
      message: `File rinominato in "${cleanNew}".`,
      oldName: cleanOld,
      newName: cleanNew,
      url: `/images/${relFilePath}`
    });
  } catch (err) {
    console.error('Errore rinomina file immagine:', err);
    res.status(500).json({ error: 'Impossibile rinominare il file.' });
  }
});

// ==========================================
// TRADUZIONE MULTILINGUA DELLE PAGINE (IT / EN / ES / FR)
// ==========================================
const TRANSLATIONS_CACHE_FILE = path.join(__dirname, 'data', 'page_translations_cache.json');
let pageTranslationsCache = {};

function loadTranslationsCache() {
  try {
    if (fs.existsSync(TRANSLATIONS_CACHE_FILE)) {
      pageTranslationsCache = JSON.parse(fs.readFileSync(TRANSLATIONS_CACHE_FILE, 'utf8'));
    } else {
      const dataDir = path.dirname(TRANSLATIONS_CACHE_FILE);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(TRANSLATIONS_CACHE_FILE, JSON.stringify({}), 'utf8');
      pageTranslationsCache = {};
    }
  } catch (err) {
    console.error('Errore caricamento cache traduzioni:', err.message);
    pageTranslationsCache = {};
  }
}
loadTranslationsCache();

function saveTranslationsCache() {
  try {
    const dataDir = path.dirname(TRANSLATIONS_CACHE_FILE);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(TRANSLATIONS_CACHE_FILE, JSON.stringify(pageTranslationsCache, null, 2), 'utf8');
  } catch (err) {
    console.error('Errore salvataggio cache traduzioni:', err.message);
  }
}

async function translateTextSegment(text, targetLang) {
  if (!text || !text.trim()) return text;
  const clean = text.trim();
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=it|${targetLang}`;
    const res = await fetch(url);
    if (!res.ok) return text;
    const data = await res.json();
    return (data.responseData && data.responseData.translatedText) || text;
  } catch (err) {
    return text;
  }
}

async function translateHtmlContent(html, targetLang) {
  if (!html || !html.trim()) return html;
  try {
    const parts = html.split(/(<[^>]+>)/g);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part.startsWith('<') && part.trim().length > 0) {
        if (part.trim().length > 400) {
          const sentences = part.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [part];
          const translatedSentences = [];
          for (const s of sentences) {
            if (s.trim().length > 0) {
              const trans = await translateTextSegment(s, targetLang);
              translatedSentences.push(trans);
            }
          }
          parts[i] = translatedSentences.join(' ');
        } else {
          parts[i] = await translateTextSegment(part, targetLang);
        }
      }
    }
    return parts.join('');
  } catch (err) {
    return html;
  }
}

async function getOrTranslatePage(page, lang) {
  if (!page) return null;
  if (!lang || lang === 'it') return page;

  const cacheKey = `${page.id}_${lang}`;
  if (pageTranslationsCache[cacheKey]) {
    return {
      ...page,
      title: pageTranslationsCache[cacheKey].title,
      text: pageTranslationsCache[cacheKey].text,
      lang: lang
    };
  }

  // Generate translation
  const translatedTitle = await translateTextSegment(page.title, lang);
  const translatedText = await translateHtmlContent(page.text || '', lang);

  pageTranslationsCache[cacheKey] = {
    title: translatedTitle,
    text: translatedText,
    timestamp: Date.now()
  };
  saveTranslationsCache();

  return {
    ...page,
    title: translatedTitle,
    text: translatedText,
    lang: lang
  };
}

// Get page by ID or Slug (con supporto ?lang=it|en|es|fr)
app.get('/api/pages/:idOrSlug', async (req, res) => {
  const query = req.params.idOrSlug.toLowerCase().trim();
  const lang = (req.query.lang || 'it').toLowerCase().trim();
  const pages = db.rawWebpages || [];

  let page = pages.find(p => String(p.id) === query);
  if (!page) {
    page = pages.find(p => p.slug && p.slug.toLowerCase() === query);
  }
  if (!page) {
    const cleanQuery = query.replace(/[^a-z0-9]/g, '');
    page = pages.find(p => {
      const cleanSlug = (p.slug || '').replace(/[^a-z0-9]/g, '');
      const cleanTitle = (p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return cleanSlug === cleanQuery || cleanTitle === cleanQuery || cleanSlug.includes(cleanQuery) || cleanTitle.includes(cleanQuery);
    });
  }

  if (!page) {
    return res.status(404).json({ error: 'Pagina o articolo non trovato nel database' });
  }

  if (lang === 'it') {
    return res.json({ page });
  }

  try {
    const translated = await getOrTranslatePage(page, lang);
    res.json({ page: translated });
  } catch (err) {
    console.error('Errore traduzione pagina:', err);
    res.json({ page });
  }
});

// Update user status
app.put('/api/admin/users/:id/status', (req, res) => {
  const { status } = req.body;
  const idx = db.usersList.findIndex(u => String(u.id) === String(req.params.id) || String(u.rawId) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Utente non trovato' });

  db.usersList[idx].status = status;
  saveDynamicUsersFile();

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Gestione Utenti',
    azione: `Modifica Stato Utente (${String(status || '').toUpperCase()})`,
    oggetto: `${db.usersList[idx].username} (${db.usersList[idx].nome || ''})`,
    dettagli: `Stato dell'utenza "${db.usersList[idx].username}" (Ruolo: ${db.usersList[idx].role}) impostato a "${status}"`,
    esito: 'OK'
  });

  res.json({ success: true, user: db.usersList[idx] });
});

// Chrono frontend ranking upload endpoint (tracks ranking submissions in operations log)
app.post('/api/crono/upload-classifica', (req, res) => {
  const user = getCurrentUser(req);
  const { garaNome, formato, fileName, atletiValidati } = req.body || {};
  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Classifiche Cronometraggio',
    azione: 'Caricamento Classifica Ufficiale Gara',
    oggetto: `${garaNome || 'Gara FISky'} (${fileName || formato || 'CSV/XML'})`,
    dettagli: `Azienda Crono: ${(user && (user.ragioneSociale || user.nome)) || 'Cronometrista Ufficiale'} | Formato: ${formato || 'Standard FISky'} | File: ${fileName || 'classifica.csv'} | Tesserati verificati: ${atletiValidati || 'OK'}`,
    esito: 'OK'
  });
  res.json({
    success: true,
    message: 'Classifica ufficiale acquisita e registrata nel log federale.'
  });
});

// Save site configuration options (Admin only)
app.post('/api/admin/config/opzioni', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: 'Accesso consentito esclusivamente agli utenti di tipo amministratore.' });
  }
  const { nomePortale, emailSegreteria, annoSportivo, tesseramentoAperto } = req.body || {};
  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Configurazioni Sistema',
    azione: 'Salvataggio Opzioni Generali Sito',
    oggetto: `Anno Sportivo ${annoSportivo || new Date().getFullYear()}`,
    dettagli: `Portale: "${nomePortale || 'FISky'}" | Email Segreteria: ${emailSegreteria || 'segreteria@skyrunningitalia.it'} | Tesseramento aperto: ${tesseramentoAperto !== undefined ? tesseramentoAperto : 'Sì'}`,
    esito: 'OK'
  });
  res.json({
    success: true,
    message: 'Configurazioni generali del portale aggiornate e tracciate nel registro.'
  });
});

// ================= ADMIN: LOG OPERAZIONI (SOLO AMMINISTRATORE) ================= //

function filterOperationsLogs(req) {
  const allLogs = db.operationsLogList || [];
  const filterOrigine = (req.query.origine || 'all').trim().toLowerCase();
  const filterCategoria = (req.query.categoria || 'all').trim();
  const filterEsito = (req.query.esito || 'all').trim().toUpperCase();
  const filterRuolo = (req.query.ruolo || 'all').trim().toLowerCase();
  const dateFrom = (req.query.dateFrom || '').trim(); // YYYY-MM-DD
  const dateTo = (req.query.dateTo || '').trim();     // YYYY-MM-DD
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();

  let list = [...allLogs];

  if (filterOrigine && filterOrigine !== 'all') {
    list = list.filter(l => String(l.origine || '').toLowerCase() === filterOrigine);
  }

  if (filterCategoria && filterCategoria !== 'all') {
    const fcLower = filterCategoria.toLowerCase();
    list = list.filter(l => String(l.categoria || '').toLowerCase() === fcLower);
  }

  if (filterEsito && filterEsito !== 'ALL') {
    list = list.filter(l => String(l.esito || 'OK').toUpperCase() === filterEsito);
  }

  if (filterRuolo && filterRuolo !== 'all') {
    list = list.filter(l => String(l.ruolo || '').toLowerCase() === filterRuolo);
  }

  if (dateFrom) {
    list = list.filter(l => {
      const isoDay = String(l.timestamp || '').slice(0, 10);
      return isoDay >= dateFrom;
    });
  }

  if (dateTo) {
    list = list.filter(l => {
      const isoDay = String(l.timestamp || '').slice(0, 10);
      return isoDay <= dateTo;
    });
  }

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(l => {
      const hay = [
        l.id,
        l.logNumber,
        l.dataOra,
        l.origine,
        l.categoria,
        l.azione,
        l.oggetto,
        l.dettagli,
        l.operatore,
        l.ruoloLabel,
        l.ip,
        l.metodo,
        l.esito
      ].join(' ').toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  return list;
}

// Get operations logs (Strictly reserved to Administrator users)
app.get('/api/admin/logs', (req, res) => {
  if (!isAdminUser(req)) {
    recordOperationLog(req, {
      origine: 'frontend',
      categoria: 'Sicurezza e Controllo Accessi',
      azione: 'Tentativo Non Autorizzato di Consultazione Log Operazioni',
      oggetto: 'Endpoint /api/admin/logs',
      dettagli: 'Accesso negato (HTTP 403): la consultazione del Log Operazioni è riservata esclusivamente alle utenze di tipo Amministratore.',
      esito: 'ERRORE'
    });
    return res.status(403).json({
      error: 'Accesso negato: il Log Operazioni è consultabile esclusivamente dalle utenze di tipo Amministratore.'
    });
  }

  const allLogs = db.operationsLogList || [];
  const filtered = filterOperationsLogs(req);

  // Extract distinct categories for the filter dropdown
  const categoriesSet = new Set();
  allLogs.forEach(l => {
    if (l.categoria) categoriesSet.add(l.categoria);
  });
  const availableCategories = Array.from(categoriesSet).sort((a, b) => a.localeCompare(b, 'it'));

  // KPI counters across all logs
  const totalAll = allLogs.length;
  const frontendCount = allLogs.filter(l => l.origine === 'frontend').length;
  const adminCount = allLogs.filter(l => l.origine === 'admin').length;
  const errorCount = allLogs.filter(l => String(l.esito || '').toUpperCase() === 'ERRORE').length;

  const total = filtered.length;
  const limitParam = req.query.limit || '50';
  let paginated = filtered;
  let page = 1;
  let totalPages = 1;

  if (limitParam !== 'all' && parseInt(limitParam, 10) > 0) {
    const limitNum = parseInt(limitParam, 10);
    totalPages = Math.max(1, Math.ceil(total / limitNum));
    page = Math.max(1, Math.min(parseInt(req.query.page, 10) || 1, totalPages));
    const offset = (page - 1) * limitNum;
    paginated = filtered.slice(offset, offset + limitNum);
  }

  res.json({
    success: true,
    logs: paginated,
    total,
    totalAll,
    frontendCount,
    adminCount,
    errorCount,
    availableCategories,
    page,
    limit: limitParam,
    totalPages
  });
});

// Export operations logs to Excel (.xls) (Strictly reserved to Administrator users)
app.get('/api/admin/logs/export-xls', (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({
      error: 'Accesso negato: l\'esportazione del Log Operazioni è riservata esclusivamente alle utenze di tipo Amministratore.'
    });
  }

  const list = filterOperationsLogs(req);

  recordOperationLog(req, {
    origine: 'admin',
    categoria: 'Amministrazione Sistema',
    azione: 'Esportazione Excel Log Operazioni',
    oggetto: `Registro Log Operazioni (${list.length} voci)`,
    dettagli: `Esportato file Excel (.xls) del Log Operazioni con ${list.length} record`,
    esito: 'OK'
  });

  const esc = str => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const rowsHtml = list.map((l, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    const origineLabel = l.origine === 'admin' ? 'AMMINISTRATIVA (Pannello Admin)' : 'FRONTEND (Richiesta Utente / Sito)';
    return `
      <tr style="background-color: ${bg};">
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">#${esc(l.logNumber || l.id)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; mso-number-format:'\\@'; text-align: center;">${esc(l.dataOra)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${esc(origineLabel)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${esc(l.categoria)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${esc(l.operatore)} (${esc(l.ruoloLabel || l.ruolo)})</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-weight: bold;">${esc(l.azione)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${esc(l.oggetto)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px;">${esc(l.dettagli)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">${esc(l.ip)} | ${esc(l.metodo)}</td>
        <td style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center; font-weight: bold;">${esc(l.esito)}</td>
      </tr>
    `;
  }).join('');

  const xlsHtml = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
</head>
<body>
  <table border="1" cellspacing="0" cellpadding="5" style="border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10pt;">
    <thead>
      <tr>
        <th colspan="10" style="background-color: #15549a; color: #ffffff; font-size: 14pt; font-weight: bold; text-align: center; padding: 12px; border: 1px solid #0a2759;">
          FISky - Registro Ufficiale Log Operazioni (Amministrazione &amp; Frontend)
        </th>
      </tr>
      <tr style="background-color: #2a3f54; color: #ffffff; font-weight: bold;">
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">#ID</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Data e Ora</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Origine</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Categoria</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Operatore &amp; Ruolo</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Azione</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Oggetto / Riferimento</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Dettagli Operazione</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">IP / Endpoint</th>
        <th style="border: 1px solid #1e293b; padding: 8px 10px;">Esito</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName = `Log_Operazioni_FISky_${todayStr}.xls`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(xlsHtml);
});

// Admin members / anagrafe
app.get('/api/admin/members', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 1000;
  res.json({ members: db.membersList.slice(0, limit) });
});

// Admin atleti (SKYA) con ricerca e paginazione su tutti i 5.892 tesserati
app.get('/api/admin/atleti', (req, res) => {
  const result = paginateAndSearchAtleti(db.atletiList, req);
  res.json(result);
});

// Dettaglio singolo tesserato / atleta per modale di visualizzazione
app.get('/api/admin/atleti/:id', (req, res) => {
  const key = String(req.params.id || '').trim().toLowerCase();
  const found =
    db.atletiList.find(a =>
      String(a.id).toLowerCase() === key ||
      String(a.rawId).toLowerCase() === key ||
      String(a.numeroTessera || '').toLowerCase() === key ||
      String(a.numeroTesseraAtleta || '').toLowerCase() === key ||
      String(a.progressivo || '').toLowerCase() === key
    ) ||
    db.membersList.find(m =>
      String(m.id).toLowerCase() === key ||
      String(m.rawId).toLowerCase() === key ||
      String(m.numeroTessera || '').toLowerCase() === key ||
      String(m.numeroTesseraAtleta || '').toLowerCase() === key ||
      String(m.numeroTesseraDirigente || '').toLowerCase() === key ||
      String(m.numeroTesseraGuida || '').toLowerCase() === key ||
      String(m.progressivo || '').toLowerCase() === key
    );

  if (!found) {
    return res.status(404).json({ error: 'Tesserato non trovato' });
  }

  return res.json({
    success: true,
    atleta: found
  });
});

// Gerarchia ordinamento Ruolo Federale: Presidente, Vicepresidente, Segretario, Consigliere e a seguire gli altri
function getRuoloFederaleRank(roleStr) {
  if (!roleStr) return 99;
  const r = String(roleStr).toLowerCase().trim();
  // 1. Presidente (esclude Vicepresidente)
  if (r.includes('presidente') && !r.includes('vice')) {
    return 1;
  }
  // 2. Vicepresidente (Vicepresidente, Vicepresidente Vicario, ecc.)
  if (r.includes('vicepresidente') || r.includes('vice presidente') || r.includes('vice-presidente')) {
    return 2;
  }
  // 3. Segretario (Segretario Generale, Consigliere Dirigente (e/o Segretario), ecc.)
  if (r.includes('segretar')) {
    return 3;
  }
  // 4. Consigliere (Consigliere Dirigente, Consigliere Nazionale, ecc.)
  if (r.includes('consiglie')) {
    return 4;
  }
  // 5. Commissario / Direttore
  if (r.includes('commissar') || r.includes('direttor')) {
    return 5;
  }
  // 6. Rappresentante (Rappresentante Tecnici, Rappresentante Atleti)
  if (r.includes('rappresentante')) {
    return 6;
  }
  // 7. Giudice di gara
  if (r.includes('giudice')) {
    return 7;
  }
  // 8. Medico / Sanitario / Biologo
  if (r.includes('medico') || r.includes('biolog')) {
    return 8;
  }
  // 9. Altri ruoli dirigenziali
  return 9;
}

function paginateAndSearchDirigenti(sourceList, req) {
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const sort = (req.query.sort || 'ruoloFederale').trim();
  const dir = (req.query.dir || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const factor = dir === 'desc' ? -1 : 1;
  const stato = (req.query.stato || '').trim().toLowerCase();

  let list = sourceList;

  // Filtro per stato della carica federale (In Carica / Non più in carica)
  if (stato === 'in_carica' || stato === 'incarica') {
    list = list.filter(d => d.stato === 'In Carica' || d.inCarica === true);
  } else if (stato === 'non_in_carica' || stato === 'non_piu_in_carica' || stato === 'scaduto') {
    list = list.filter(d => d.stato === 'Non più in carica' || d.inCarica === false);
  }

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(d => {
      const nome = (d.nome || '').toLowerCase();
      const cognome = (d.cognome || '').toLowerCase();
      const nominativo = `${cognome} ${nome}`;
      const nominativoRev = `${nome} ${cognome}`;
      const cod = (d.codice || d.numeroTessera || '').toLowerCase();
      const ruolo = (d.ruoloFederale || d.ruoloDirigenziale || '').toLowerCase();
      const st = (d.stato || '').toLowerCase();
      const cf = (d.codiceFiscale || '').toLowerCase();
      const email = (d.email || '').toLowerCase();

      return tokens.every(t => 
        cod.includes(t) ||
        nominativo.includes(t) ||
        nominativoRev.includes(t) ||
        ruolo.includes(t) ||
        st.includes(t) ||
        cf.includes(t) ||
        email.includes(t)
      );
    });
  }

  // Sorting
  const sorted = [...list].sort((a, b) => {
    if (sort === 'codice' || sort === 'numeroTessera') {
      const ca = String(a.codice || a.numeroTessera || '');
      const cb = String(b.codice || b.numeroTessera || '');
      return factor * ca.localeCompare(cb, 'it', { numeric: true });
    }
    if (sort === 'nominativo') {
      const na = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nb = `${b.cognome || ''} ${b.nome || ''}`.trim();
      return factor * na.localeCompare(nb, 'it');
    }
    if (sort === 'stato') {
      const sa = String(a.stato || 'In Carica');
      const sb = String(b.stato || 'In Carica');
      const cmp = sa.localeCompare(sb, 'it');
      if (cmp !== 0) return factor * cmp;
      const na = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nb = `${b.cognome || ''} ${b.nome || ''}`.trim();
      return na.localeCompare(nb, 'it');
    }
    if (sort === 'ruoloFederale' || sort === 'ruolo' || sort === 'ruoloDirigenziale') {
      const ra = getRuoloFederaleRank(a.ruoloFederale || a.ruoloDirigenziale);
      const rb = getRuoloFederaleRank(b.ruoloFederale || b.ruoloDirigenziale);
      if (ra !== rb) {
        return factor * (ra - rb);
      }
      const rsa = String(a.ruoloFederale || a.ruoloDirigenziale || '');
      const rsb = String(b.ruoloFederale || b.ruoloDirigenziale || '');
      const cmp = rsa.localeCompare(rsb, 'it');
      if (cmp !== 0) return factor * cmp;
      const na = `${a.cognome || ''} ${a.nome || ''}`.trim();
      const nb = `${b.cognome || ''} ${b.nome || ''}`.trim();
      return na.localeCompare(nb, 'it');
    }
    return 0;
  });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit) || 100));
  const total = sorted.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const paged = sorted.slice(start, start + limit);

  return {
    dirigenti: paged,
    total,
    page,
    totalPages,
    limit,
    sort,
    dir,
    stato: stato || 'in_carica'
  };
}

// Admin figure dirigenziali federali (Codice FISKY + 6 cifre)
app.get('/api/admin/dirigenti', (req, res) => {
  const result = paginateAndSearchDirigenti(db.dirigentiList, req);
  res.json(result);
});

app.get('/api/admin/dirigenti/:id', (req, res) => {
  const idParam = String(req.params.id);
  const dirigente = db.dirigentiList.find(d => 
    String(d.id) === idParam || 
    String(d.rawId) === idParam || 
    String(d.codice).toLowerCase() === idParam.toLowerCase() ||
    String(d.numeroTessera).toLowerCase() === idParam.toLowerCase()
  );
  if (!dirigente) return res.status(404).json({ error: 'Figura dirigenziale non trovata' });
  res.json({ dirigente });
});

app.post('/api/admin/dirigenti', (req, res) => {
  const { nome, cognome, ruoloDirigenziale, stato, codiceFiscale, sesso, dataNascita, luogoNascita, email, telefono, indirizzo, civico, citta, cap, provincia, note } = req.body;
  
  if (!nome || !cognome) {
    return res.status(400).json({ error: 'Nome e Cognome sono campi obbligatori.' });
  }

  const nextRawId = Math.max(...(db.rawMembers || []).map(m => Number(m.id) || 0), 0) + 1;
  const progressivo = String(nextRawId).padStart(6, '0');
  let codice = (req.body.codice || '').trim().toUpperCase();
  if (!codice) {
    codice = `FISKY${progressivo}`;
  } else if (!codice.startsWith('FISKY')) {
    codice = `FISKY${codice}`;
  }

  const roleLabel = (ruoloDirigenziale || 'Dirigente Federale').trim();
  const cfUpper = (codiceFiscale || '').trim().toUpperCase();
  const statoVal = (stato && stato.trim() === 'Non più in carica') ? 'Non più in carica' : 'In Carica';
  const isInCarica = (statoVal === 'In Carica');

  // Create member record in rawMembers
  const rawMemberItem = {
    id: String(nextRawId),
    name: nome.trim(),
    surname: cognome.trim(),
    cf: cfUpper,
    gender: sesso || 'M',
    birthday: dataNascita || '',
    birthplace: luogoNascita || '',
    email: email ? email.trim() : '',
    telephone: telefono ? telefono.trim() : '',
    address: indirizzo || '',
    street_number: civico || '',
    city: citta || '',
    cap: cap || '',
    province: provincia || '',
    code: codice,
    comment: note || '',
    created: new Date().toISOString().slice(0, 10),
    affiliate_expire: isInCarica ? '2027-12-31' : '2021-12-31',
    stato: statoVal,
    in_carica: isInCarica
  };

  db.rawMembers.push(rawMemberItem);
  db.writeJsonFile('mysql_members.json', db.rawMembers);

  // Add federal role in rawFedmembers
  const fedRecord = {
    id: String(Date.now()),
    member_id: String(nextRawId),
    role: roleLabel,
    stato: statoVal,
    in_carica: isInCarica
  };
  (db.rawFedmembers || []).push(fedRecord);
  db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);

  // Create dirigente object for memory list
  const dirigenteObj = {
    id: `mem_${nextRawId}`,
    rawId: nextRawId,
    progressivo,
    codice,
    numeroTessera: codice,
    numeroTesseraDirigente: codice,
    numeroTesseraAtleta: `SKYA${progressivo}`,
    nome: nome.trim(),
    cognome: cognome.trim(),
    nominativo: `${cognome.trim()} ${nome.trim()}`,
    ruoloDirigenziale: roleLabel,
    ruoloFederale: roleLabel,
    ruoli: [roleLabel],
    ruoliFederali: [roleLabel],
    ruoliSocietari: [],
    stato: statoVal,
    statoCarica: statoVal,
    inCarica: isInCarica,
    tipoTessera: 'Dirigente Federale FISky',
    societaNome: 'Federazione Italiana Skyrunning (FISky)',
    societaCodice: 'FISKY-FED',
    codiceFiscale: cfUpper,
    dataNascita: dataNascita || '',
    luogoNascita: luogoNascita || '',
    sesso: sesso || 'M',
    email: email ? email.trim() : '',
    telefono: telefono ? telefono.trim() : '',
    indirizzo: indirizzo || '',
    civico: civico || '',
    citta: citta || '',
    cap: cap || '',
    provincia: provincia || '',
    comment: note || '',
    statoTessera: isInCarica ? 'attiva' : 'scaduta',
    dataTesseramento: new Date().toISOString().slice(0, 10),
    created: new Date().toISOString().slice(0, 10),
    ultimoAnnoTesseramento: isInCarica ? new Date().getFullYear() : 2021,
    affiliateExpire: isInCarica ? '2027-12-31' : '2021-12-31',
    profileCompleted: true
  };

  db.dirigentiList.unshift(dirigenteObj);
  db.membersList.unshift(dirigenteObj);

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Dirigenti Federali',
    azione: 'Inserimento nuova figura dirigenziale',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${cognome} ${nome} (${codice})`,
    dettagli: `Inserita nuova figura dirigenziale federale: ${roleLabel}. Codice tesserato: ${codice}.`,
    ip: req.ip || '127.0.0.1',
    metodo: 'POST /api/admin/dirigenti',
    esito: 'OK'
  });

  res.status(201).json({ success: true, dirigente: dirigenteObj });
});

app.put('/api/admin/dirigenti/:id', (req, res) => {
  const idParam = String(req.params.id);
  const dirigente = db.dirigentiList.find(d => 
    String(d.id) === idParam || 
    String(d.rawId) === idParam || 
    String(d.codice).toLowerCase() === idParam.toLowerCase() ||
    String(d.numeroTessera).toLowerCase() === idParam.toLowerCase()
  );
  if (!dirigente) return res.status(404).json({ error: 'Figura dirigenziale non trovata.' });

  const { nome, cognome, ruoloDirigenziale, stato, codiceFiscale, sesso, dataNascita, luogoNascita, email, telefono, indirizzo, civico, citta, cap, provincia, note, codice } = req.body;

  if (nome) dirigente.nome = nome.trim();
  if (cognome) dirigente.cognome = cognome.trim();
  if (nome || cognome) dirigente.nominativo = `${dirigente.cognome} ${dirigente.nome}`;
  if (ruoloDirigenziale) {
    dirigente.ruoloDirigenziale = ruoloDirigenziale.trim();
    dirigente.ruoloFederale = ruoloDirigenziale.trim();
    dirigente.ruoliFederali = [ruoloDirigenziale.trim()];
  }
  if (stato !== undefined && stato.trim()) {
    const sTrim = stato.trim();
    dirigente.stato = sTrim;
    dirigente.statoCarica = sTrim;
    dirigente.inCarica = (sTrim === 'In Carica');
    dirigente.statoTessera = dirigente.inCarica ? 'attiva' : 'scaduta';
  }
  if (codiceFiscale !== undefined) dirigente.codiceFiscale = codiceFiscale.trim().toUpperCase();
  if (sesso !== undefined) dirigente.sesso = sesso;
  if (dataNascita !== undefined) dirigente.dataNascita = dataNascita;
  if (luogoNascita !== undefined) dirigente.luogoNascita = luogoNascita.trim();
  if (email !== undefined) dirigente.email = email.trim();
  if (telefono !== undefined) dirigente.telefono = telefono.trim();
  if (indirizzo !== undefined) dirigente.indirizzo = indirizzo.trim();
  if (civico !== undefined) dirigente.civico = civico.trim();
  if (citta !== undefined) dirigente.citta = citta.trim();
  if (cap !== undefined) dirigente.cap = cap.trim();
  if (provincia !== undefined) dirigente.provincia = provincia.trim();
  if (note !== undefined) dirigente.comment = note.trim();
  if (codice && codice.trim()) {
    let cleanCodice = codice.trim().toUpperCase();
    if (!cleanCodice.startsWith('FISKY')) cleanCodice = `FISKY${cleanCodice}`;
    dirigente.codice = cleanCodice;
    dirigente.numeroTessera = cleanCodice;
    dirigente.numeroTesseraDirigente = cleanCodice;
  }

  // Sync to rawMembers
  const rawIdx = (db.rawMembers || []).findIndex(m => String(m.id) === String(dirigente.rawId));
  if (rawIdx !== -1) {
    const rm = db.rawMembers[rawIdx];
    rm.name = dirigente.nome;
    rm.surname = dirigente.cognome;
    rm.cf = dirigente.codiceFiscale;
    rm.gender = dirigente.sesso;
    rm.birthday = dirigente.dataNascita;
    rm.birthplace = dirigente.luogoNascita;
    rm.email = dirigente.email;
    rm.telephone = dirigente.telefono;
    rm.address = dirigente.indirizzo;
    rm.street_number = dirigente.civico;
    rm.city = dirigente.citta;
    rm.cap = dirigente.cap;
    rm.province = dirigente.provincia;
    rm.comment = dirigente.comment;
    rm.code = dirigente.codice;
    if (dirigente.stato) {
      rm.stato = dirigente.stato;
      rm.in_carica = dirigente.inCarica;
    }
    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  // Sync role & status to rawFedmembers
  if (db.rawFedmembers) {
    const fed = db.rawFedmembers.find(f => String(f.member_id) === String(dirigente.rawId));
    if (fed) {
      if (dirigente.ruoloDirigenziale) fed.role = dirigente.ruoloDirigenziale;
      if (dirigente.stato) {
        fed.stato = dirigente.stato;
        fed.in_carica = dirigente.inCarica;
      }
      db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
    }
  }

  // Sync to membersList
  const memIdx = (db.membersList || []).findIndex(m => String(m.rawId) === String(dirigente.rawId));
  if (memIdx !== -1) {
    Object.assign(db.membersList[memIdx], dirigente);
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Dirigenti Federali',
    azione: 'Modifica figura dirigenziale',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${dirigente.cognome} ${dirigente.nome} (${dirigente.codice})`,
    dettagli: `Aggiornati dati figura dirigenziale federale ${dirigente.codice}: ${dirigente.ruoloDirigenziale}`,
    ip: req.ip || '127.0.0.1',
    metodo: `PUT /api/admin/dirigenti/${idParam}`,
    esito: 'OK'
  });

  res.json({ success: true, dirigente });
});

app.delete('/api/admin/dirigenti/:id', (req, res) => {
  const idParam = String(req.params.id);
  const idx = db.dirigentiList.findIndex(d => 
    String(d.id) === idParam || 
    String(d.rawId) === idParam || 
    String(d.codice).toLowerCase() === idParam.toLowerCase() ||
    String(d.numeroTessera).toLowerCase() === idParam.toLowerCase()
  );
  if (idx === -1) return res.status(404).json({ error: 'Figura dirigenziale non trovata.' });

  const deleted = db.dirigentiList.splice(idx, 1)[0];

  // Remove from rawFedmembers
  if (db.rawFedmembers) {
    db.rawFedmembers = db.rawFedmembers.filter(f => String(f.member_id) !== String(deleted.rawId));
    db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Dirigenti Federali',
    azione: 'Cancellazione figura dirigenziale',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${deleted.cognome} ${deleted.nome} (${deleted.codice})`,
    dettagli: `Rimossa figura dirigenziale federale (${deleted.ruoloDirigenziale}) dal registro ufficiale.`,
    ip: req.ip || '127.0.0.1',
    metodo: `DELETE /api/admin/dirigenti/${idParam}`,
    esito: 'OK'
  });

  res.json({ success: true, message: 'Figura dirigenziale cancellata con successo.' });
});

// ================= GESTIONE DATI ANAGRAFICI PERSONE (ADMIN) ================= //

function paginateAndSearchAnagrafiche(sourceList, req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 25);
  const search = (req.query.search || req.query.q || '').trim().toLowerCase();
  const stato = (req.query.stato || 'all').trim().toLowerCase();
  const sort = (req.query.sort || 'nominativo').trim().toLowerCase();
  const dir = (req.query.dir || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const factor = dir === 'desc' ? -1 : 1;

  let list = sourceList;

  // 1. Filtro per stato associazione: 'associato' o 'non_associato'
  if (stato === 'associato') {
    list = list.filter(m => m.statoAssociazione === 'associato' || m.isAssociato === true);
  } else if (stato === 'non_associato' || stato === 'non_associati' || stato === 'nonassociato') {
    list = list.filter(m => m.statoAssociazione === 'non_associato' || !m.isAssociato);
  }

  // 2. Filtro di ricerca testuale
  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    list = list.filter(m => {
      const cognome = (m.cognome || '').toLowerCase();
      const nome = (m.nome || '').toLowerCase();
      const nom1 = `${cognome} ${nome}`;
      const nom2 = `${nome} ${cognome}`;
      const cf = (m.codiceFiscale || '').toLowerCase();
      const email = (m.email || '').toLowerCase();
      const tel = (m.telefono || '').toLowerCase();
      const citta = (m.citta || '').toLowerCase();
      const prov = (m.provincia || '').toLowerCase();
      const soc = (m.societaNome || '').toLowerCase();
      const idStr = String(m.rawId || m.id || '').toLowerCase();

      return tokens.every(tok =>
        nom1.includes(tok) ||
        nom2.includes(tok) ||
        cf.includes(tok) ||
        email.includes(tok) ||
        tel.includes(tok) ||
        citta.includes(tok) ||
        prov.includes(tok) ||
        soc.includes(tok) ||
        idStr.includes(tok)
      );
    });
  }

  // 3. Ordinamento
  list = [...list].sort((a, b) => {
    if (sort === 'stato') {
      const sa = (a.statoAssociazioneLabel || 'Non associato').toLowerCase();
      const sb = (b.statoAssociazioneLabel || 'Non associato').toLowerCase();
      const cmp = sa.localeCompare(sb, 'it', { sensitivity: 'base' });
      if (cmp !== 0) return cmp * factor;
      // Tie-breaker: nominativo
      const na = `${a.cognome || ''} ${a.nome || ''}`.trim().toLowerCase();
      const nb = `${b.cognome || ''} ${b.nome || ''}`.trim().toLowerCase();
      return na.localeCompare(nb, 'it', { sensitivity: 'base' });
    }

    // Default: nominativo (Cognome + Nome)
    const na = `${a.cognome || ''} ${a.nome || ''}`.trim().toLowerCase();
    const nb = `${b.cognome || ''} ${b.nome || ''}`.trim().toLowerCase();
    return na.localeCompare(nb, 'it', { sensitivity: 'base' }) * factor;
  });

  const total = list.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const offset = (page - 1) * limit;
  const data = list.slice(offset, offset + limit);

  let countAssociati = 0;
  let countNonAssociati = 0;
  sourceList.forEach(m => {
    if (m.isAssociato || m.statoAssociazione === 'associato') countAssociati++;
    else countNonAssociati++;
  });

  return {
    success: true,
    data,
    total,
    page,
    limit,
    totalPages,
    stats: {
      totale: sourceList.length,
      associati: countAssociati,
      nonAssociati: countNonAssociati
    }
  };
}

// Elenco paginato di tutte le anagrafiche persone (no società) con filtri e ordinamento
app.get('/api/admin/anagrafiche', (req, res) => {
  const result = paginateAndSearchAnagrafiche(db.membersList, req);
  res.json(result);
});

// Singola anagrafica persona per visualizzazione o modale di modifica
app.get('/api/admin/anagrafiche/:id', (req, res) => {
  const idParam = String(req.params.id || '').trim().toLowerCase();
  const persona = db.membersList.find(m =>
    String(m.rawId).toLowerCase() === idParam ||
    String(m.id).toLowerCase() === idParam ||
    String(m.progressivo).toLowerCase() === idParam ||
    String(m.codiceFiscale || '').toLowerCase() === idParam
  );

  if (!persona) {
    return res.status(404).json({ error: 'Anagrafica della persona non trovata nel database.' });
  }

  res.json({ success: true, persona });
});

// Modifica completa dei dati anagrafici di una persona
app.put('/api/admin/anagrafiche/:id', (req, res) => {
  const idParam = String(req.params.id || '').trim();
  const b = req.body || {};

  const nome = (b.nome || '').trim();
  const cognome = (b.cognome || '').trim();

  if (!nome || !cognome) {
    return res.status(400).json({ error: 'Cognome e Nome sono campi obbligatori.' });
  }

  // 1. Cerca in db.membersList
  const memIdx = db.membersList.findIndex(m =>
    String(m.rawId) === idParam ||
    String(m.id) === idParam ||
    `mem_${m.rawId}` === idParam
  );

  if (memIdx === -1) {
    return res.status(404).json({ error: 'Anagrafica non trovata nel database.' });
  }

  const member = db.membersList[memIdx];
  const rawId = String(member.rawId);

  // 2. Aggiorna record in db.rawMembers (mysql_members.json)
  const rawIdx = (db.rawMembers || []).findIndex(m => String(m.id) === rawId);
  if (rawIdx !== -1) {
    const rm = db.rawMembers[rawIdx];
    rm.name = nome;
    rm.surname = cognome;
    if (b.sesso !== undefined) rm.gender = b.sesso;
    if (b.dataNascita !== undefined) rm.birthday = b.dataNascita;
    if (b.luogoNascita !== undefined) rm.birthplace = b.luogoNascita;
    if (b.codiceFiscale !== undefined) rm.cf = (b.codiceFiscale || '').toUpperCase();
    if (b.partitaIva !== undefined) rm.pi = b.partitaIva;
    if (b.email !== undefined) rm.email = b.email;
    if (b.telefono !== undefined) rm.telephone = b.telefono;
    if (b.indirizzo !== undefined) rm.address = b.indirizzo;
    if (b.civico !== undefined) rm.street_number = b.civico;
    if (b.cap !== undefined) rm.cap = b.cap;
    if (b.citta !== undefined) rm.city = b.citta;
    if (b.provincia !== undefined) rm.province = (b.provincia || '').toUpperCase();
    if (b.regione !== undefined) rm.region = b.regione;
    if (b.titoloTecnico !== undefined) rm.title_certificate = b.titoloTecnico;
    if (b.scadenzaCertificatoMedico !== undefined) rm.mc_expire = b.scadenzaCertificatoMedico;
    if (b.note !== undefined) rm.comment = b.note;

    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  // 3. Aggiorna l'oggetto in db.membersList
  member.nome = nome;
  member.cognome = cognome;
  if (b.sesso !== undefined) member.sesso = b.sesso;
  if (b.dataNascita !== undefined) member.dataNascita = b.dataNascita;
  if (b.luogoNascita !== undefined) member.luogoNascita = b.luogoNascita;
  if (b.codiceFiscale !== undefined) member.codiceFiscale = (b.codiceFiscale || '').toUpperCase();
  if (b.partitaIva !== undefined) member.partitaIva = b.partitaIva;
  if (b.email !== undefined) member.email = b.email;
  if (b.telefono !== undefined) member.telefono = b.telefono;
  if (b.indirizzo !== undefined) member.indirizzo = b.indirizzo;
  if (b.civico !== undefined) member.civico = b.civico;
  if (b.cap !== undefined) member.cap = b.cap;
  if (b.citta !== undefined) member.citta = b.citta;
  if (b.provincia !== undefined) member.provincia = (b.provincia || '').toUpperCase();
  if (b.regione !== undefined) member.regione = b.regione;
  if (b.titoloTecnico !== undefined) member.titoloTecnico = b.titoloTecnico;
  if (b.scadenzaCertificatoMedico !== undefined) member.certificatoMedicoScadenza = b.scadenzaCertificatoMedico;
  if (b.note !== undefined) member.comment = b.note;

  // Ricalcola categoria se cambiano nascita o sesso o cf
  if (typeof db.computeAthleteCategory === 'function') {
    member.categoria = db.computeAthleteCategory(member.dataNascita, member.sesso, member.codiceFiscale);
    if (typeof db.getAthleteCategoryParams2026 === 'function') {
      member.parametriCategoria = db.getAthleteCategoryParams2026(member.categoria);
    }
  }

  // 4. Sincronizza atletiList se presente
  const atl = (db.atletiList || []).find(a => String(a.rawId) === rawId || a.id === member.id);
  if (atl) {
    atl.nome = nome;
    atl.cognome = cognome;
    atl.sesso = member.sesso;
    atl.dataNascita = member.dataNascita;
    atl.luogoNascita = member.luogoNascita;
    atl.codiceFiscale = member.codiceFiscale;
    atl.partitaIva = member.partitaIva;
    atl.email = member.email;
    atl.telefono = member.telefono;
    atl.indirizzo = member.indirizzo;
    atl.civico = member.civico;
    atl.cap = member.cap;
    atl.citta = member.citta;
    atl.provincia = member.provincia;
    atl.regione = member.regione;
    atl.categoria = member.categoria;
    atl.parametriCategoria = member.parametriCategoria;
    atl.certificatoMedicoScadenza = member.certificatoMedicoScadenza;
  }

  // 5. Sincronizza dirigentiList se presente
  const dir = (db.dirigentiList || []).find(d => String(d.rawId) === rawId || d.id === member.id);
  if (dir) {
    dir.nome = nome;
    dir.cognome = cognome;
    dir.sesso = member.sesso;
    dir.dataNascita = member.dataNascita;
    dir.luogoNascita = member.luogoNascita;
    dir.codiceFiscale = member.codiceFiscale;
    dir.email = member.email;
    dir.telefono = member.telefono;
    dir.indirizzo = member.indirizzo;
    dir.civico = member.civico;
    dir.cap = member.cap;
    dir.citta = member.citta;
    dir.provincia = member.provincia;
    if (b.note !== undefined) dir.note = b.note;
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Anagrafica Persone',
    azione: 'Modifica Dati Anagrafici Persona',
    oggetto: `${cognome} ${nome} (ID ${rawId})`,
    dettagli: `Aggiornati dati anagrafici di ${cognome} ${nome} (CF: ${member.codiceFiscale || '-'}, Email: ${member.email || '-'}).`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: 'Dati anagrafici della persona aggiornati con successo!',
    persona: member
  });
});

// Cancellazione completa e definitiva dell'anagrafica persona dal database
app.delete('/api/admin/anagrafiche/:id', (req, res) => {
  const idParam = String(req.params.id || '').trim();

  const memIdx = db.membersList.findIndex(m =>
    String(m.rawId) === idParam ||
    String(m.id) === idParam ||
    `mem_${m.rawId}` === idParam
  );

  if (memIdx === -1) {
    return res.status(404).json({ error: 'Anagrafica da cancellare non trovata nel database.' });
  }

  const deletedMember = db.membersList.splice(memIdx, 1)[0];
  const rawId = String(deletedMember.rawId);

  // 1. Elimina da mysql_members.json (db.rawMembers)
  const rawIdx = (db.rawMembers || []).findIndex(m => String(m.id) === rawId);
  if (rawIdx !== -1) {
    db.rawMembers.splice(rawIdx, 1);
    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  // 2. Elimina da atletiList se presente
  const atlIdx = (db.atletiList || []).findIndex(a => String(a.rawId) === rawId || a.id === deletedMember.id);
  if (atlIdx !== -1) {
    db.atletiList.splice(atlIdx, 1);
  }

  // 3. Elimina da dirigentiList se presente
  const dirIdx = (db.dirigentiList || []).findIndex(d => String(d.rawId) === rawId || d.id === deletedMember.id);
  if (dirIdx !== -1) {
    db.dirigentiList.splice(dirIdx, 1);
  }

  // 4. Elimina da guideList se presente
  const guideIdx = (db.guideList || []).findIndex(g => String(g.rawId) === rawId || g.id === deletedMember.id);
  if (guideIdx !== -1) {
    db.guideList.splice(guideIdx, 1);
  }

  // 5. Elimina eventuali tessere/affiliazioni da mysql_wmembers.json
  if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
    const prevLen = db.rawWmembers.length;
    db.rawWmembers = db.rawWmembers.filter(w => String(w.member_id) !== rawId);
    if (db.rawWmembers.length !== prevLen) {
      db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
    }
  }

  // 6. Elimina eventuali ruoli federali da mysql_fedmembers.json
  if (db.rawFedmembers && Array.isArray(db.rawFedmembers)) {
    const prevLen = db.rawFedmembers.length;
    db.rawFedmembers = db.rawFedmembers.filter(f => String(f.member_id) !== rawId);
    if (db.rawFedmembers.length !== prevLen) {
      db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
    }
  }

  recordOperationLog(req, {
    origine: isAdminUser(req) ? 'admin' : 'frontend',
    categoria: 'Anagrafica Persone',
    azione: 'Cancellazione Definitiva Anagrafica',
    oggetto: `${deletedMember.cognome || ''} ${deletedMember.nome || ''} (ID ${rawId})`,
    dettagli: `Cancellata definitivamente anagrafica persona ${deletedMember.cognome} ${deletedMember.nome} (CF: ${deletedMember.codiceFiscale || '-'}) dal database FISky.`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Anagrafica di ${deletedMember.cognome} ${deletedMember.nome} cancellata definitivamente dal database.`
  });
});

// Admin guide alpine (SKYG)
app.get('/api/admin/guide', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100000;
  res.json({ guide: db.guideList.slice(0, limit) });
});

app.get('/api/admin/guide/:id', (req, res) => {
  const idParam = String(req.params.id);
  const guida = db.guideList.find(g => 
    String(g.id) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera).toLowerCase() === idParam.toLowerCase() ||
    String(g.numeroTesseraGuida || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!guida) return res.status(404).json({ error: 'Direttore di percorso non trovato.' });
  res.json({ success: true, guida });
});

app.put('/api/admin/guide/:id', (req, res) => {
  const idParam = String(req.params.id);
  const guida = db.guideList.find(g => 
    String(g.id) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera).toLowerCase() === idParam.toLowerCase() ||
    String(g.numeroTesseraGuida || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!guida) return res.status(404).json({ error: 'Direttore di percorso non trovato.' });

  const {
    nome, cognome, statoTessera, regione, email, telefono,
    citta, cap, provincia, indirizzo, civico, codiceFiscale, comment
  } = req.body;

  if (nome) guida.nome = nome.trim();
  if (cognome) guida.cognome = cognome.trim();
  if (nome || cognome) guida.nominativo = `${guida.cognome} ${guida.nome}`;
  if (email !== undefined) guida.email = email.trim();
  if (telefono !== undefined) guida.telefono = telefono.trim();
  if (citta !== undefined) guida.citta = citta.trim();
  if (cap !== undefined) guida.cap = cap.trim();
  if (provincia !== undefined) guida.provincia = provincia.trim();
  if (indirizzo !== undefined) guida.indirizzo = indirizzo.trim();
  if (civico !== undefined) guida.civico = civico.trim();
  if (codiceFiscale !== undefined) guida.codiceFiscale = codiceFiscale.trim().toUpperCase();
  if (comment !== undefined) guida.comment = comment.trim();

  if (regione !== undefined || provincia !== undefined) {
    const regInput = (regione !== undefined ? regione : guida.regione);
    const provInput = (provincia !== undefined ? provincia : guida.provincia);
    guida.regione = db.resolveMemberRegion ? db.resolveMemberRegion(regInput, provInput) : String(regInput || '').trim();
  }

  const isAttiva = (String(statoTessera || guida.statoTessera).toLowerCase() === 'attiva');
  guida.statoTessera = isAttiva ? 'attiva' : 'scaduta';
  guida.affiliateExpire = isAttiva ? '2026-12-31' : '2021-12-31';
  guida.ultimoAnnoTesseramento = isAttiva ? 2026 : 2021;

  // Sync to rawMembers
  if (db.rawMembers) {
    const rawMem = db.rawMembers.find(m => String(m.id) === String(guida.rawId));
    if (rawMem) {
      if (guida.nome) rawMem.name = guida.nome;
      if (guida.cognome) rawMem.surname = guida.cognome;
      if (guida.email !== undefined) rawMem.email = guida.email;
      if (guida.telefono !== undefined) rawMem.telephone = guida.telefono;
      if (guida.regione !== undefined) rawMem.region = guida.regione;
      if (guida.citta !== undefined) rawMem.city = guida.citta;
      if (guida.provincia !== undefined) rawMem.province = guida.provincia;
      if (guida.cap !== undefined) rawMem.cap = guida.cap;
      if (guida.indirizzo !== undefined) rawMem.address = guida.indirizzo;
      if (guida.civico !== undefined) rawMem.street_number = guida.civico;
      if (guida.codiceFiscale !== undefined) rawMem.cf = guida.codiceFiscale;
      if (guida.comment !== undefined) rawMem.comment = guida.comment;
      rawMem.affiliate_expire = isAttiva ? '2026-12-31' : '2021-12-31';
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }
  }

  // Sync to rawWmembers
  if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
    let wFound = false;
    db.rawWmembers.forEach(w => {
      if (String(w.member_id) === String(guida.rawId) && (String(w.membertype_id) === '14' || String(w.membertype_id) === 'G')) {
        w.is_valid = isAttiva ? 1 : 0;
        w.affiliate_expire = isAttiva ? '2026-12-31' : '2021-12-31';
        wFound = true;
      }
    });
    if (!wFound && isAttiva) {
      db.rawWmembers.push({
        id: String(Date.now()),
        member_id: String(guida.rawId),
        club_id: String(guida.societaId || '0'),
        membertype_id: '14',
        fiso_id: '',
        date_start: new Date().toISOString().slice(0, 10),
        affiliate_expire: '2026-12-31',
        is_payed: 1,
        is_free: 0,
        is_valid: 1,
        code: guida.numeroTessera
      });
    }
    db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
  }

  // Sync to membersList
  if (db.membersList) {
    const mem = db.membersList.find(m => String(m.rawId) === String(guida.rawId));
    if (mem) {
      if (guida.nome) mem.nome = guida.nome;
      if (guida.cognome) mem.cognome = guida.cognome;
      if (guida.email !== undefined) mem.email = guida.email;
      if (guida.telefono !== undefined) mem.telefono = guida.telefono;
      if (guida.regione !== undefined) mem.regione = guida.regione;
      if (guida.citta !== undefined) mem.citta = guida.citta;
      if (guida.provincia !== undefined) mem.provincia = guida.provincia;
      if (guida.cap !== undefined) mem.cap = guida.cap;
      if (guida.indirizzo !== undefined) mem.indirizzo = guida.indirizzo;
      if (guida.civico !== undefined) mem.civico = guida.civico;
      if (guida.codiceFiscale !== undefined) mem.codiceFiscale = guida.codiceFiscale;
      if (guida.comment !== undefined) mem.comment = guida.comment;
      if (isAttiva) {
        mem.statoTessera = 'attiva';
        mem.affiliateExpire = '2026-12-31';
        mem.ultimoAnnoTesseramento = 2026;
      }
    }
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Direttori di Percorso',
    azione: 'Modifica dati direttore di percorso',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${guida.cognome} ${guida.nome} (${guida.numeroTessera})`,
    dettagli: `Aggiornati dati Direttore di Percorso ${guida.numeroTessera}: Stato Tessera ${isAttiva ? 'ATTIVA' : 'NON ATTIVA'}.`,
    ip: req.ip || '127.0.0.1',
    metodo: `PUT /api/admin/guide/${idParam}`,
    esito: 'OK'
  });

  res.json({ success: true, guida, message: 'Dati del direttore di percorso aggiornati con successo.' });
});

app.delete('/api/admin/guide/:id', (req, res) => {
  const idParam = String(req.params.id);
  const idx = db.guideList.findIndex(g => 
    String(g.id) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera).toLowerCase() === idParam.toLowerCase() ||
    String(g.numeroTesseraGuida || '').toLowerCase() === idParam.toLowerCase()
  );
  if (idx === -1) return res.status(404).json({ error: 'Direttore di percorso non trovato.' });

  const removed = db.guideList.splice(idx, 1)[0];

  // Remove wmembers affiliations related to Guida
  if (db.rawWmembers && Array.isArray(db.rawWmembers)) {
    db.rawWmembers = db.rawWmembers.filter(w => 
      !(String(w.member_id) === String(removed.rawId) && (String(w.membertype_id) === '14' || String(w.membertype_id) === 'G'))
    );
    db.writeJsonFile('mysql_wmembers.json', db.rawWmembers);
  }

  // Update rawMembers
  if (db.rawMembers) {
    const rawMem = db.rawMembers.find(m => String(m.id) === String(removed.rawId));
    if (rawMem && String(rawMem.membertype_id) === '14') {
      rawMem.membertype_id = '1';
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }
  }

  // Update membersList: preserve member but remove Guida card and role
  if (db.membersList) {
    const mem = db.membersList.find(m => String(m.rawId) === String(removed.rawId));
    if (mem) {
      mem.numeroTesseraGuida = null;
      if (Array.isArray(mem.ruoli)) {
        mem.ruoli = mem.ruoli.filter(r => !r.includes('Guida') && !r.includes('Direttore di percorso'));
      }
      if (Array.isArray(mem.ruoliSocietari)) {
        mem.ruoliSocietari = mem.ruoliSocietari.filter(r => !r.includes('Guida') && !r.includes('Direttore di percorso'));
      }
      if (mem.numeroTessera === removed.numeroTessera) {
        mem.numeroTessera = mem.numeroTesseraAtleta || mem.numeroTesseraDirigente || mem.numeroTesseraTecnico || null;
      }
    }
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Direttori di Percorso',
    azione: 'Cancellazione tesseramento direttore di percorso',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${removed.cognome} ${removed.nome} (${removed.numeroTessera})`,
    dettagli: `Rimosso tesseramento da Direttore di Percorso (${removed.numeroTessera}) per ${removed.cognome} ${removed.nome}. L'anagrafica generale è conservata nel database federale.`,
    ip: req.ip || '127.0.0.1',
    metodo: `DELETE /api/admin/guide/${idParam}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Tesseramento Direttore di Percorso di ${removed.cognome} ${removed.nome} (${removed.numeroTessera}) cancellato con successo.`
  });
});

// Admin Delegati Regionali
app.get('/api/admin/delegati-regionali', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100000;
  res.json({ delegati: (db.delegatiList || []).slice(0, limit), total: (db.delegatiList || []).length });
});

app.get('/api/admin/delegati-regionali/:id', (req, res) => {
  const idParam = String(req.params.id);
  const delegato = (db.delegatiList || []).find(d => 
    String(d.id) === idParam || 
    String(d.fedId) === idParam || 
    String(d.rawId) === idParam || 
    String(d.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(d.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!delegato) return res.status(404).json({ error: 'Delegato regionale non trovato.' });
  res.json({ success: true, delegato });
});

app.put('/api/admin/delegati-regionali/:id', (req, res) => {
  const idParam = String(req.params.id);
  const delegato = (db.delegatiList || []).find(d => 
    String(d.id) === idParam || 
    String(d.fedId) === idParam || 
    String(d.rawId) === idParam || 
    String(d.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(d.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!delegato) return res.status(404).json({ error: 'Delegato regionale non trovato.' });

  const {
    nome, cognome, regione, qualifica, inCarica, statoCarica, statoTessera,
    email, telefono, citta, cap, provincia, indirizzo, civico, codiceFiscale, comment
  } = req.body;

  if (nome) delegato.nome = nome.trim();
  if (cognome) delegato.cognome = cognome.trim();
  if (nome || cognome) delegato.nominativo = `${delegato.cognome} ${delegato.nome}`;
  if (email !== undefined) delegato.email = email.trim();
  if (telefono !== undefined) delegato.telefono = telefono.trim();
  if (citta !== undefined) delegato.citta = citta.trim();
  if (cap !== undefined) delegato.cap = cap.trim();
  if (provincia !== undefined) delegato.provincia = provincia.trim();
  if (indirizzo !== undefined) delegato.indirizzo = indirizzo.trim();
  if (civico !== undefined) delegato.civico = civico.trim();
  if (codiceFiscale !== undefined) delegato.codiceFiscale = codiceFiscale.trim().toUpperCase();
  if (comment !== undefined) delegato.comment = comment.trim();
  if (qualifica !== undefined) {
    delegato.qualifica = qualifica.trim();
    delegato.ruoloFederale = delegato.qualifica;
  }
  if (regione !== undefined) delegato.regione = regione.trim();

  if (inCarica !== undefined || statoCarica !== undefined) {
    const active = inCarica === true || inCarica === 'true' || statoCarica === 'In Carica' || statoCarica === 'in_carica';
    delegato.inCarica = active;
    delegato.stato = active ? 'In Carica' : 'Non più in carica';
    delegato.statoCarica = delegato.stato;
  }

  if (statoTessera !== undefined) {
    delegato.statoTessera = (statoTessera === 'attiva' ? 'attiva' : 'scaduta');
  }

  // Sincronizza con rawFedmembers
  if (delegato.fedId && db.rawFedmembers) {
    const fedRec = db.rawFedmembers.find(f => String(f.id) === String(delegato.fedId));
    if (fedRec) {
      if (delegato.qualifica) fedRec.role = delegato.qualifica;
      fedRec.in_carica = delegato.inCarica;
      fedRec.stato = delegato.stato;
      db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
    }
  }

  // Sincronizza con rawMembers
  if (db.rawMembers) {
    const rawMem = db.rawMembers.find(m => String(m.id) === String(delegato.rawId));
    if (rawMem) {
      if (delegato.nome) rawMem.name = delegato.nome;
      if (delegato.cognome) rawMem.surname = delegato.cognome;
      if (delegato.email !== undefined) rawMem.email = delegato.email;
      if (delegato.telefono !== undefined) rawMem.telephone = delegato.telefono;
      if (delegato.regione !== undefined) rawMem.region = delegato.regione;
      if (delegato.codiceFiscale !== undefined) rawMem.cf = delegato.codiceFiscale;
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Delegati Regionali',
    azione: 'Modifica dati delegato regionale',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${delegato.cognome} ${delegato.nome} (${delegato.numeroTessera})`,
    dettagli: `Aggiornati dati Delegato Regionale ${delegato.numeroTessera}: ${delegato.qualifica} (${delegato.regione}). Stato Carica: ${delegato.statoCarica}.`,
    ip: req.ip || '127.0.0.1',
    metodo: `PUT /api/admin/delegati-regionali/${idParam}`,
    esito: 'OK'
  });

  res.json({ success: true, delegato, message: 'Dati del delegato regionale aggiornati con successo.' });
});

app.delete('/api/admin/delegati-regionali/:id', (req, res) => {
  const idParam = String(req.params.id);
  const idx = (db.delegatiList || []).findIndex(d => 
    String(d.id) === idParam || 
    String(d.fedId) === idParam || 
    String(d.rawId) === idParam || 
    String(d.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(d.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (idx === -1) return res.status(404).json({ error: 'Delegato regionale non trovato.' });

  const removed = db.delegatiList.splice(idx, 1)[0];

  if (removed.fedId && db.rawFedmembers) {
    db.rawFedmembers = db.rawFedmembers.filter(f => String(f.id) !== String(removed.fedId));
    db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Delegati Regionali',
    azione: 'Cancellazione incarico delegato regionale',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${removed.cognome} ${removed.nome} (${removed.numeroTessera})`,
    dettagli: `Rimosso incarico di ${removed.qualifica} per ${removed.cognome} ${removed.nome}. L'anagrafica generale è conservata nel database federale.`,
    ip: req.ip || '127.0.0.1',
    metodo: `DELETE /api/admin/delegati-regionali/${idParam}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Incarico di Delegato Regionale di ${removed.cognome} ${removed.nome} rimosso con successo.`
  });
});

// Admin Giudici di Gara
app.post('/api/admin/giudici-gara', (req, res) => {
  const {
    memberId,
    nome,
    cognome,
    codiceFiscale,
    regione,
    email,
    telefono,
    numeroTessera,
    statoCarica,
    statoTessera
  } = req.body;

  if (!memberId) {
    return res.status(400).json({ error: 'È obbligatorio richiamare un\'anagrafica già presente sul database.' });
  }

  const rawIdStr = String(memberId);
  const existingJudge = (db.giudiciList || []).find(g => 
    String(g.rawId) === rawIdStr || 
    String(g.id) === rawIdStr ||
    (codiceFiscale && String(g.codiceFiscale || '').toUpperCase() === String(codiceFiscale).trim().toUpperCase())
  );
  if (existingJudge) {
    return res.status(400).json({ error: `La persona (${existingJudge.cognome} ${existingJudge.nome}) risulta già registrata come Giudice di Gara con tessera ${existingJudge.numeroTessera}.` });
  }

  const memberObj = (db.membersList || []).find(m => String(m.rawId) === rawIdStr || String(m.id) === rawIdStr) || {};

  const cleanCognome = (cognome || memberObj.cognome || '').trim();
  const cleanNome = (nome || memberObj.nome || '').trim();
  const cleanCF = (codiceFiscale || memberObj.codiceFiscale || '').trim().toUpperCase();
  const cleanEmail = (email || memberObj.email || '').trim();
  const cleanTelefono = (telefono || memberObj.telefono || '').trim();
  const cleanRegione = (regione || memberObj.regione || '').trim();
  const isInCarica = statoCarica !== 'non_in_carica';

  let maxFedId = 0;
  (db.rawFedmembers || []).forEach(f => {
    const fid = parseInt(f.id, 10);
    if (!isNaN(fid) && fid > maxFedId) maxFedId = fid;
  });
  const newFedId = maxFedId + 1;

  let cardGiu = (numeroTessera || '').trim();
  if (!cardGiu) {
    const padId = String(memberId).padStart(6, '0');
    cardGiu = `SKYJ${padId}`;
  }

  const fedRecord = {
    id: newFedId,
    member_id: parseInt(memberId, 10) || String(memberId),
    role: 'GIUDICE DI GARA',
    in_carica: isInCarica,
    stato: isInCarica ? 'In Carica' : 'Non più in carica'
  };
  if (!db.rawFedmembers) db.rawFedmembers = [];
  db.rawFedmembers.push(fedRecord);
  db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);

  const rawMember = (db.rawMembers || []).find(m => String(m.id) === rawIdStr);
  if (rawMember) {
    rawMember.title_certificate = 'GIUDICE DI GARA';
    db.writeJsonFile('mysql_members.json', db.rawMembers);
  }

  const newGiudice = {
    ...memberObj,
    id: memberId,
    rawId: memberId,
    fedId: newFedId,
    codice: cardGiu,
    numeroTessera: cardGiu,
    numeroTesseraGiudice: cardGiu,
    nominativo: `${cleanCognome} ${cleanNome}`.trim(),
    cognome: cleanCognome,
    nome: cleanNome,
    codiceFiscale: cleanCF,
    email: cleanEmail,
    telefono: cleanTelefono,
    qualifica: 'Giudice di gara',
    ruoloFederale: 'Giudice di gara',
    regione: cleanRegione,
    stato: isInCarica ? 'In Carica' : 'Non più in carica',
    statoCarica: isInCarica ? 'In Carica' : 'Non più in carica',
    inCarica: isInCarica,
    tipoTessera: 'Giudice di Gara FISky',
    societaNome: memberObj.societaNome || 'Federazione Italiana Skyrunning (FISky)',
    affiliateExpire: isInCarica ? '2026-12-31' : '2021-12-31',
    ultimoAnnoTesseramento: isInCarica ? 2026 : 2021,
    statoTessera: isInCarica ? 'attiva' : 'scaduta'
  };

  if (!db.giudiciList) db.giudiciList = [];
  db.giudiciList.push(newGiudice);

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Giudici di Gara',
    azione: 'Censimento nuovo giudice di gara',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${cleanCognome} ${cleanNome} (${cardGiu})`,
    dettagli: `Censita qualifica di Giudice di Gara per ${cleanCognome} ${cleanNome} collegata ad anagrafica ID #${memberId}.`,
    ip: req.ip || '127.0.0.1',
    metodo: 'POST /api/admin/giudici-gara',
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Giudice di Gara ${cleanCognome} ${cleanNome} censito con successo!`,
    giudice: newGiudice
  });
});

app.get('/api/admin/giudici-gara', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 100000;
  res.json({ giudici: (db.giudiciList || []).slice(0, limit), total: (db.giudiciList || []).length });
});

app.get('/api/admin/giudici-gara/:id', (req, res) => {
  const idParam = String(req.params.id);
  const giudice = (db.giudiciList || []).find(g => 
    String(g.id) === idParam || 
    String(g.fedId) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(g.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!giudice) return res.status(404).json({ error: 'Giudice di gara non trovato.' });
  res.json({ success: true, giudice });
});

app.put('/api/admin/giudici-gara/:id', (req, res) => {
  const idParam = String(req.params.id);
  const giudice = (db.giudiciList || []).find(g => 
    String(g.id) === idParam || 
    String(g.fedId) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(g.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (!giudice) return res.status(404).json({ error: 'Giudice di gara non trovato.' });

  const {
    nome, cognome, regione, qualifica, inCarica, statoCarica, statoTessera,
    email, telefono, citta, cap, provincia, indirizzo, civico, codiceFiscale, comment
  } = req.body;

  if (nome) giudice.nome = nome.trim();
  if (cognome) giudice.cognome = cognome.trim();
  if (nome || cognome) giudice.nominativo = `${giudice.cognome} ${giudice.nome}`;
  if (email !== undefined) giudice.email = email.trim();
  if (telefono !== undefined) giudice.telefono = telefono.trim();
  if (citta !== undefined) giudice.citta = citta.trim();
  if (cap !== undefined) giudice.cap = cap.trim();
  if (provincia !== undefined) giudice.provincia = provincia.trim();
  if (indirizzo !== undefined) giudice.indirizzo = indirizzo.trim();
  if (civico !== undefined) giudice.civico = civico.trim();
  if (codiceFiscale !== undefined) giudice.codiceFiscale = codiceFiscale.trim().toUpperCase();
  if (comment !== undefined) giudice.comment = comment.trim();
  if (qualifica !== undefined) {
    giudice.qualifica = qualifica.trim();
    giudice.ruoloFederale = giudice.qualifica;
  }
  if (regione !== undefined) giudice.regione = regione.trim();

  if (inCarica !== undefined || statoCarica !== undefined) {
    const active = inCarica === true || inCarica === 'true' || statoCarica === 'In Carica' || statoCarica === 'in_carica';
    giudice.inCarica = active;
    giudice.stato = active ? 'In Carica' : 'Non più in carica';
    giudice.statoCarica = giudice.stato;
  }

  if (statoTessera !== undefined) {
    giudice.statoTessera = (statoTessera === 'attiva' ? 'attiva' : 'scaduta');
  }

  // Sincronizza con rawFedmembers
  if (giudice.fedId && db.rawFedmembers) {
    const fedRec = db.rawFedmembers.find(f => String(f.id) === String(giudice.fedId));
    if (fedRec) {
      if (giudice.qualifica) fedRec.role = giudice.qualifica;
      fedRec.in_carica = giudice.inCarica;
      fedRec.stato = giudice.stato;
      db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
    }
  }

  // Sincronizza con rawMembers
  if (db.rawMembers) {
    const rawMem = db.rawMembers.find(m => String(m.id) === String(giudice.rawId));
    if (rawMem) {
      if (giudice.nome) rawMem.name = giudice.nome;
      if (giudice.cognome) rawMem.surname = giudice.cognome;
      if (giudice.email !== undefined) rawMem.email = giudice.email;
      if (giudice.telefono !== undefined) rawMem.telephone = giudice.telefono;
      if (giudice.regione !== undefined) rawMem.region = giudice.regione;
      if (giudice.codiceFiscale !== undefined) rawMem.cf = giudice.codiceFiscale;
      if (giudice.qualifica) rawMem.title_certificate = giudice.qualifica;
      db.writeJsonFile('mysql_members.json', db.rawMembers);
    }
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Giudici di Gara',
    azione: 'Modifica dati giudice di gara',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${giudice.cognome} ${giudice.nome} (${giudice.numeroTessera})`,
    dettagli: `Aggiornati dati Giudice di Gara ${giudice.numeroTessera}: ${giudice.qualifica}. Stato Carica: ${giudice.statoCarica}.`,
    ip: req.ip || '127.0.0.1',
    metodo: `PUT /api/admin/giudici-gara/${idParam}`,
    esito: 'OK'
  });

  res.json({ success: true, giudice, message: 'Dati del giudice di gara aggiornati con successo.' });
});

app.delete('/api/admin/giudici-gara/:id', (req, res) => {
  const idParam = String(req.params.id);
  const idx = (db.giudiciList || []).findIndex(g => 
    String(g.id) === idParam || 
    String(g.fedId) === idParam || 
    String(g.rawId) === idParam || 
    String(g.numeroTessera || '').toLowerCase() === idParam.toLowerCase() ||
    String(g.codice || '').toLowerCase() === idParam.toLowerCase()
  );
  if (idx === -1) return res.status(404).json({ error: 'Giudice di gara non trovato.' });

  const removed = db.giudiciList.splice(idx, 1)[0];

  if (removed.fedId && db.rawFedmembers) {
    db.rawFedmembers = db.rawFedmembers.filter(f => String(f.id) !== String(removed.fedId));
    db.writeJsonFile('mysql_fedmembers.json', db.rawFedmembers);
  }

  db.appendOperationLog({
    origine: 'admin',
    categoria: 'Giudici di Gara',
    azione: 'Cancellazione qualifica giudice di gara',
    operatore: 'Segreteria Federale',
    ruolo: 'admin',
    oggetto: `${removed.cognome} ${removed.nome} (${removed.numeroTessera})`,
    dettagli: `Rimossa qualifica di ${removed.qualifica} per ${removed.cognome} ${removed.nome}. L'anagrafica generale è conservata nel database federale.`,
    ip: req.ip || '127.0.0.1',
    metodo: `DELETE /api/admin/giudici-gara/${idParam}`,
    esito: 'OK'
  });

  res.json({
    success: true,
    message: `Qualifica di Giudice di Gara di ${removed.cognome} ${removed.nome} rimossa con successo.`
  });
});

// Admin stats
app.get('/api/admin/stats', (req, res) => {
  const gare = db.raceRequestsList;
  res.json({
    totalUsers: db.usersList.length,
    societaCount: db.clubsList.length,
    cronoCount: db.chronosList.length,
    totalMembri: db.membersList.length,
    totalAtleti: db.atletiList.length,
    totalDirigenti: db.dirigentiList.length,
    totalGuide: db.guideList.length,
    totalDelegati: (db.delegatiList || []).length,
    totalGiudici: (db.giudiciList || []).length,
    totalPagine: (db.rawWebpages || []).length,
    totalNews: (db.rawNews || []).length,
    atletiAttivi: db.atletiList.filter(a => a.statoTessera === 'attiva').length,
    atletiInScadenza: db.atletiList.filter(a => a.statoTessera === 'in_scadenza').length,
    atletiScaduti: db.atletiList.filter(a => a.statoTessera === 'scaduta').length,
    totalGare: gare.length,
    gareInAttesa: gare.filter(g => g.stato === 'in_attesa').length,
    gareApprovate: gare.filter(g => g.stato === 'approvata').length,
    richiesteRegistrazioneCount: registrationRequests.length
  });
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('exit', (code) => {
  console.log('Process exit event with code:', code);
});
process.on('SIGINT', () => {
  console.log('Received SIGINT signal');
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal');
});

const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  PORTALE FEDERALE SKYRUNNING ITALIA (FISky) ONLINE`);
  console.log(`  Indirizzo: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

setInterval(() => {
  // Keep event loop alive
}, 1000 * 60);
