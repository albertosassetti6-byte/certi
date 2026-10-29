/* =========================================================
   CertiProof — logica applicativa
   ========================================================= */

/* ---------- Router (hash) ---------- */
const ROUTES = ['home', 'faq', 'contatti', 'privacy', 'terms', 'disclaimer'];
const pages  = document.querySelectorAll('[data-page]');
const navLinks = document.querySelectorAll('.nav-links a');
const navToggle = document.getElementById('navToggle');
const navLinksBox = document.getElementById('navLinks');

function currentRoute() {
  const h = (location.hash || '#home').replace('#', '');
  return ROUTES.includes(h) ? h : 'home';
}

function showPage(route) {
  pages.forEach(p => {
    const isActive = p.dataset.page === route;
    p.hidden = !isActive;
    if (isActive) {
      p.style.animation = 'none';
      void p.offsetWidth;
      p.style.animation = '';
    }
  });

  navLinks.forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  navLinksBox.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

window.addEventListener('hashchange', () => showPage(currentRoute()));

/* ---------- Nav toggle mobile ---------- */
navToggle.addEventListener('click', () => {
  const open = navLinksBox.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});

/* ---------- Criteri di autenticità ---------- */
const CRITERIA = [
  { id: 'provenienza',   label: 'Provenienza documentata',    short: 'Provenienza', weight: 0.25, value: 75 },
  { id: 'materiali',     label: 'Materiali e tecnica',        short: 'Materiali',   weight: 0.20, value: 75 },
  { id: 'stile',         label: 'Coerenza stilistica',        short: 'Stile',       weight: 0.15, value: 75 },
  { id: 'documenti',     label: 'Documentazione fotografica', short: 'Documenti',   weight: 0.15, value: 75 },
  { id: 'conservazione', label: 'Stato di conservazione',     short: 'Conservaz.',  weight: 0.15, value: 75 },
  { id: 'perizia',       label: 'Perizia di esperti',         short: 'Perizia',     weight: 0.10, value: 75 }
];

/* ---------- DOM ---------- */
const form         = document.getElementById('certForm');
const slidersBox   = document.getElementById('sliders');
const emptyState   = document.getElementById('emptyState');
const certificate  = document.getElementById('certificate');
const certDetails  = document.getElementById('certDetails');
const scoreValue   = document.getElementById('scoreValue');
const scoreLabel   = document.getElementById('scoreLabel');
const certHash     = document.getElementById('certHash');
const copyBtn      = document.getElementById('copyBtn');
const printBtn     = document.getElementById('printBtn');
const canvas       = document.getElementById('certChart');
const contactForm  = document.getElementById('contactForm');
const contactOk    = document.getElementById('contactOk');
const descEl       = document.getElementById('descrizione');
const descCounter  = document.getElementById('descCounter');
const resetBtn     = document.getElementById('resetBtn');
const backToTopBtn = document.getElementById('backToTop');

/* Foto */
const fotoInput      = document.getElementById('foto');
const photoPreview   = document.getElementById('photoPreview');
const photoPreviewImg= document.getElementById('photoPreviewImg');
const removePhotoBtn = document.getElementById('removePhotoBtn');
const certPhotoWrap  = document.getElementById('certPhotoWrap');
const certPhotoImg   = document.getElementById('certPhoto');

/* Toast */
const toastEl    = document.getElementById('certToast');
const toastTitleEl = document.getElementById('toastTitle');
const toastCatEl = document.getElementById('toastCat');

/* =========================================================
   CONFIGURAZIONE PAGAMENTO (TEST)
   ========================================================= */
const PAYMENT_LINK   = 'https://buy.stripe.com/test_14A3cw2pOfGvgA9cHi48000';
const PAYMENT_KEY    = 'certiproof_paid';
const FORM_STATE_KEY = 'certiproof_form_state';

/* Stato pagamento */
let isPaid = sessionStorage.getItem(PAYMENT_KEY) === '1';

const MAX_WORDS = 200;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

let chart = null;
let certTimestamp = null;
let hashTimer = null;
let currentPhoto = null;

/* =========================================================
   PERSISTENZA STATO FORM (prima del redirect a Stripe)
   ========================================================= */
function saveFormState() {
  const state = {
    nome:         document.getElementById('nome').value,
    autore:       document.getElementById('autore').value,
    proprietario: document.getElementById('proprietario').value,
    data:         document.getElementById('data').value,
    categoria:    document.getElementById('categoria').value,
    descrizione:  document.getElementById('descrizione').value,
    scores:       CRITERIA.map(c => {
      const el = document.getElementById('slider-' + c.id);
      return el ? Number(el.value) : c.value;
    }),
    photo: currentPhoto
  };

  try {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    /* Quota superata: prova senza immagine */
    try {
      state.photo = null;
      sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
    } catch (e2) {
      sessionStorage.removeItem(FORM_STATE_KEY);
    }
  }
}

function restoreFormState() {
  let raw;
  try { raw = sessionStorage.getItem(FORM_STATE_KEY); }
  catch (e) { return false; }

  if (!raw) return false;

  let s;
  try { s = JSON.parse(raw); }
  catch (e) { return false; }

  try {
    if (s.nome !== undefined)         document.getElementById('nome').value = s.nome;
    if (s.autore !== undefined)       document.getElementById('autore').value = s.autore;
    if (s.proprietario !== undefined) document.getElementById('proprietario').value = s.proprietario;
    if (s.data !== undefined)         document.getElementById('data').value = s.data;
    if (s.categoria !== undefined)    document.getElementById('categoria').value = s.categoria;
    if (s.descrizione !== undefined)  document.getElementById('descrizione').value = s.descrizione;

    if (Array.isArray(s.scores)) {
      CRITERIA.forEach((c, i) => {
        const el  = document.getElementById('slider-' + c.id);
        const out = document.getElementById('out-' + c.id);
        const v   = s.scores[i];
        if (el && v !== undefined) {
          el.value = v;
          paintRange(el);
        }
        if (out) out.textContent = v !== undefined ? v : c.value;
      });
    }

    if (s.photo && s.photo.dataUrl) {
      currentPhoto = s.photo;
    }
    renderPhotoPreview();
    updateWordCounter();

    sessionStorage.removeItem(FORM_STATE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/* =========================================================
   RILEVAMENTO RITORNO DA STRIPE
   ========================================================= */
function detectStripeReturn() {
  const params = new URLSearchParams(location.search);
  const paidKeys = ['session_id', 'checkout', 'payment', 'payment_intent', 'success'];
  const paid = paidKeys.some(k => params.has(k));

  if (!paid) return false;

  isPaid = true;
  sessionStorage.setItem(PAYMENT_KEY, '1');

  /* Pulisci l'URL */
  if (window.history && window.history.replaceState) {
    const cleanUrl = location.pathname + location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  return true;
}

/* =========================================================
   1. Sliders dinamici
   ========================================================= */
function buildSliders() {
  if (!slidersBox || slidersBox.children.length) return;
  const frag = document.createDocumentFragment();

  CRITERIA.forEach(c => {
    const row = document.createElement('div');
    row.className = 'slider-row';

    const label = document.createElement('label');
    label.setAttribute('for', 'slider-' + c.id);
    label.innerHTML = `<span>${c.label}</span>`;

    const out = document.createElement('output');
    out.id = 'out-' + c.id;
    out.textContent = c.value;
    label.appendChild(out);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(c.value);
    input.id = 'slider-' + c.id;
    input.dataset.criterion = c.id;

    paintRange(input);

    input.addEventListener('input', () => {
      out.textContent = input.value;
      paintRange(input);
      if (certTimestamp) scheduleUpdate();
    });

    row.append(label, input);
    frag.appendChild(row);
  });

  slidersBox.appendChild(frag);
}

function paintRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', pct + '%');
}

/* =========================================================
   2. Contatore parole descrizione (max 200)
   ========================================================= */
function countWords(str) {
  const t = str.trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

function updateWordCounter() {
  if (!descEl || !descCounter) return;
  const n = countWords(descEl.value);
  descCounter.textContent = `${n} / ${MAX_WORDS} parole`;
  descCounter.classList.toggle('over', n > MAX_WORDS);
}

function enforceWordLimit() {
  if (!descEl) return;
  const words = descEl.value.trim().split(/\s+/).filter(Boolean);
  if (words.length > MAX_WORDS) {
    descEl.value = words.slice(0, MAX_WORDS).join(' ');
  }
  updateWordCounter();
}

if (descEl) {
  descEl.addEventListener('input', enforceWordLimit);
  updateWordCounter();
}

/* =========================================================
   3. Gestione immagine
   ========================================================= */
function setPhoto(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    alert('Il file selezionato non è un’immagine valida.');
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    alert('L’immagine supera il limite di 4 MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    currentPhoto = {
      dataUrl: reader.result,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    };
    renderPhotoPreview();
    if (certTimestamp) scheduleUpdate();
  };
  reader.onerror = () => alert('Impossibile leggere l’immagine selezionata.');
  reader.readAsDataURL(file);
}

function clearPhoto() {
  currentPhoto = null;
  if (fotoInput) fotoInput.value = '';
  renderPhotoPreview();
  if (certTimestamp) scheduleUpdate();
}

function renderPhotoPreview() {
  if (!photoPreview || !certPhotoWrap) return;

  if (currentPhoto && currentPhoto.dataUrl) {
    photoPreviewImg.src = currentPhoto.dataUrl;
    photoPreview.hidden = false;

    certPhotoImg.src = currentPhoto.dataUrl;
    certPhotoWrap.hidden = false;
  } else {
    photoPreviewImg.removeAttribute('src');
    photoPreview.hidden = true;

    certPhotoImg.removeAttribute('src');
    certPhotoWrap.hidden = true;
  }
}

if (fotoInput) {
  fotoInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) setPhoto(file);
  });
}
if (removePhotoBtn) removePhotoBtn.addEventListener('click', clearPhoto);

/* =========================================================
   4. Lettura form
   ========================================================= */
function readForm() {
  const scores = CRITERIA.map(c => {
    const el = document.getElementById('slider-' + c.id);
    return { ...c, value: el ? Number(el.value) : c.value };
  });

  return {
    nome:         document.getElementById('nome').value.trim(),
    autore:       document.getElementById('autore').value.trim(),
    proprietario: document.getElementById('proprietario').value.trim(),
    data:         document.getElementById('data').value,
    categoria:    document.getElementById('categoria').value,
    descrizione:  document.getElementById('descrizione').value.trim(),
    scores
  };
}

function computeScore(scores) {
  return Math.round(scores.reduce((acc, s) => acc + s.value * s.weight, 0));
}

function scoreVerdict(score) {
  if (score >= 90) return 'Eccellente';
  if (score >= 75) return 'Alta';
  if (score >= 55) return 'Media';
  if (score >= 35) return 'Bassa';
  return 'Non verificata';
}

/* =========================================================
   5. Rendering dettagli
   ========================================================= */
function renderDetails(data) {
  const rows = [
    ['Bene', data.nome],
    ['Autore / Produttore', data.autore],
    ['Proprietario', data.proprietario],
    ['Categoria', data.categoria],
    ['Data di emissione', formatDate(data.data)],
    ['Emesso da', 'CERTI PROOF DIGITAL SERVICES ™']
  ];
  if (data.descrizione) rows.push(['Descrizione', data.descrizione]);

  certDetails.textContent = '';
  const frag = document.createDocumentFragment();

  rows.forEach(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v || '—';
    frag.append(dt, dd);
  });

  certDetails.appendChild(frag);
}

function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

/* =========================================================
   6. Grafico radar
   ========================================================= */
function buildOrUpdateChart(scores) {
  const labels = scores.map(s => s.short);
  const values = scores.map(s => s.value);

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update();
    return;
  }

  chart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Indice di autenticità',
        data: values,
        fill: true,
        backgroundColor: 'rgba(197, 160, 89, .20)',
        borderColor: '#b08d43',
        borderWidth: 2,
        pointBackgroundColor: '#8c6e37',
        pointBorderColor: '#fffdf6',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      layout: { padding: 6 },
      scales: {
        r: {
          min: 0, max: 100, beginAtZero: true,
          angleLines: { color: 'rgba(140, 110, 55, .25)' },
          grid:       { color: 'rgba(140, 110, 55, .22)' },
          ticks: {
            stepSize: 25,
            backdropColor: 'transparent',
            color: '#9c8a67',
            font: { size: 9 }
          },
          pointLabels: {
            color: '#4a3c22',
            font: { size: 11, weight: '600' }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#2b241c',
          titleColor: '#f7ecd5',
          bodyColor: '#e8e2d6',
          padding: 10, cornerRadius: 8, displayColors: false,
          callbacks: { label: ctx => ` ${ctx.parsed.r} / 100` }
        }
      }
    }
  });
}

/* =========================================================
   7. Hash SHA-256
   ========================================================= */
function buildPayload(data, score, timestamp) {
  return JSON.stringify({
    issuer: 'CERTI PROOF DIGITAL SERVICES ™',
    timestamp,
    nome: data.nome,
    autore: data.autore,
    proprietario: data.proprietario,
    data: data.data,
    categoria: data.categoria,
    descrizione: data.descrizione,
    photo: currentPhoto
      ? {
          name: currentPhoto.name,
          size: currentPhoto.size,
          type: currentPhoto.type,
          lastModified: currentPhoto.lastModified
        }
      : null,
    score,
    scores: data.scores.map(s => ({ id: s.id, value: s.value }))
  });
}

async function sha256Hex(text) {
  if (window.crypto && window.crypto.subtle && window.isSecureContext) {
    try {
      const buffer = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(digest)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) { /* fallback */ }
  }
  return fallbackHash(text);
}

function fallbackHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(16).padStart(8, '0');
  const b = (h1 >>> 0).toString(16).padStart(8, '0');
  const c = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  const d = ((Math.imul(h1, 31) + Math.imul(h2, 17)) >>> 0).toString(16).padStart(8, '0');
  return (a + b + c + d).repeat(2);
}

function groupHash(hex) {
  return hex.replace(/(.{8})/g, '$1 ').trim();
}

async function updateHash(data, score) {
  const raw = await sha256Hex(buildPayload(data, score, certTimestamp));
  certHash.dataset.raw = raw;
  certHash.textContent = groupHash(raw);
}

/* =========================================================
   8. Aggiornamento certificato
   ========================================================= */
function updateCertificate() {
  const data = readForm();
  const score = computeScore(data.scores);

  emptyState.hidden = true;
  certificate.hidden = false;

  scoreValue.textContent = score;
  scoreLabel.textContent = scoreVerdict(score);

  renderDetails(data);
  buildOrUpdateChart(data.scores);

  if (currentPhoto) {
    certPhotoImg.alt = 'Immagine di ' + (data.nome || 'oggetto');
  }
  renderPhotoPreview();

  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => updateHash(data, score), 120);
}

function scheduleUpdate() {
  clearTimeout(scheduleUpdate._t);
  scheduleUpdate._t = setTimeout(updateCertificate, 90);
}

/* =========================================================
   9. Submit del form → redirect a Stripe se non pagato
   ========================================================= */
if (form) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    if (!isPaid) {
      /* Salva i dati del form prima di andare su Stripe */
      saveFormState();
      window.location.href = PAYMENT_LINK;
      return;
    }

    certTimestamp = Date.now();
    updateCertificate();

    if (window.innerWidth < 920) {
      setTimeout(() => {
        certificate.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  });
}

if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const raw = certHash.dataset.raw || certHash.textContent.replace(/\s/g, '');
    const original = copyBtn.textContent;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(raw);
      } else {
        const ta = document.createElement('textarea');
        ta.value = raw;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      copyBtn.textContent = 'Copiato ✓';
    } catch { copyBtn.textContent = 'Errore'; }

    setTimeout(() => { copyBtn.textContent = original; }, 1600);
  });
}

if (printBtn) printBtn.addEventListener('click', () => window.print());

/* =========================================================
   10. Reset filtri
   ========================================================= */
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (form) form.reset();

    CRITERIA.forEach(c => {
      const input = document.getElementById('slider-' + c.id);
      const out   = document.getElementById('out-' + c.id);
      if (input) {
        input.value = String(c.value);
        paintRange(input);
      }
      if (out) out.textContent = c.value;
    });

    currentPhoto = null;
    if (fotoInput) fotoInput.value = '';
    renderPhotoPreview();

    const dateEl = document.getElementById('data');
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

    updateWordCounter();

    certTimestamp = null;
    emptyState.hidden = false;
    certificate.hidden = true;
    certHash.textContent = '—';
    delete certHash.dataset.raw;

    const formCard = document.getElementById('formCard');
    if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* =========================================================
   11. Form contatti
   ========================================================= */
if (contactForm) {
  contactForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!contactForm.checkValidity()) { contactForm.reportValidity(); return; }
    contactOk.hidden = false;
    contactForm.reset();
    setTimeout(() => { contactOk.hidden = true; }, 5000);
  });
}

/* =========================================================
   12. Torna su
   ========================================================= */
if (backToTopBtn) {
  const toggleBackToTop = () => {
    backToTopBtn.classList.toggle('show', window.scrollY > 400);
  };
  window.addEventListener('scroll', toggleBackToTop, { passive: true });
  toggleBackToTop();

  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* =========================================================
   13. Toast (nuovo certificato + messaggio custom)
   ========================================================= */
const CERT_CATEGORIES = [
  'Arte e belle arti','Fotografia e stampe','Collezionismo','Autografi e memorabilia',
  'Antiquariato e vintage','Libri e manoscritti','Edizioni limitate e serie numerate',
  'Gioielli e pietre preziose','Orologi e orologeria','Moda e accessori',
  'Artigianato e handmade','Design e arredamento','Prodotti artigianali e commerciali',
  'Elettronica e informatica','Biciclette e mobilità','Auto e moto',
  'Ricambi e componenti industriali','Musica e strumenti',
  'Prodotti digitali e software','Musica, video e opere digitali',
  'Proprietà intellettuale e creazioni','Documenti digitali verificabili',
  'Certificati di proprietà dichiarata','Provenienza e storico degli oggetti',
  'Restauro e riparazione','Manutenzione e assistenza','Certificati per professionisti',
  'Corsi e formazione','Prodotti alimentari e bevande','Vino e collezioni da cantina',
  'Sport e attrezzature','Altro (generico)'
];

const TOAST_FIRST_DELAY = 8000;
const TOAST_MIN_DELAY    = 120000;
const TOAST_MAX_DELAY    = 300000;
const TOAST_VISIBLE_MS   = 6000;
const SUCCESS_VISIBLE_MS = 8000;

let toastHideTimer = null;

function showToast(title, subtitle, visibleMs) {
  if (!toastEl || !toastCatEl || !toastTitleEl) return;

  toastTitleEl.textContent = title;
  toastCatEl.textContent   = subtitle;

  toastEl.hidden = false;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');

  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => { toastEl.hidden = true; }, 400);
  }, visibleMs || TOAST_VISIBLE_MS);
}

function showRandomCertToast() {
  const cat = CERT_CATEGORIES[Math.floor(Math.random() * CERT_CATEGORIES.length)];
  showToast('Nuovo certificato generato', cat);
}

function scheduleNextToast() {
  const delay = Math.floor(Math.random() * (TOAST_MAX_DELAY - TOAST_MIN_DELAY)) + TOAST_MIN_DELAY;
  setTimeout(() => {
    showRandomCertToast();
    scheduleNextToast();
  }, delay);
}

/* =========================================================
   14. Init
   ========================================================= */
(function init() {
  /* 1. Costruisci slider */
  buildSliders();

  /* 2. Data di oggi di default */
  const today = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById('data');
  if (dateEl) dateEl.value = today;

  /* 3. Renderizza anteprima immagine */
  renderPhotoPreview();

  /* 4. Router */
  showPage(currentRoute());

  /* 5. Rileva ritorno da Stripe */
  const returnedFromStripe = detectStripeReturn();

  if (returnedFromStripe) {
    /* Ripristina i dati del form che l'utente aveva inserito prima del pagamento */
    const restored = restoreFormState();

    /* Vai alla home per mostrare il certificato */
    if (location.hash !== '#home') {
      location.hash = '#home';
    }

    /* Toast di conferma pagamento */
    showToast('Pagamento completato ✓', 'Il tuo certificato è pronto', SUCCESS_VISIBLE_MS);

    /* Se i dati sono stati ripristinati, genera subito il certificato */
    if (restored) {
      certTimestamp = Date.now();
      /* Attendi un attimo che il DOM sia visibile */
      setTimeout(() => {
        updateCertificate();
        /* Scroll al certificato */
        if (certificate) {
          setTimeout(() => {
            certificate.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        }
      }, 200);
    } else {
      /* Nessun dato ripristinato: mostra un avviso */
      showToast('Pagamento completato ✓', 'Inserisci i dati del bene per generare il certificato', SUCCESS_VISIBLE_MS);
    }

    /* Riprogramma il toast periodico */
    setTimeout(() => {
      showRandomCertToast();
      scheduleNextToast();
    }, SUCCESS_VISIBLE_MS + 4000);
  } else {
    /* Nessun ritorno da Stripe: toast periodico normale */
    setTimeout(() => {
      showRandomCertToast();
      scheduleNextToast();
    }, TOAST_FIRST_DELAY);
  }
})();
