// ============================================
// BOX - Application principale
// ============================================

const App = {
  catalogue: null, filteredSets: [], currentSet: null,
  remaining: [], wrongCards: [],
  completed: 0, totalCards: 0, rightCount: 0, wrongCount: 0,
  startTime: null, isFlipped: false, timerInterval: null,
  lastBrickCount: 0,
  activeFilters: { matiere: null, niveau: null, prof: null },

  // Chemin de la cheminee pour le clipPath
  CHIMNEY_PATH: 'M48,8 L48,100 L28,108 L28,370 Q28,385 40,385 L80,385 Q92,385 92,370 L92,108 L72,100 L72,8 Z',
  CHIMNEY_PATH_DONE: 'M48,8 L48,100 L28,108 L28,335 Q28,348 38,348 L82,348 Q92,348 92,335 L92,108 L72,100 L72,8 Z',
  TOTAL_BRICK_ROWS: 20,

  getEncouragement(pct, total) {
    if (total === 0) return "C'est parti !";
    if (pct === 100) return 'Parfait !';
    if (pct >= 80) return 'Excellent !';
    if (pct >= 60) return 'Sur la bonne voie';
    if (pct >= 40) return 'Continue !';
    if (pct >= 20) return 'Tu progresses';
    return 'Courage !';
  },

  init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'delete') { this.showScreen('delete'); return; }
    if (params.get('set')) { this.loadAndReview(params.get('set')); return; }
    this.loadCatalogue();
    this.initKeyboard();
    this.initTouch();
  },

  showScreen(name) {
    ['Menu', 'Review', 'Done', 'Delete', 'Error'].forEach(s => {
      const el = document.getElementById('screen' + s);
      if (el) el.style.display = 'none';
    });
    const target = document.getElementById('screen' + name.charAt(0).toUpperCase() + name.slice(1));
    if (target) target.style.display = 'block';
  },

  showError(msg) { document.getElementById('errorMessage').textContent = msg; this.showScreen('error'); },

  goHome() {
    this.currentSet = null; this.isFlipped = false;
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    window.history.pushState({}, '', window.location.pathname);
    this.loadCatalogue();
  },

  toggleGuide() {
    const panel = document.getElementById('guidePanel');
    const btn = document.getElementById('guideToggle');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      btn.classList.add('open');
    } else {
      panel.style.display = 'none';
      btn.classList.remove('open');
    }
  },

  // --- Catalogue ---
  async loadCatalogue() {
    this.showScreen('menu');
    const grid = document.getElementById('setsGrid');
    grid.innerHTML = '<div class="loading"><div class="loading__spinner"></div>Chargement...</div>';
    try {
      if (BOX_CONFIG.DEMO_MODE) { this.catalogue = DEMO_CATALOGUE; }
      else {
        const resp = await fetch(BOX_CONFIG.WEBHOOK_CATALOGUE);
        if (!resp.ok) throw new Error('Erreur');
        this.catalogue = await resp.json();
      }
      this.buildFilters(); this.applyFilters(); this.updateNavStats();
    } catch (e) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state__icon">&#128533;</div><p>Impossible de charger le catalogue.</p></div>';
    }
  },

  buildFilters() {
    const sets = this.catalogue.sets;
    const matieres = [...new Set(sets.map(s => s.matiere))].sort();
    const niveaux = [...new Set(sets.map(s => s.niveau))].sort((a, b) => BOX_CONFIG.NIVEAUX.indexOf(a) - BOX_CONFIG.NIVEAUX.indexOf(b));
    const profs = [...new Set(sets.map(s => s.prof_nom))].sort();
    this._buildPillGroup('filterMatiereGroup', matieres, 'matiere');
    this._buildPillGroup('filterNiveauGroup', niveaux, 'niveau');
    this._buildPillGroup('filterProfGroup', profs, 'prof');
  },

  _buildPillGroup(containerId, values, filterKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const row = document.getElementById(containerId.replace('Group', 'Row'));
    if (row) row.style.display = values.length < 2 ? 'none' : '';
    values.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'filter-pill';
      btn.textContent = v;
      btn.dataset.value = v;
      if (filterKey === 'matiere') {
        const c = BOX_CONFIG.MATIERES[v] || BOX_CONFIG.MATIERES['Autre'];
        btn.dataset.bg = c.bg; btn.dataset.color = c.color; btn.dataset.border = c.border;
      }
      btn.onclick = () => this.toggleFilter(filterKey, v, btn);
      container.appendChild(btn);
    });
  },

  toggleFilter(key, value, btn) {
    const group = btn.closest('.filter-pills');
    if (this.activeFilters[key] === value) {
      this.activeFilters[key] = null;
      btn.classList.remove('active');
      btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = '';
    } else {
      if (group) group.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.remove('active');
        p.style.background = ''; p.style.color = ''; p.style.borderColor = '';
      });
      this.activeFilters[key] = value;
      btn.classList.add('active');
      if (key === 'matiere') {
        btn.style.background = btn.dataset.bg;
        btn.style.color = btn.dataset.color;
        btn.style.borderColor = btn.dataset.border;
      }
    }
    this.applyFilters();
  },

  resetFilters() {
    this.activeFilters = { matiere: null, niveau: null, prof: null };
    document.querySelectorAll('.filter-pill.active').forEach(p => {
      p.classList.remove('active');
      p.style.background = ''; p.style.color = ''; p.style.borderColor = '';
    });
    this.applyFilters();
  },

  applyFilters() {
    const { matiere, niveau, prof } = this.activeFilters;
    this.filteredSets = this.catalogue.sets.filter(s =>
      (!matiere || s.matiere === matiere) &&
      (!niveau || s.niveau === niveau) &&
      (!prof || s.prof_nom === prof)
    );
    this._updateFilterCount();
    this.renderGrid();
  },

  _updateFilterCount() {
    const count = document.getElementById('filterCount');
    const reset = document.getElementById('filterReset');
    const total = this.catalogue.sets.length;
    const filtered = this.filteredSets.length;
    if (count) count.textContent = filtered + ' / ' + total + ' jeu' + (total > 1 ? 'x' : '');
    if (reset) reset.style.display = Object.values(this.activeFilters).some(Boolean) ? '' : 'none';
  },

  renderGrid() {
    const grid = document.getElementById('setsGrid');
    if (!this.filteredSets.length) { grid.innerHTML = '<div class="empty-state"><div class="empty-state__icon">&#128218;</div><p>Aucune fiche disponible.</p></div>'; return; }
    grid.innerHTML = this.filteredSets.map(s => {
      const c = BOX_CONFIG.MATIERES[s.matiere] || BOX_CONFIG.MATIERES['Autre'];
      const prog = this.getProgress(s.id);
      const pct = prog ? Math.round((1 - prog.remaining.length / s.nb_cartes) * 100) : 0;
      return `<div class="set-card" onclick="App.loadAndReview('${s.id}')" style="border-left-color:${c.border}">
        <div class="set-card__header">
          <div class="set-card__notion">${this.esc(s.notion)}</div>
          <div class="set-card__count">${s.nb_cartes} cartes</div>
        </div>
        <div class="set-card__meta">
          <span class="badge-matiere" style="background:${c.bg};color:${c.color}">${this.esc(s.matiere)}</span>
          <span class="badge-matiere" style="background:var(--card);color:var(--text-secondary)">${this.esc(s.niveau)}</span>
          <span class="set-card__prof-inline">${this.esc(s.prof_nom)}</span>
          <span class="set-card__date">${this.formatDate(s.date_creation)}</span>
        </div>
        ${prog ? `<div class="set-card__progress"><div class="set-card__progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>`;
    }).join('');
  },

  updateNavStats() {
    const el = document.getElementById('navStats');
    if (this.catalogue) el.textContent = this.catalogue.total_sets + ' jeux disponibles';
  },

  // --- Chrono ---
  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const el = document.getElementById('reviewTimer');
      if (!el || !this.startTime) return;
      const sec = Math.round((Date.now() - this.startTime) / 1000);
      const m = Math.floor(sec / 60), s = sec % 60;
      el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  },

  // --- Briques ---
  buildBrickRows(containerId, progress, totalRows, yStart, yEnd, xLeft, xRight) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const targetRows = Math.round(progress * totalRows);
    const existing = container.children.length;
    if (targetRows <= existing) return;

    const rowHeight = (yEnd - yStart) / totalRows;
    // Largeur de la cheminee varie (haut = etroit, bas = large)
    for (let i = existing; i < targetRows; i++) {
      const rowIndex = totalRows - 1 - i; // de bas en haut
      const y = yStart + rowIndex * rowHeight;
      // Interpolation largeur cheminee
      let lx, rx;
      if (y < 100) { lx = 48; rx = 72; } // haut etroit
      else if (y < 108) { const t = (y - 100) / 8; lx = 48 - t * 20; rx = 72 + t * 20; } // transition
      else { lx = 28; rx = 92; } // corps large

      const row = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      row.classList.add('brick-row');
      row.style.animationDelay = ((i - existing) * 0.05) + 's';

      // Dessiner les briques de la rangee
      const brickW = 10;
      const brickH = rowHeight - 1;
      const isOdd = i % 2 === 1;
      const startX = lx + (isOdd ? brickW / 2 : 0);

      for (let bx = startX; bx < rx; bx += brickW + 1) {
        const w = Math.min(brickW, rx - bx);
        if (w < 2) continue;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', bx);
        rect.setAttribute('y', y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', brickH);
        rect.setAttribute('fill', '#b71e1d');
        rect.setAttribute('rx', '0.5');
        row.appendChild(rect);

        // Joint horizontal
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', bx); line.setAttribute('x2', bx + w);
        line.setAttribute('y1', y + brickH); line.setAttribute('y2', y + brickH);
        line.setAttribute('stroke', '#8b1615'); line.setAttribute('stroke-width', '0.8');
        row.appendChild(line);
      }
      container.appendChild(row);
    }
  },

  // --- Fumee spectaculaire ---
  createSmoke(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('active');

    const sizes = ['big', 'med', 'sm'];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      const sz = sizes[i % 3];
      p.className = 'smoke-particle smoke-particle--' + sz;
      const dim = sz === 'big' ? 40 + Math.random() * 20 : sz === 'med' ? 28 + Math.random() * 12 : 18 + Math.random() * 10;
      p.style.width = dim + 'px';
      p.style.height = dim + 'px';
      p.style.left = (Math.random() * 80) + 'px';
      p.style.bottom = (Math.random() * 10) + 'px';
      p.style.animationDelay = (i * 0.4) + 's';
      container.appendChild(p);
    }

    setTimeout(() => container.classList.add('active'), 200);
  },

  // --- Revision ---
  async loadAndReview(setId) {
    this.showScreen('review');
    try {
      let setData;
      if (BOX_CONFIG.DEMO_MODE) { setData = DEMO_SETS[setId]; if (!setData) throw new Error(); }
      else {
        if (!this.catalogue) { this.catalogue = await (await fetch(BOX_CONFIG.WEBHOOK_CATALOGUE)).json(); }
        const info = this.catalogue.sets.find(s => s.id === setId);
        if (!info) throw new Error();
        this.currentDriveFileId = info.drive_file_id;
        const resp = await fetch(BOX_CONFIG.WEBHOOK_SET + '?file_id=' + encodeURIComponent(info.drive_file_id));
        if (!resp.ok) throw new Error();
        setData = await resp.json();
      }
      this.currentSet = setData;
      this.totalCards = setData.cartes.length;
      this.lastBrickCount = 0;

      // Reset briques
      const br = document.getElementById('brickRows');
      if (br) br.innerHTML = '';

      const meta = document.getElementById('reviewMeta');
      if (meta) meta.textContent = (setData.matiere || '') + ' — ' + (setData.notion || '');

      const saved = this.getProgress(setId);
      if (saved && saved.remaining.length > 0 && saved.remaining.length < this.totalCards) {
        this.remaining = saved.remaining.map(i => setData.cartes.find(c => c.numero === i)).filter(Boolean);
        this.completed = this.totalCards - this.remaining.length;
        this.rightCount = saved.rightCount || 0; this.wrongCount = saved.wrongCount || 0;
        this.wrongCards = saved.wrongCards || []; this.startTime = saved.started;
      } else {
        this.remaining = this.shuffle([...setData.cartes]);
        this.completed = 0; this.rightCount = 0; this.wrongCount = 0;
        this.wrongCards = []; this.startTime = Date.now();
      }
      window.history.pushState({}, '', '?set=' + setId);
      this.startTimer();
      this.updateProgress();
      this.showCard();
    } catch (e) { this.showError('Impossible de charger ce jeu de fiches.'); }
  },

  showCard() {
    if (!this.remaining.length) { this.showDone(); return; }
    const card = this.remaining[0];
    document.getElementById('cardQuestion').textContent = card.question;
    document.getElementById('cardAnswer').textContent = card.reponse;
    const diffEl = document.getElementById('cardDifficulty');
    if (diffEl) {
      const d = (card.difficulte || '').toLowerCase();
      diffEl.textContent = d || '';
      diffEl.className = 'nlm-card__difficulty' + (d ? ' nlm-card__difficulty--' + d : '');
    }
    const cardEl = document.querySelector('.nlm-card');
    this.isFlipped = false;
    cardEl.classList.remove('flipped', 'nlm-card--flash-ok', 'nlm-card--flash-ko');
    document.getElementById('questionLink').style.display = 'block';
    document.getElementById('questionForm').style.display = 'none';
    if (this.completed >= 2) {
      const n = document.getElementById('nlmNotice'); if (n) n.style.opacity = '0';
    }
  },

  flipCard() {
    if (this.isFlipped) return;
    this.isFlipped = true;
    document.querySelector('.nlm-card').classList.add('flipped');
  },

  answer(knew) {
    if (!this.isFlipped) { this.flipCard(); return; }
    const cardEl = document.querySelector('.nlm-card');
    if (cardEl) {
      cardEl.classList.remove('nlm-card--flash-ok', 'nlm-card--flash-ko');
      void cardEl.offsetWidth;
      cardEl.classList.add(knew ? 'nlm-card--flash-ok' : 'nlm-card--flash-ko');
    }
    const card = this.remaining.shift();
    if (knew) { this.completed++; this.rightCount++; }
    else {
      this.wrongCount++;
      if (!this.wrongCards.includes(card.numero)) this.wrongCards.push(card.numero);
      const pos = Math.floor(this.remaining.length / 2) + Math.floor(Math.random() * Math.ceil(this.remaining.length / 2)) + 1;
      this.remaining.splice(Math.min(pos, this.remaining.length), 0, card);
    }
    try { this.saveProgress(); } catch (e) {}
    this.updateProgress();
    this.showCard();
  },

  skipCard() {
    if (!this.remaining.length) return;
    this.remaining.push(this.remaining.shift());
    this.showCard();
  },

  // --- MAJ progression en temps reel ---
  updateProgress() {
    const total = this.rightCount + this.wrongCount;
    const accuracy = total > 0 ? Math.round((this.rightCount / total) * 100) : 0;
    const deckProgress = this.totalCards > 0 ? this.completed / this.totalCards : 0;
    const deckPct = Math.round(deckProgress * 100);

    const fill = document.getElementById('progressFill');
    if (fill) fill.style.width = deckPct + '%';

    const count = document.getElementById('progressCount');
    if (count) count.textContent = this.completed + ' / ' + this.totalCards;

    const ok = document.getElementById('liveScoreOk');
    if (ok) ok.textContent = this.rightCount;
    const ko = document.getElementById('liveScoreKo');
    if (ko) ko.textContent = this.wrongCount;

    const pctEl = document.getElementById('svgPct');
    if (pctEl) pctEl.textContent = deckPct + '%';

    const enc = document.getElementById('encourageText');
    if (enc) enc.textContent = this.getEncouragement(accuracy, total);

    // Construction brique par brique
    this.buildBrickRows('brickRows', deckProgress, this.TOTAL_BRICK_ROWS, 8, 385, 28, 92);

    // Fumee quand complet
    const smoke = document.getElementById('logoSmoke');
    if (smoke && deckProgress >= 1 && !smoke.classList.contains('active')) {
      this.createSmoke('logoSmoke', 8);
    }
  },

  // --- Ecran termine ---
  // Fumee sur la page de revision pendant 5s, puis page des scores
  showDone() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    this.clearProgress(this.currentSet.id);

    const total = this.rightCount + this.wrongCount;
    const pct = total > 0 ? Math.round((this.rightCount / total) * 100) : 0;
    const endTime = Date.now();

    // Compléter les briques à 100% sur la page de revision
    this.buildBrickRows('brickRows', 1, this.TOTAL_BRICK_ROWS, 8, 385, 28, 92);
    const pctEl = document.getElementById('svgPct');
    if (pctEl) pctEl.textContent = '100%';

    // Lancer la fumee sur la cheminee de revision
    this.createSmoke('logoSmoke', 12);

    // Masquer carte + boutons pendant la fumee
    const cardCol = document.querySelector('.review-card-col');
    if (cardCol) { cardCol.style.opacity = '0.3'; cardCol.style.pointerEvents = 'none'; }

    // Afficher "Bravo !" dans l'encouragement
    const enc = document.getElementById('encourageText');
    if (enc) enc.textContent = this.getEncouragement(pct, total);

    // Apres 5 secondes de fumee → page des scores
    setTimeout(() => {
      // Restaurer la colonne carte
      if (cardCol) { cardCol.style.opacity = '1'; cardCol.style.pointerEvents = ''; }

      this.showScreen('done');

      document.getElementById('doneTitle').textContent = this.getEncouragement(pct, total);
      document.getElementById('doneScore').textContent = this.rightCount + ' / ' + total;
      document.getElementById('donePct').textContent = pct + ' %';

      const elapsed = Math.round((endTime - this.startTime) / 1000);
      const min = Math.floor(elapsed / 60), sec = elapsed % 60;
      document.getElementById('doneTime').textContent = (min > 0 ? min + ' min ' : '') + sec + ' s';

      document.getElementById('statRight').textContent = this.rightCount;
      document.getElementById('statWrong').textContent = this.wrongCount;
      document.getElementById('retryMenu').style.display = 'none';

      // Fumee conditionnelle sur le logo de la page scores
      const doneSmoke = document.getElementById('doneSmoke');
      if (doneSmoke) {
        doneSmoke.innerHTML = '';
        doneSmoke.classList.remove('active');
        if (pct >= 100) {
          this.createSmoke('doneSmoke', 8);
        } else if (pct >= 80) {
          this.createSmoke('doneSmoke', 3);
        }
      }
    }, 5000);
  },

  toggleRetryMenu() {
    const m = document.getElementById('retryMenu');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
  },

  restart() {
    if (!this.currentSet) return;
    this.remaining = this.shuffle([...this.currentSet.cartes]);
    this.totalCards = this.currentSet.cartes.length;
    this.completed = 0; this.rightCount = 0; this.wrongCount = 0;
    this.wrongCards = []; this.startTime = Date.now(); this.lastBrickCount = 0;
    const br = document.getElementById('brickRows');
    if (br) br.innerHTML = '';
    const smoke = document.getElementById('logoSmoke');
    if (smoke) { smoke.innerHTML = ''; smoke.classList.remove('active'); }
    this.showScreen('review');
    this.startTimer();
    this.updateProgress(); this.showCard();
    const n = document.getElementById('nlmNotice'); if (n) n.style.opacity = '1';
  },

  restartWrongOnly() {
    if (!this.currentSet || !this.wrongCards.length) { this.toast('Aucune carte mal repondue.', true); return; }
    this.remaining = this.shuffle(this.wrongCards.map(n => this.currentSet.cartes.find(c => c.numero === n)).filter(Boolean));
    this.totalCards = this.remaining.length;
    this.completed = 0; this.rightCount = 0; this.wrongCount = 0;
    this.wrongCards = []; this.startTime = Date.now(); this.lastBrickCount = 0;
    const br = document.getElementById('brickRows');
    if (br) br.innerHTML = '';
    const smoke = document.getElementById('logoSmoke');
    if (smoke) { smoke.innerHTML = ''; smoke.classList.remove('active'); }
    this.showScreen('review');
    this.startTimer();
    this.updateProgress(); this.showCard();
    const notice = document.getElementById('nlmNotice'); if (notice) notice.style.opacity = '1';
  },

  // --- Sauvegarde ---
  saveProgress() {
    if (!this.currentSet) return;
    localStorage.setItem('box_progress_' + this.currentSet.id, JSON.stringify({
      remaining: this.remaining.map(c => c.numero), started: this.startTime,
      rightCount: this.rightCount, wrongCount: this.wrongCount, wrongCards: this.wrongCards
    }));
  },
  getProgress(id) { try { return JSON.parse(localStorage.getItem('box_progress_' + id)); } catch { return null; } },
  clearProgress(id) { localStorage.removeItem('box_progress_' + id); },

  // --- Question prof ---
  openQuestionForm() {
    if (!this.currentSet || !this.remaining.length) return;
    const key = 'box_asked_' + this.currentSet.id + '_' + this.remaining[0].numero;
    if (sessionStorage.getItem(key)) { this.toast('Deja envoyee.', true); return; }
    document.getElementById('questionForm').style.display = 'block';
    document.getElementById('questionLink').style.display = 'none';
    document.getElementById('questionText').value = '';
    document.getElementById('questionText').focus();
  },
  closeQuestionForm() {
    document.getElementById('questionForm').style.display = 'none';
    document.getElementById('questionLink').style.display = 'block';
  },
  async sendQuestion() {
    const text = document.getElementById('questionText').value.trim();
    if (!text) { this.toast('Ecris ta question.', true); return; }
    const card = this.remaining[0];
    try {
      if (!BOX_CONFIG.DEMO_MODE) {
        await fetch(BOX_CONFIG.WEBHOOK_QUESTION, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_id: this.currentSet.id, drive_file_id: this.currentDriveFileId || '',
            card_numero: card.numero, card_question: card.question, card_reponse: card.reponse,
            question_text: text, matiere: this.currentSet.matiere, notion: this.currentSet.notion })
        });
      }
      sessionStorage.setItem('box_asked_' + this.currentSet.id + '_' + card.numero, '1');
      this.closeQuestionForm(); this.toast('Question envoyee.');
    } catch (e) { this.toast('Erreur.', true); }
  },

  // --- Suppression ---
  async deleteSet() {
    const setId = document.getElementById('deleteId').value.trim();
    const code = document.getElementById('deleteCode').value.trim();
    const r = document.getElementById('deleteResult');
    if (!setId || !code) { r.innerHTML = '<div style="margin-top:12px;color:var(--danger)">Remplis les deux champs.</div>'; return; }
    try {
      if (BOX_CONFIG.DEMO_MODE) { r.innerHTML = '<div style="margin-top:12px;color:var(--text-secondary)">Mode demo.</div>'; return; }
      const resp = await fetch(BOX_CONFIG.WEBHOOK_DELETE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set_id: setId, code_suppression: code }) });
      if (resp.ok) { r.innerHTML = '<div style="margin-top:12px;color:var(--success)">Supprime.</div>'; this.clearProgress(setId); }
      else r.innerHTML = '<div style="margin-top:12px;color:var(--danger)">' + (resp.status === 403 ? 'Code incorrect.' : 'Erreur.') + '</div>';
    } catch (e) { r.innerHTML = '<div style="margin-top:12px;color:var(--danger)">Erreur connexion.</div>'; }
  },

  // --- Clavier ---
  initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || !this.currentSet) return;
      switch (e.key) {
        case ' ': case 'Enter': e.preventDefault(); if (!this.isFlipped) this.flipCard(); break;
        case 'ArrowRight': case '1': e.preventDefault(); this.answer(true); break;
        case 'ArrowLeft': case '2': e.preventDefault(); this.answer(false); break;
        case 'ArrowDown': e.preventDefault(); this.skipCard(); break;
        case 'Escape': e.preventDefault(); this.goHome(); break;
      }
    });
  },

  // --- Swipe tactile ---
  initTouch() {
    const card = document.querySelector('.nlm-card');
    if (!card) return;
    let startX = 0;
    card.addEventListener('touchstart', e => { startX = e.changedTouches[0].clientX; }, { passive: true });
    card.addEventListener('touchend', e => {
      if (!this.currentSet) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 60) return;
      if (!this.isFlipped) { this.flipCard(); return; }
      this.answer(dx > 0);
    }, { passive: true });
  },

  toast(msg, err) {
    const c = document.getElementById('toastContainer');
    const d = document.createElement('div');
    d.className = 'toast' + (err ? ' toast--error' : '');
    d.textContent = msg; c.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  },

  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },
  formatDate(s) { try { return new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); } catch { return s; } }
};

document.addEventListener('DOMContentLoaded', () => App.init());
