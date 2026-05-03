/**
 * ChimneyTetris — animation de cheminée Tetris pour l'app de flashcards
 * du Collège Albert Roussel (Tourcoing).
 *
 * Approche : on utilise le LOGO RÉEL du collège (PNG, cheminée d'origine
 * effacée en transparence) comme arrière-plan, et on remplit la zone
 * cheminée brique par brique au-dessus.
 *
 * API :
 *   const chimney = new ChimneyTetris(container, options?)
 *   chimney.updateChimney(progress)      // progress ∈ [0..1]
 *   chimney.launchFireworks(durationMs?)
 *   chimney.destroy()
 *
 * Options : { logoSrc: 'assets/logo-no-chimney.png' }
 */
(function (global) {
  'use strict';

  const RED = '#b71e1d';
  const ORANGE = '#f3902d';

  // --- Coordonnées de la cheminée d'origine, en % de l'image du logo
  // (image source : 1668×1375, cheminée x=[51..234] y=[0..700])
  // En % : x ∈ [3.06%..14.03%], y ∈ [0%..50.91%]
  // Le trapèze : haut x=[83..211], bas x=[51..234]
  // Bandes blanches : 4 bandes horizontales décoratives
  const CHIM = {
    // tout en % de l'image du logo
    topLeftXPct:  4.97,   // 83/1668
    topRightXPct: 12.65,  // 211/1668
    botLeftXPct:  3.06,
    botRightXPct: 14.03,
    topYPct:      0.36,   // y=5/1375
    botYPct:      50.91,  // y=700/1375
  };

  // Bandes blanches d'origine (en % de l'image)
  const BANDS_PCT = [
    { y0: 1.53,  y1: 2.40 },   // y=21..33
    { y0: 12.65, y1: 13.31 },  // y=174..183
    { y0: 28.36, y1: 29.09 },  // y=390..400
    { y0: 50.47, y1: 51.71 },  // y=694..711
  ];

  // Pool de polyominos disponibles (le composant en pioche selon totalCards)
  // Pièces simples (1-2 cellules) en haut de la liste, plus complexes en bas
  // pour que les petits totaux gardent des pièces simples.
  const PIECE_POOL = [
    // simples (cards faibles)
    { shape: [[0,0]],                   color: ORANGE, rot:  0 },
    { shape: [[0,0],[1,0]],             color: RED,    rot: -2 },
    { shape: [[0,0],[1,0]],             color: ORANGE, rot:  2 },
    { shape: [[0,0],[1,0],[2,0]],       color: RED,    rot: -4 },
    { shape: [[0,0],[1,0],[2,0]],       color: ORANGE, rot:  3 },
    { shape: [[0,0],[1,0],[2,0],[3,0]], color: RED,    rot: -6 },
    // L / T / S / Z
    { shape: [[0,0],[1,0],[2,0],[2,1]], color: RED,    rot:  6 },
    { shape: [[0,0],[1,0],[2,0],[0,1]], color: ORANGE, rot: -5 },
    { shape: [[0,0],[1,0],[2,0],[1,1]], color: RED,    rot:  4 },
    { shape: [[0,0],[1,0],[1,1],[2,1]], color: RED,    rot: -3 },
    { shape: [[1,0],[2,0],[0,1],[1,1]], color: ORANGE, rot:  5 },
    { shape: [[0,0],[1,0],[1,1],[2,1]], color: RED,    rot:  3 },
    { shape: [[0,0],[1,0],[2,0],[2,1]], color: ORANGE, rot: -3 },
    // duplicates pour aller jusqu'à 20
    { shape: [[0,0],[1,0],[2,0]],       color: RED,    rot:  2 },
    { shape: [[0,0],[1,0],[2,0],[1,1]], color: ORANGE, rot: -4 },
    { shape: [[0,0],[1,0],[1,1]],       color: RED,    rot:  3 },
    { shape: [[0,0],[1,0],[1,1]],       color: ORANGE, rot: -3 },
    { shape: [[0,0],[1,0],[2,0]],       color: RED,    rot: -5 },
    { shape: [[0,0],[1,0]],             color: RED,    rot:  4 },
    { shape: [[0,0]],                   color: ORANGE, rot:  0 },
  ];

  // Construit la liste de pièces pour un total N donné (6..20).
  // Petite cheminée ⇒ pièces simples ; grande cheminée ⇒ pièces variées.
  function buildPieceList(N) {
    N = Math.max(1, Math.min(PIECE_POOL.length, N|0));
    // pioche en mélangeant simples + complexes selon N
    const list = [];
    if (N <= 6) {
      // pièces simples (1..3 cellules) pour petits totaux
      const simples = PIECE_POOL.slice(0, 6);
      for (let i = 0; i < N; i++) list.push(simples[i % simples.length]);
    } else {
      // démarre simple, monte en complexité
      const step = PIECE_POOL.length / N;
      for (let i = 0; i < N; i++) {
        list.push(PIECE_POOL[Math.min(PIECE_POOL.length - 1, Math.floor(i * step))]);
      }
    }
    return list;
  }


  function el(tag, cls, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgEl(tag, attrs = {}, parent) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  class ChimneyTetris {
    constructor(container, opts = {}) {
      this.container = container;
      this.logoSrc = opts.logoSrc || 'assets/logo-no-chimney.png';
      this.cols = 4;
      // valeurs par défaut (peuvent être ajustées par updateChimney)
      this.totalCards = opts.totalCards || 12;
      this.cardsCompleted = 0;
      this.pieces = buildPieceList(this.totalCards);
      this.totalBricks = this.pieces.length;
      this.rows = this.totalBricks;
      this.bricks = [];
      this.fireworksRunning = false;
      this.logoAspect = 1668 / 1375;
      this._build();
    }

    _build() {
      const root = el('div', 'ct-root', this.container);
      this.root = root;

      // Ciel (gradient day→night via overlay)
      this.sky = el('div', 'ct-sky', root);
      this.skyNight = el('div', 'ct-sky-night', root);

      // Étoiles
      this.starsLayer = el('div', 'ct-stars', root);
      for (let i = 0; i < 24; i++) {
        const s = el('div', 'ct-star', this.starsLayer);
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 55 + '%';
        s.style.animationDelay = (Math.random() * 3) + 's';
        const sz = 1.5 + Math.random() * 2;
        s.style.width = s.style.height = sz + 'px';
      }

      // Conteneur du logo (garde son aspect ratio via padding-top hack)
      this.logoBox = el('div', 'ct-logobox', root);

      // SVG de remplissage de la cheminée — couvre tout le logoBox,
      // viewBox = 100×100*ratio (en %)
      this.VB_W = 100;
      this.VB_H = 100 / this.logoAspect; // garde l'aspect ratio
      // mais on veut x/y en pourcentages réels du logo, donc viewBox=100×(100/aspect)
      // Plus simple : viewBox=1000×(1000/aspect), et coords en x*10 et y*10/aspect
      this.SCALE = 10; // 1% = 10 unités viewBox
      const vbW = 100 * this.SCALE;
      const vbH = (100 / this.logoAspect) * this.SCALE;

      const svg = svgEl('svg', {
        viewBox: `0 0 ${vbW} ${vbH}`,
        preserveAspectRatio: 'none',
      }, this.logoBox);
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      this.svg = svg;

      // viewBox helpers : convertit % image → coord viewBox
      const px = p => p * this.SCALE;                       // % horizontal
      const py = p => (p / this.logoAspect) * this.SCALE;   // % vertical
      this._px = px; this._py = py;

      // Coords du trapèze en viewBox
      const c = CHIM;
      this.chim = {
        topLeftX:  px(c.topLeftXPct),
        topRightX: px(c.topRightXPct),
        botLeftX:  px(c.botLeftXPct),
        botRightX: px(c.botRightXPct),
        topY:      py(c.topYPct),
        botY:      py(c.botYPct),
      };
      this.cellH = (this.chim.botY - this.chim.topY) / this.rows;
      this.cellW = (px(c.botRightXPct) - px(c.botLeftXPct)) / this.cols;

      // <defs> clip + mask
      const defs = svgEl('defs', {}, svg);
      const ch = this.chim;
      const trapPts = `${ch.topLeftX},${ch.topY} ${ch.topRightX},${ch.topY} ${ch.botRightX},${ch.botY} ${ch.botLeftX},${ch.botY}`;

      const clip = svgEl('clipPath', { id: 'ct-chim-clip' }, defs);
      svgEl('polygon', { points: trapPts }, clip);

      // Cheminée fantôme (ghost) — quand elle est vide
      this.chimGhost = svgEl('g', { class: 'ct-chim-ghost' }, svg);
      svgEl('polygon', {
        points: trapPts,
        fill: 'rgba(183,30,29,0.06)',
        stroke: RED,
        'stroke-width': 4,
        'stroke-dasharray': '12 8',
        opacity: 0.55,
      }, this.chimGhost);

      // Zone Tetris (clippée par le trapèze)
      this.tetrisG = svgEl('g', {
        class: 'ct-tetris',
        'clip-path': 'url(#ct-chim-clip)',
      }, svg);

      // Bandes blanches incurvées (ellipses fines) — donnent du relief à la
      // cheminée circulaire en imitant l'effet du logo original
      this.bandsG = svgEl('g', { class: 'ct-bands' }, svg);
      BANDS_PCT.forEach(b => {
        const yMid = py((b.y0 + b.y1) / 2);
        const yH = py(b.y1 - b.y0); // épaisseur en viewbox
        const xL = this._trapXAt(yMid, 'left');
        const xR = this._trapXAt(yMid, 'right');
        const cx = (xL + xR) / 2;
        const rx = (xR - xL) / 2 + 0.5; // déborde un poil pour couvrir le contour
        const ry = Math.max(yH * 0.6, 1.2);

        // ombre douce au-dessus de la bande (relief)
        const shadow = svgEl('ellipse', {
          cx, cy: yMid - ry * 0.5,
          rx, ry: ry * 1.15,
          fill: 'rgba(0,0,0,0.18)',
        }, this.bandsG);
        shadow.classList.add('ct-band-shadow');

        // bande principale (ellipse incurvée)
        const band = svgEl('ellipse', {
          cx, cy: yMid,
          rx, ry,
        }, this.bandsG);
        band.classList.add('ct-band');

        // highlight haut de la bande (brillance)
        const hl = svgEl('ellipse', {
          cx, cy: yMid - ry * 0.35,
          rx: rx * 0.85, ry: ry * 0.35,
          fill: 'rgba(255,255,255,0.55)',
        }, this.bandsG);
        hl.classList.add('ct-band-hl');
      });

      // Contour rouge final (par-dessus tout) — opacité ramping avec progress
      this.chimOutline = svgEl('polygon', {
        points: trapPts,
        fill: 'none',
        stroke: RED,
        'stroke-width': 5,
        'stroke-linejoin': 'miter',
        opacity: 0,
      }, svg);

      // Logo réel par-dessus le SVG (mais sa cheminée est transparente,
      // donc on voit les briques à travers). Position : aligné sur logoBox.
      this.logoImg = el('img', 'ct-logo-img', this.logoBox);
      this.logoImg.src = this.logoSrc;
      this.logoImg.alt = 'Collège Albert Roussel — Tourcoing';

      // Fumée HTML — positionnée en % du logoBox, au sommet de la cheminée
      const smokeXPct = (CHIM.topLeftXPct + CHIM.topRightXPct) / 2;
      this.smoke = el('div', 'ct-smoke', this.logoBox);
      this.smoke.style.left = smokeXPct + '%';
      this.smoke.style.top = CHIM.topYPct + '%';
      for (let i = 0; i < 5; i++) {
        const p = el('div', 'ct-smoke-puff', this.smoke);
        p.style.animationDelay = (i * 0.7) + 's';
      }

      // Canvas feux d'artifice (sur tout le root)
      this.fxCanvas = el('canvas', 'ct-fx', root);
      this._resizeCanvas();
      this._onResize = () => this._resizeCanvas();
      window.addEventListener('resize', this._onResize);

      this.dustLayer = el('div', 'ct-dust-layer', root);

      // Badge pourcentage à droite de la cheminée
      this.pctBadge = el('div', 'ct-pct-badge', this.logoBox);
      // position : juste à droite de la base de la cheminée, vers son milieu vertical
      const rightPct = CHIM.botRightXPct + 1.2;
      const midYPct = (CHIM.topYPct + CHIM.botYPct) / 2;
      this.pctBadge.style.left = rightPct + '%';
      this.pctBadge.style.top  = midYPct + '%';
      this.pctBadge.innerHTML = `
        <div class="ct-pct-num">0<span class="ct-pct-sign">%</span></div>
        <div class="ct-pct-label">progression</div>
      `;
      this.pctNum = this.pctBadge.querySelector('.ct-pct-num');
    }

    _trapXAt(y, side) {
      const c = this.chim;
      const t = (y - c.topY) / (c.botY - c.topY);
      if (side === 'left') return c.topLeftX + (c.botLeftX - c.topLeftX) * t;
      return c.topRightX + (c.botRightX - c.topRightX) * t;
    }

    _resizeCanvas() {
      const r = this.root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.fxCanvas.width = r.width * dpr;
      this.fxCanvas.height = r.height * dpr;
      this.fxCanvas.style.width = r.width + 'px';
      this.fxCanvas.style.height = r.height + 'px';
      this.fxCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _placePiece(pieceIdx, animate = true) {
      const piece = this.pieces[pieceIdx];
      const layer = pieceIdx;
      const ch = this.chim;
      const rowBottomY = ch.botY - layer * this.cellH;
      const xLeft = this._trapXAt(rowBottomY, 'left');
      const xRight = this._trapXAt(rowBottomY, 'right');
      const availW = xRight - xLeft;
      const pieceCols = Math.max(...piece.shape.map(s => s[0])) + 1;
      const pieceW = pieceCols * this.cellW;
      const xOffset = xLeft + (availW - pieceW) / 2;

      const g = svgEl('g', { class: 'ct-piece' }, this.tetrisG);
      g.style.setProperty('--rot', piece.rot + 'deg');

      piece.shape.forEach(([cx, cy]) => {
        const bx = xOffset + cx * this.cellW;
        const by = rowBottomY - this.cellH - cy * this.cellH;
        const isAccent = piece.color === RED && Math.random() < 0.18;

        svgEl('rect', {
          x: bx + 0.5, y: by + 0.5,
          width: this.cellW - 1, height: this.cellH - 1,
          fill: piece.color,
          rx: 1.5,
        }, g);
        // highlight haut
        svgEl('rect', {
          x: bx + 1.5, y: by + 1.5,
          width: this.cellW - 3, height: 2,
          fill: 'rgba(255,255,255,0.28)',
        }, g);
        // ombre bas
        svgEl('rect', {
          x: bx + 1.5, y: by + this.cellH - 3.5,
          width: this.cellW - 3, height: 2,
          fill: 'rgba(0,0,0,0.32)',
        }, g);
        if (isAccent) {
          svgEl('rect', {
            x: bx + 0.5, y: by + 0.5,
            width: (this.cellW - 1) * 0.42, height: this.cellH - 1,
            fill: ORANGE,
            opacity: 0.95,
            rx: 1.5,
          }, g);
        }
      });

      if (animate) {
        g.classList.add('ct-piece-fall');
        g.addEventListener('animationend', () => {
          g.classList.add('ct-piece-settled');
          this._spawnDust(rowBottomY);
        }, { once: true });
      } else {
        g.classList.add('ct-piece-settled');
      }

      // contour rouge se révèle
      const op = clamp((pieceIdx + 1) / this.totalBricks, 0, 1) * 0.95;
      this.chimOutline.setAttribute('opacity', op);

      this.bricks.push(g);
    }

    _spawnDust(viewboxY) {
      const rect = this.svg.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();
      const xMid = (this.chim.botLeftX + this.chim.botRightX) / 2;
      const px = (rect.left - rootRect.left) + (xMid / (100 * this.SCALE)) * rect.width;
      const py = (rect.top - rootRect.top) + (viewboxY / ((100 / this.logoAspect) * this.SCALE)) * rect.height;
      for (let i = 0; i < 5; i++) {
        const d = el('div', 'ct-dust', this.dustLayer);
        const dx = (Math.random() - 0.5) * 50;
        const dy = -(8 + Math.random() * 14);
        d.style.left = px + 'px';
        d.style.top = py + 'px';
        d.style.setProperty('--dx', dx + 'px');
        d.style.setProperty('--dy', dy + 'px');
        d.addEventListener('animationend', () => d.remove(), { once: true });
      }
    }

    _removeTopPieces(downTo) {
      while (this.bricks.length > downTo) {
        const p = this.bricks.pop();
        p.classList.add('ct-piece-leave');
        setTimeout(() => p.remove(), 280);
      }
      const op = clamp(downTo / this.totalBricks, 0, 1) * 0.95;
      this.chimOutline.setAttribute('opacity', op);
    }

    /**
     * Met à jour la cheminée selon les cartes complétées.
     * Signature : updateChimney(cardsCompleted, totalCards?)
     *  - cardsCompleted : nombre de cartes réussies (entier)
     *  - totalCards     : total de cartes du jeu (6..20). Si fourni et différent
     *                     du précédent, le nombre de pièces de la cheminée
     *                     est ajusté.
     * Pour rétro-compat, accepte aussi un ratio 0..1 si appelé avec un seul
     * argument flottant ≤ 1.
     */
    updateChimney(cardsCompleted, totalCards) {
      // rétro-compat : updateChimney(0.5)
      if (totalCards == null && typeof cardsCompleted === 'number'
          && cardsCompleted >= 0 && cardsCompleted <= 1
          && !Number.isInteger(cardsCompleted)) {
        totalCards = this.totalCards;
        cardsCompleted = Math.round(cardsCompleted * totalCards);
      }
      cardsCompleted = Math.max(0, Math.floor(Number(cardsCompleted) || 0));
      if (totalCards != null) {
        totalCards = Math.max(1, Math.min(20, Math.floor(Number(totalCards) || 1)));
        if (totalCards !== this.totalCards) {
          this._setTotal(totalCards);
        }
      }
      this.cardsCompleted = Math.min(cardsCompleted, this.totalCards);
      const progress = this.cardsCompleted / this.totalCards;
      this.progress = progress;

      this.skyNight.style.opacity = progress.toFixed(3);
      this.starsLayer.style.opacity = clamp((progress - 0.55) / 0.4, 0, 1);
      this.chimGhost.style.opacity = (Math.max(0, 0.55 - progress * 0.8)).toFixed(2);
      // pourcentage
      const pct = Math.round(progress * 100);
      if (this.pctNum) {
        this.pctNum.firstChild.textContent = pct;
        this.pctBadge.classList.toggle('ct-pct-full', pct >= 100);
      }

      const target = this.cardsCompleted;
      const current = this.bricks.length;
      if (target > current) {
        for (let i = current; i < target; i++) {
          setTimeout(() => this._placePiece(i, true), (i - current) * 200);
        }
      } else if (target < current) {
        this._removeTopPieces(target);
      }
      this.smoke.classList.toggle('ct-smoke-on', progress >= 1);
    }

    /** Reconfigure le nombre total de pièces (6..20) — re-calcule la grille
     *  et vide la cheminée. À utiliser via updateChimney(0, newTotal). */
    _setTotal(N) {
      // vide les briques actuelles
      this.bricks.forEach(b => b.remove());
      this.bricks = [];
      this.totalCards = N;
      this.pieces = buildPieceList(N);
      this.totalBricks = this.pieces.length;
      this.rows = this.totalBricks;
      this.cellH = (this.chim.botY - this.chim.topY) / this.rows;
      this.cardsCompleted = 0;
      this.chimOutline.setAttribute('opacity', 0);
    }

    launchFireworks(duration = 5200) {
      if (this.fireworksRunning) return;
      this.fireworksRunning = true;
      this._resizeCanvas();
      const ctx = this.fxCanvas.getContext('2d');
      const W = this.fxCanvas.clientWidth;
      const H = this.fxCanvas.clientHeight;
      const palette = ['#f3902d', '#b71e1d', '#ffd166', '#ffffff', '#ff5a3d'];
      const rockets = [], particles = [];

      this.root.classList.add('ct-shake');
      setTimeout(() => this.root.classList.remove('ct-shake'), 600);
      const start = performance.now();
      let lastBurst = 0;

      const explode = (x, y, color) => {
        const N = 60 + Math.floor(Math.random() * 30);
        const ringChance = Math.random();
        for (let i = 0; i < N; i++) {
          const angle = (i / N) * Math.PI * 2 + Math.random() * 0.05;
          const sb = ringChance < 0.35 ? 4.5 : (1.5 + Math.random() * 4.5);
          const speed = sb + Math.random() * 0.6;
          particles.push({
            x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 1, decay: 0.012 + Math.random() * 0.012,
            color, size: 2 + Math.random() * 1.5, trail: [],
          });
        }
      };
      // Origine des fusées : le sommet de la cheminée du logo
      // (converti des coordonnées % logo → pixels root)
      const logoRect = this.logoBox.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();
      const chimTopXPct = (CHIM.topLeftXPct + CHIM.topRightXPct) / 2;
      const chimTopXPx = (logoRect.left - rootRect.left) + (chimTopXPct / 100) * logoRect.width;
      const chimTopYPx = (logoRect.top - rootRect.top) + (CHIM.topYPct / 100) * logoRect.height;

      const launchRocket = () => {
        // Toutes les fusées partent du sommet de la cheminée, avec un peu de jitter
        const jitterX = (Math.random() - 0.5) * 14;
        const sx = chimTopXPx + jitterX;
        const sy = chimTopYPx;
        // direction d'éjection vers le haut, avec angle qui ouvre l'éventail
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
        const speed = 9 + Math.random() * 3;
        rockets.push({
          x: sx, y: sy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          targetY: H * (0.10 + Math.random() * 0.28),
          color: palette[Math.floor(Math.random() * palette.length)],
          trail: [],
        });
      };

      // Petit flash blanc au sommet de la cheminée à l'allumage
      const flash = el('div', 'ct-flash', this.root);
      flash.style.left = chimTopXPx + 'px';
      flash.style.top  = chimTopYPx + 'px';
      setTimeout(() => flash.remove(), 700);
      launchRocket(); launchRocket(); launchRocket();

      const tick = (now) => {
        const elapsed = now - start;
        // ne PAS noircir le canvas (sinon le logo disparaît derrière) :
        // on l'efface entièrement et on s'appuie sur les traînées par particule.
        ctx.clearRect(0, 0, W, H);

        if (elapsed < duration - 800 && now - lastBurst > 380) {
          launchRocket();
          if (Math.random() < 0.5) launchRocket();
          lastBurst = now;
        }
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          r.trail.push({ x: r.x, y: r.y });
          if (r.trail.length > 14) r.trail.shift();
          r.x += r.vx; r.y += r.vy; r.vy += 0.10;
          for (let j = 0; j < r.trail.length; j++) {
            const p = r.trail[j], a = j / r.trail.length;
            ctx.fillStyle = `rgba(255,220,150,${a * 0.7})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * a + 0.5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2); ctx.fill();
          // explose au sommet de la trajectoire (quand vy >= 0)
          if (r.y <= r.targetY || r.vy >= -0.5) { explode(r.x, r.y, r.color); rockets.splice(i, 1); }
        }
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.trail.push({ x: p.x, y: p.y });
          if (p.trail.length > 8) p.trail.shift();
          p.x += p.vx; p.y += p.vy;
          p.vy += 0.05; p.vx *= 0.99; p.vy *= 0.99;
          p.life -= p.decay;
          if (p.life <= 0) { particles.splice(i, 1); continue; }
          for (let j = 0; j < p.trail.length; j++) {
            const tp = p.trail[j], a = (j / p.trail.length) * p.life * 0.6;
            ctx.fillStyle = this._hexToRgba(p.color, a);
            ctx.beginPath(); ctx.arc(tp.x, tp.y, p.size * 0.6, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = this._hexToRgba(p.color, p.life);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = this._hexToRgba(p.color, p.life * 0.25);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2); ctx.fill();
        }
        if (elapsed < duration || particles.length || rockets.length) {
          this._raf = requestAnimationFrame(tick);
        } else {
          ctx.clearRect(0, 0, W, H);
          this.fireworksRunning = false;
        }
      };
      this._raf = requestAnimationFrame(tick);
    }

    _hexToRgba(hex, a) {
      const h = hex.replace('#','');
      return `rgba(${parseInt(h.substring(0,2),16)},${parseInt(h.substring(2,4),16)},${parseInt(h.substring(4,6),16)},${a})`;
    }

    destroy() {
      window.removeEventListener('resize', this._onResize);
      if (this._raf) cancelAnimationFrame(this._raf);
      this.root.remove();
    }
  }

  const CSS = `
.ct-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 460px;
  overflow: hidden;
  border-radius: 18px;
  font-family: 'Inter', system-ui, sans-serif;
  isolation: isolate;
  background: #cfe6f5;
}
.ct-sky {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, #cfe6f5 0%, #f7d9b6 60%, #f3c79a 100%);
  z-index: 0;
}
.ct-sky-night {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, #060a1c 0%, #14082a 60%, #1a0a2e 100%);
  opacity: 0;
  transition: opacity 0.8s ease;
  z-index: 0;
}
.ct-stars {
  position: absolute; inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 1.2s ease;
  z-index: 1;
}
.ct-star {
  position: absolute;
  background: #fff;
  border-radius: 50%;
  animation: ct-twinkle 3s ease-in-out infinite;
}
@keyframes ct-twinkle {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
}

/* Conteneur du logo : centré, taille adaptative gardant l'aspect ratio */
.ct-logobox {
  position: absolute;
  /* Centre horizontalement et verticalement, adapte aux 2 contraintes */
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(92%, calc(92vh * 1.213));   /* 1.213 = 1668/1375 */
  height: auto;
  max-height: 92%;
  z-index: 2;
}
.ct-logobox::before {
  /* force l'aspect ratio même si le navigateur ignore aspect-ratio inline */
  content: "";
  display: block;
  padding-top: 82.4%; /* 1375/1668 */
}

/* Image du logo (cheminée d'origine effacée) — par-dessus */
.ct-logo-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  z-index: 3;
}

/* SVG cheminée animée — sous l'image */
.ct-logobox svg { z-index: 2; }

/* bandes blanches incurvées : couleur du ciel + ombre/highlight = relief */
.ct-band {
  fill: #f3c79a;
  transition: fill 0.8s ease;
}
.ct-band-shadow { transition: opacity 0.8s ease; }
.ct-band-hl { transition: opacity 0.8s ease; }

/* pièces Tetris */
.ct-tetris .ct-piece { --rot: 0deg; transform-box: fill-box; }
.ct-piece-fall {
  animation: ct-fall 0.6s cubic-bezier(.34,1.56,.64,1) both;
  transform-origin: center bottom;
}
@keyframes ct-fall {
  0%   { transform: translateY(-820px) rotate(var(--rot)); opacity: 0; }
  60%  { transform: translateY(12px) rotate(calc(var(--rot) * 0.2)); opacity: 1; }
  82%  { transform: translateY(-4px) rotate(0deg); }
  100% { transform: translateY(0) rotate(0deg); opacity: 1; }
}
.ct-piece-leave {
  animation: ct-leave 0.28s ease-in forwards;
}
@keyframes ct-leave { to { transform: translateY(60px); opacity: 0; } }

/* Fumée */
.ct-smoke {
  position: absolute;
  width: 50px; height: 90px;
  pointer-events: none;
  z-index: 4;
  transform: translate(-50%, -100%);
  opacity: 0;
  transition: opacity 0.6s ease;
}
.ct-smoke-on { opacity: 1; }
.ct-smoke-puff {
  position: absolute;
  bottom: 0; left: 50%;
  width: 16px; height: 16px;
  background: radial-gradient(circle, rgba(220,220,220,0.65), rgba(220,220,220,0));
  border-radius: 50%;
  animation: ct-smoke-rise 3.5s ease-out infinite;
}
@keyframes ct-smoke-rise {
  0%   { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
  20%  { opacity: 0.7; }
  100% { transform: translate(-50%, -140px) scale(2.4); opacity: 0; }
}

/* Poussière */
.ct-dust-layer { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.ct-dust {
  position: absolute;
  width: 5px; height: 5px;
  background: rgba(255, 220, 180, 0.55);
  border-radius: 50%;
  --dx: 0px; --dy: -20px;
  animation: ct-dust 0.7s ease-out forwards;
}
@keyframes ct-dust {
  0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0.9; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.3); opacity: 0; }
}

/* Feux d'artifice */
.ct-fx { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.ct-shake { animation: ct-shake 0.55s ease-in-out; }
@keyframes ct-shake {
  0%, 100% { transform: translate(0,0); }
  20% { transform: translate(-3px, 1px); }
  40% { transform: translate(3px, -2px); }
  60% { transform: translate(-2px, 2px); }
  80% { transform: translate(2px, -1px); }
}

/* Flash d'allumage au sommet de la cheminée */
.ct-flash {
  position: absolute;
  width: 60px; height: 60px;
  margin: -30px 0 0 -30px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,200,0.95), rgba(255,180,80,0.5) 40%, rgba(255,180,80,0));
  pointer-events: none;
  z-index: 6;
  animation: ct-flash-anim 0.7s ease-out forwards;
}
@keyframes ct-flash-anim {
  0%   { transform: scale(0.2); opacity: 1; }
  60%  { transform: scale(1.6); opacity: 0.9; }
  100% { transform: scale(2.6); opacity: 0; }
}

/* Badge pourcentage à droite de la cheminée */
.ct-pct-badge {
  position: absolute;
  z-index: 5;
  transform: translate(0, -50%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  pointer-events: none;
  /* léger fond pour lisibilité sur ciel */
  padding: 8px 14px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.78);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.08), 0 0 0 1px rgba(183,30,29,0.12);
  transition: background 0.6s ease, box-shadow 0.6s ease, color 0.6s ease;
}
.ct-pct-num {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 800;
  font-size: clamp(28px, 5.5cqw, 56px);
  line-height: 0.95;
  letter-spacing: -0.04em;
  color: #b71e1d;
  font-variant-numeric: tabular-nums;
}
.ct-pct-sign {
  font-size: 0.55em;
  font-weight: 700;
  margin-left: 2px;
  color: #f3902d;
}
.ct-pct-label {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: clamp(9px, 1.4cqw, 13px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #6c6256;
}
.ct-logobox { container-type: inline-size; }
.ct-pct-full {
  background: linear-gradient(135deg, #b71e1d, #f3902d);
  box-shadow: 0 6px 20px rgba(243,144,45,0.5), 0 0 0 1px rgba(255,255,255,0.2);
}
.ct-pct-full .ct-pct-num,
.ct-pct-full .ct-pct-sign,
.ct-pct-full .ct-pct-label { color: #fff; }

`;

  if (typeof document !== 'undefined') {
    const old = document.getElementById('ct-styles');
    if (old) old.remove();
    const style = document.createElement('style');
    style.id = 'ct-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  global.ChimneyTetris = ChimneyTetris;
})(typeof window !== 'undefined' ? window : this);
