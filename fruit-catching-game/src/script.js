(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // ---- Settings ----
  const MAX_MISSES = 5;          // game ends after this many missed fruits
  const FRUITS = ['🍎', '🍌', '🍇', '🍊', '🍓', '🍉', '🍐', '🍒'];
  const BASE_BASKET_W = 90, BASKET_H = 40, BASE_BASKET_SPEED = 480; // px per second

  // Special golden fruit
  const SPECIAL_EMOJI = '🍍';
  const SPECIAL_POINTS = 5;       // points for catching it
  const SPECIAL_FIRST_DELAY = 10; // seconds before the first one appears
  const SPECIAL_MIN_GAP = 8, SPECIAL_MAX_GAP = 14; // seconds between later ones

  // ---- Shop items ----
  // cost(level) = price of the next purchase; max = how many times it can be bought
  const SHOP_ITEMS = [
    { id: 'heal',   name: 'Heal a heart',  desc: 'Remove one miss',               max: Infinity, cost: () => 15,
      needed: () => misses > 0, notNeededLabel: 'No misses',
      apply: () => { misses--; } },
    { id: 'wide',   name: 'Wider basket',  desc: '+20 px width',                  max: 3, cost: l => 20 + 15 * l,
      apply: () => { basket.w += 20; basket.x = Math.max(0, Math.min(W - basket.w, basket.x - 10)); } },
    { id: 'fast',   name: 'Faster basket', desc: '+15% move speed',               max: 3, cost: l => 20 + 15 * l,
      apply: () => { speedMul += 0.15; } },
    { id: 'magnet', name: 'Fruit magnet',  desc: 'Pulls nearby fruit to you',     max: 1, cost: () => 40,
      apply: () => { magnet = true; } },
    { id: 'slow',   name: 'Slow motion',   desc: 'Fruit falls at half speed, 10s', max: Infinity, cost: () => 25,
      apply: () => { slowTimer += 10; } }
  ];
  const SHOP_BTN = { x: 14, y: 46, w: 112, h: 30 };
  const ROW = { x: 40, y0: 128, w: 400, h: 60, gap: 8 };
  const CLOSE_BTN = { x: 140, y: 500, w: 200, h: 44 };

  // Special power-up: "Fruit Vacuum" instantly catches every fruit on screen
  const POWER_COOLDOWN = 25;  // seconds to recharge after use
  const POWER_START_CD = 15;  // seconds before it's ready at the start of a run
  const POWER_BTN = { x: 14, y: 84, w: 112, h: 30 };

  // ---- State ----
  let basket, fruits, score, points, misses, best, spawnTimer, specialTimer, elapsed;
  let state, keys, lastTime, speedMul, magnet, slowTimer, levels, shopMsg;
  let powerCD, blast, popups;
  best = Number(localStorage.getItem('fruitCatcherBest') || 0);
  keys = {};

  function reset() {
    basket = { x: W / 2 - BASE_BASKET_W / 2, y: H - 70, w: BASE_BASKET_W };
    fruits = [];
    score = 0;      // total points earned this run (used for best score)
    points = 0;     // spendable points
    misses = 0;
    spawnTimer = 0;
    specialTimer = SPECIAL_FIRST_DELAY;
    elapsed = 0;
    speedMul = 1;
    magnet = false;
    slowTimer = 0;
    levels = {};
    shopMsg = '';
    powerCD = POWER_START_CD;
    blast = null;
    popups = [];
    state = 'playing';
  }

  function spawnFruit(special = false) {
    const size = special ? 44 : 36;
    const vy = 150 + Math.random() * 80 + elapsed * 4; // gets faster over time
    fruits.push({
      x: Math.random() * (W - size) + size / 2,
      y: -size,
      size,
      vy: special ? vy * 1.3 : vy, // special fruit falls faster
      special,
      emoji: special ? SPECIAL_EMOJI : FRUITS[Math.floor(Math.random() * FRUITS.length)]
    });
  }

  // ---- Shop logic ----
  function itemStatus(item) {
    const level = levels[item.id] || 0;
    if (level >= item.max) return { ok: false, label: 'MAX' };
    if (item.needed && !item.needed()) return { ok: false, label: item.notNeededLabel };
    const cost = item.cost(level);
    return { ok: points >= cost, label: cost + ' pts', cost };
  }

  function buyItem(i) {
    const item = SHOP_ITEMS[i];
    if (!item) return;
    const st = itemStatus(item);
    if (st.ok) {
      points -= st.cost;
      levels[item.id] = (levels[item.id] || 0) + 1;
      item.apply();
      shopMsg = 'Bought: ' + item.name;
    } else if (st.label === 'MAX' || st.label === item.notNeededLabel) {
      shopMsg = item.name + ': ' + (st.label === 'MAX' ? 'already maxed' : 'not needed right now');
    } else {
      shopMsg = 'Not enough points for ' + item.name;
    }
  }

  function openShop() { state = 'shop'; keys = {}; shopMsg = ''; }
  function closeShop() { state = 'playing'; keys = {}; }

  // ---- Power-up ----
  function usePower() {
    if (powerCD > 0) return;
    if (fruits.length === 0) {
      popups.push({ x: basket.x + basket.w / 2, y: basket.y - 20, text: 'No fruit!', t: 0 });
      return;
    }
    let total = 0;
    for (const f of fruits) {
      const gain = f.special ? SPECIAL_POINTS : 1;
      total += gain;
      popups.push({ x: f.x, y: f.y, text: '+' + gain, t: 0 });
    }
    fruits = [];
    score += total;
    points += total;
    powerCD = POWER_COOLDOWN;
    blast = { x: basket.x + basket.w / 2, y: basket.y, t: 0 };
  }

  // ---- Update ----
  function update(dt) {
    elapsed += dt;
    if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - dt);
    if (powerCD > 0) powerCD = Math.max(0, powerCD - dt);
    if (blast) { blast.t += dt; if (blast.t > 0.5) blast = null; }
    for (const p of popups) p.t += dt;
    popups = popups.filter(p => p.t < 0.9);

    // Basket movement
    let dir = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) dir -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) dir += 1;
    basket.x += dir * BASE_BASKET_SPEED * speedMul * dt;
    basket.x = Math.max(0, Math.min(W - basket.w, basket.x));

    // Spawning: interval shrinks as time passes
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnFruit();
      spawnTimer = Math.max(0.35, 1.1 - elapsed * 0.012);
    }

    // Special fruit timer
    specialTimer -= dt;
    if (specialTimer <= 0) {
      spawnFruit(true);
      specialTimer = SPECIAL_MIN_GAP + Math.random() * (SPECIAL_MAX_GAP - SPECIAL_MIN_GAP);
    }

    const fallMul = slowTimer > 0 ? 0.5 : 1;

    // Fruits
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      f.y += f.vy * fallMul * dt;

      // Magnet: nudge nearby fruit toward the basket centre
      if (magnet && f.y > 0 && f.y < basket.y) {
        const dx = basket.x + basket.w / 2 - f.x;
        if (Math.abs(dx) < 150) {
          f.x += Math.sign(dx) * Math.min(Math.abs(dx), 170 * dt);
        }
      }

      const caught =
        f.y + f.size / 2 >= basket.y &&
        f.y - f.size / 2 <= basket.y + BASKET_H * 0.5 &&
        f.x >= basket.x - 6 && f.x <= basket.x + basket.w + 6;

      if (caught) {
        const gain = f.special ? SPECIAL_POINTS : 1;
        score += gain;
        points += gain;
        fruits.splice(i, 1);
      } else if (f.y - f.size / 2 > H) {
        fruits.splice(i, 1);
        if (f.special) continue; // missing the special fruit costs nothing
        misses++;
        if (misses >= MAX_MISSES) {
          state = 'over';
          if (score > best) {
            best = score;
            localStorage.setItem('fruitCatcherBest', best);
          }
        }
      }
    }
  }

  // ---- Drawing ----
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawBasket() {
    const { x, y, w } = basket;
    ctx.fillStyle = '#a0662f';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - 10, y + BASKET_H);
    ctx.lineTo(x + 10, y + BASKET_H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6e4218';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const gx = x + (w / 4) * i;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx + (i - 2) * -2.5, y + BASKET_H);
      ctx.stroke();
    }
    ctx.fillStyle = '#6e4218';
    ctx.fillRect(x - 3, y - 4, w + 6, 8);
    if (magnet) {
      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧲', x + w / 2, y + BASKET_H / 2 + 2);
    }
  }

  function drawShop() {
    ctx.fillStyle = 'rgba(10, 20, 30, 0.82)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('🛒 Shop', W / 2, 50);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('Your points: ' + points, W / 2, 92);

    SHOP_ITEMS.forEach((item, i) => {
      const y = ROW.y0 + i * (ROW.h + ROW.gap);
      const st = itemStatus(item);
      const level = levels[item.id] || 0;

      ctx.fillStyle = st.ok ? '#fffbe6' : '#c9d1d9';
      rr(ROW.x, y, ROW.w, ROW.h, 10);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#1b2a3a';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText((i + 1) + '. ' + item.name, ROW.x + 14, y + 22);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = '#44525f';
      const lvl = item.max !== Infinity && item.max > 1 ? '  (Lv ' + level + '/' + item.max + ')' : '';
      ctx.fillText(item.desc + lvl, ROW.x + 14, y + 44);

      ctx.textAlign = 'right';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillStyle = st.ok ? '#1e7a2e' : (st.label === 'MAX' ? '#555' : '#b3261e');
      ctx.fillText(st.label, ROW.x + ROW.w - 14, y + ROW.h / 2);
    });

    // Message
    ctx.textAlign = 'center';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#9ad1ff';
    ctx.fillText(shopMsg, W / 2, 484);

    // Close button
    ctx.fillStyle = '#6bbf59';
    rr(CLOSE_BTN.x, CLOSE_BTN.y, CLOSE_BTN.w, CLOSE_BTN.h, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('Resume (S / Esc)', CLOSE_BTN.x + CLOSE_BTN.w / 2, CLOSE_BTN.y + CLOSE_BTN.h / 2);

    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#8aa0b3';
    ctx.fillText('Press 1-5 or click an item to buy. The game is paused.', W / 2, 570);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Ground
    ctx.fillStyle = '#6bbf59';
    ctx.fillRect(0, H - 30, W, 30);

    // Fruits
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of fruits) {
      if (f.special) {
        // pulsing golden glow
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 10);
        ctx.save();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 18 + pulse * 14;
        ctx.fillStyle = 'rgba(255, 215, 0, ' + (0.25 + pulse * 0.2) + ')';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.font = f.size + 'px serif';
      ctx.fillText(f.emoji, f.x, f.y);
    }

    drawBasket();

    // Power-up blast ring
    if (blast) {
      const k = blast.t / 0.5;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 215, 0, ' + (1 - k) + ')';
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(blast.x, blast.y, 20 + k * 340, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Floating "+N" popups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px system-ui, sans-serif';
    for (const p of popups) {
      ctx.fillStyle = 'rgba(30, 122, 46, ' + (1 - p.t / 0.9) + ')';
      ctx.fillText(p.text, p.x, p.y - p.t * 40);
    }

    // HUD
    ctx.fillStyle = '#1b2a3a';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Points: ' + points, 14, 12);
    ctx.textAlign = 'right';
    ctx.fillText('Best: ' + best, W - 14, 12);

    // Lives
    ctx.textAlign = 'center';
    ctx.font = '20px serif';
    let hearts = '';
    for (let i = 0; i < MAX_MISSES; i++) hearts += i < MAX_MISSES - misses ? '❤️' : '🖤';
    ctx.fillText(hearts, W / 2, 12);

    // Shop button
    if (state !== 'over') {
      ctx.fillStyle = 'rgba(27, 42, 58, 0.85)';
      rr(SHOP_BTN.x, SHOP_BTN.y, SHOP_BTN.w, SHOP_BTN.h, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🛒 Shop (S)', SHOP_BTN.x + SHOP_BTN.w / 2, SHOP_BTN.y + SHOP_BTN.h / 2 + 1);
    }

    // Power-up button (fills as it recharges, glows gold when ready)
    if (state !== 'over') {
      const ready = powerCD <= 0;
      const frac = ready ? 1 : 1 - powerCD / POWER_COOLDOWN;
      ctx.save();
      if (ready) {
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 8 + 8 * (0.5 + 0.5 * Math.sin(elapsed * 8));
      }
      ctx.fillStyle = 'rgba(27, 42, 58, 0.85)';
      rr(POWER_BTN.x, POWER_BTN.y, POWER_BTN.w, POWER_BTN.h, 8);
      ctx.fill();
      ctx.restore();

      ctx.save();
      rr(POWER_BTN.x, POWER_BTN.y, POWER_BTN.w, POWER_BTN.h, 8);
      ctx.clip();
      ctx.fillStyle = ready ? '#ffd700' : '#4f8fd6';
      ctx.fillRect(POWER_BTN.x, POWER_BTN.y, POWER_BTN.w * frac, POWER_BTN.h);
      ctx.restore();

      ctx.fillStyle = ready ? '#1b2a3a' : '#fff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ready ? '⚡ Power (P)' : '⚡ ' + Math.ceil(powerCD) + 's',
                   POWER_BTN.x + POWER_BTN.w / 2, POWER_BTN.y + POWER_BTN.h / 2 + 1);
    }

    // Slow-motion timer
    if (slowTimer > 0) {
      ctx.fillStyle = '#1b2a3a';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('⏳ Slow ' + slowTimer.toFixed(1) + 's', W - 14, 44);
    }

    if (state === 'shop') drawShop();

    if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.fillText('Game Over', W / 2, H / 2 - 50);
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText('Score: ' + score + '   Best: ' + best, W / 2, H / 2 + 5);
      ctx.font = '18px system-ui, sans-serif';
      ctx.fillText('Press Space / Enter or tap to play again', W / 2, H / 2 + 50);
    }
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - (lastTime || t)) / 1000);
    lastTime = t;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ---- Input ----
  // Keys are matched by physical key (e.code) so they work with any keyboard
  // layout or language (e.g. Arabic) and with Caps Lock on.
  window.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();

    if (state === 'over') {
      if (e.code === 'Space' || e.code === 'Enter') reset();
      return;
    }
    if (e.code === 'KeyS') {
      if (!e.repeat) { if (state === 'playing') openShop(); else closeShop(); }
      return;
    }
    if (state === 'shop') {
      if (e.code === 'Escape') closeShop();
      else {
        const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
        if (m && Number(m[1]) >= 1 && Number(m[1]) <= SHOP_ITEMS.length) buyItem(Number(m[1]) - 1);
      }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Space') {
      if (!e.repeat) usePower();
      return;
    }
    keys[e.code] = true;
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  }
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  function pointerToBasket(p) {
    basket.x = Math.max(0, Math.min(W - basket.w, p.x - basket.w / 2));
  }
  canvas.addEventListener('pointermove', e => {
    if (state === 'playing') pointerToBasket(toCanvas(e));
  });
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e);
    if (state === 'over') { reset(); return; }
    if (state === 'shop') {
      if (inRect(p, CLOSE_BTN)) { closeShop(); return; }
      SHOP_ITEMS.forEach((_, i) => {
        const row = { x: ROW.x, y: ROW.y0 + i * (ROW.h + ROW.gap), w: ROW.w, h: ROW.h };
        if (inRect(p, row)) buyItem(i);
      });
      return;
    }
    if (inRect(p, SHOP_BTN)) { openShop(); return; }
    if (inRect(p, POWER_BTN)) { usePower(); return; }
    pointerToBasket(p);
  });

  reset();
  requestAnimationFrame(loop);
})();