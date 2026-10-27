// 펫들을 만들고, 마우스·메뉴·타이머·저장을 묶는 렌더러 진입점.
const api = window.petApi;
const stage = document.getElementById('stage');
const menuEl = document.getElementById('menu');

const COIN_EVERY_MIN = 5;
const OFFLINE_CAP_MIN = 240;
const OFFLINE_FLOOR = 20; // 오래 꺼 둬도 이 아래로는 안 떨어진다 (벌 주지 않는 육성)
// 설정 창에서 바꾸는 값 (메인이 settings.json에 저장, 바뀌면 settings-changed로 알려줌)
let settings = {
  petSize: 104,
  speed: 1,
  chatter: 'normal',
  breakEveryMin: 50,
  pomodoroFocusMin: 25,
  pomodoroRestMin: 5,
  peekVisible: 0.6, // 집중 모드에서 화면 아래 끝 위로 보이는 몸 높이 비율
  meetings: true,
  petGap: 24, // 캐릭터 사이 간격(px). 0이면 겹쳐 걸어도 됨
};
const CHATTER_RATE = { normal: 1, less: 0.35, off: 0 };

const world = {
  width: window.innerWidth,
  focus: false,
  get isNight() {
    const h = new Date().getHours();
    return h >= 0 && h < 6;
  },
  // 치이카와가 울면 옆에 있던 하치와레가 다정하게 한마디
  // 치이카와가 울면 가까이 있던 다정한 친구(하치와레·헌책방)가 한마디
  onCry(crier) {
    const near = pets
      .filter((p) => p !== crier && p.enabled && !p.busy && p.def.lines.comfort && Math.abs(p.x - crier.x) < 400)
      .sort((a, b) => Math.abs(a.x - crier.x) - Math.abs(b.x - crier.x))[0];
    if (near) setTimeout(() => near.say(near.line('comfort'), 2600, true), 900);
  },
  // 집중 모드 자리: 화면 아래 오른쪽에 나란히, 얼굴만 아래 끝 위로 내민다
  peekSpot(pet) {
    // 오른쪽 끝에서부터 각자 너비 + 설정한 간격만큼 왼쪽으로 줄을 선다
    const visible = pets.filter((p) => p.enabled);
    const i = Math.max(0, visible.indexOf(pet));
    let right = this.width - 30;
    for (let j = 0; j < i; j++) right -= visible[j].w + settings.petGap;
    return {
      x: right - pet.w,
      y: window.innerHeight + pet.h * (1 - settings.peekVisible),
    };
  },
  // 걷는 방향 앞쪽에 간격보다 가까이 있는 친구가 있으면 true (부딪히지 않고 돌아서게)
  blocked(pet) {
    if (settings.petGap <= 0) return false;
    return pets.some((o) => {
      if (o === pet || !o.enabled || !o.grounded || o.state === 'peek') return false;
      const ahead = pet.dir > 0 ? o.x + o.w / 2 > pet.x + pet.w / 2 : o.x + o.w / 2 < pet.x + pet.w / 2;
      if (!ahead) return false;
      const gap = pet.dir > 0 ? o.x - (pet.x + pet.w) : pet.x - (o.x + o.w);
      return gap < settings.petGap;
    });
  },
};

let pets = [];
let coins = 30;
let activeMin = 0;
let sinceBreakMin = 0;
let sinceCoinMin = 0;
let pomodoro = null; // { phase: 'focus'|'rest', leftMin }
let shortcuts = []; // 메인이 관리하는 목록의 사본 (실행은 id로 요청)
const pairCooldown = new Map();

// ---------- 시작 ----------
(async function init() {
  const saved = (await api.loadState()) || {};
  coins = Number.isFinite(saved.coins) ? saved.coins : 30;
  shortcuts = (await api.getShortcuts()) || [];
  settings = { ...settings, ...((await api.getSettings()) || {}) };
  const enabled = saved.enabled || {};

  let onCount = 0;
  pets = Object.entries(CHARACTERS).map(([id, def], i) => {
    const p = new Pet(id, def, stage, saved.pets && saved.pets[id]);
    if (!(saved.pets && saved.pets[id])) p.x = 80 + (i % 5) * 180;
    // 저장된 적 없는 캐릭터(새로 추가된 친구)는 기본 3명만 켜고, 바탕화면엔 최대 5마리
    const want = id in enabled ? enabled[id] : DEFAULT_ON.includes(id);
    if (want && onCount < MAX_ON_DESKTOP) onCount++;
    else p.setEnabled(false);
    return p;
  });

  applySettings();
  applyOfflineDecay(saved.lastSeen);
  if (saved.focus) setFocus(true);

  setTimeout(greet, 1500);
  requestAnimationFrame(loop);
  setInterval(minuteTick, 60_000);
  setInterval(save, 30_000);
  window.addEventListener('beforeunload', save);
})();

function applySettings() {
  for (const p of pets) p.setSize(settings.petSize);
}

function applyOfflineDecay(lastSeen) {
  if (!lastSeen) return;
  const minutes = Math.min((Date.now() - lastSeen) / 60000, OFFLINE_CAP_MIN);
  for (const p of pets) {
    const before = { ...p.stats };
    p.tickStats(minutes, world);
    for (const k of ['hunger', 'mood']) p.stats[k] = Math.max(p.stats[k], Math.min(before[k], OFFLINE_FLOOR));
    p.stats.energy = Math.max(p.stats.energy, 60);
  }
}

function greet() {
  const h = new Date().getHours();
  const text =
    h < 6 ? '늦었는데 안 자…?' :
    h < 11 ? '좋은 아침!' :
    h < 14 ? '점심 먹었어?' :
    h < 18 ? '오후도 힘내자!' :
    h < 22 ? '오늘도 수고했어!' : '슬슬 잘 시간이야~';
  const p = randomVisiblePet();
  if (p) p.say(text, 3500, true);
}

function randomVisiblePet() {
  const visible = pets.filter((p) => p.enabled);
  return visible.length ? pick(visible) : null;
}

// ---------- 루프 ----------
let last = performance.now();
let statAcc = 0;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  world.width = window.innerWidth;

  for (const p of pets) p.update(dt, world);

  statAcc += dt;
  if (statAcc >= 1) {
    for (const p of pets) if (p.enabled) p.tickStats(statAcc / 60, world);
    statAcc = 0;
    checkMeetings();
    if (openMenuPet) renderMenu();
  }
  requestAnimationFrame(loop);
}

// 두 펫이 마주치면 가끔 같이 논다
function checkMeetings() {
  if (world.focus || !settings.meetings) return;
  const free = pets.filter((p) => p.enabled && p.grounded && ['walk', 'idle'].includes(p.state));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      const key = `${a.id}:${b.id}`;
      // 서로 간격 거리까지 다가왔을 때 만난 것으로 본다
      const centerDist = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
      if (centerDist > (a.w + b.w) / 2 + settings.petGap + 24) continue;
      if ((pairCooldown.get(key) || 0) > Date.now()) continue;
      pairCooldown.set(key, Date.now() + 90_000);
      if (Math.random() < 0.5) {
        a.meet(b);
        setTimeout(() => b.meet(a), 600);
      }
    }
  }
}

function minuteTick() {
  activeMin++;
  sinceCoinMin++;
  if (sinceCoinMin >= COIN_EVERY_MIN) {
    sinceCoinMin = 0;
    coins += 1; // 토벌 보상
  }

  if (pomodoro) {
    pomodoro.leftMin--;
    if (pomodoro.leftMin <= 0) {
      const toRest = pomodoro.phase === 'focus';
      pomodoro = toRest
        ? { phase: 'rest', leftMin: settings.pomodoroRestMin }
        : { phase: 'focus', leftMin: settings.pomodoroFocusMin };
      const p = pets.find((q) => q.id === 'hachiware' && q.enabled) || randomVisiblePet();
      if (p) p.say(toRest ? `${settings.pomodoroFocusMin}분 끝! ${settings.pomodoroRestMin}분 쉬자~` : '다시 집중해볼까?', 6000, true);
      if (toRest) coins += 3;
    }
    return;
  }

  sinceBreakMin++;
  if (settings.breakEveryMin > 0 && sinceBreakMin >= settings.breakEveryMin) {
    sinceBreakMin = 0;
    const p = randomVisiblePet();
    if (p) p.say(`${settings.breakEveryMin}분 지났어! 좀 쉬자~`, 6000, true);
  } else if (Math.random() < 0.08 * CHATTER_RATE[settings.chatter]) {
    const h = pets.find((q) => q.id === 'hachiware' && q.enabled);
    if (h && !h.busy) h.say(h.line('cheer'), 3000);
  }
}

// ---------- 저장 ----------
function save() {
  const state = {
    coins,
    focus: world.focus,
    enabled: Object.fromEntries(pets.map((p) => [p.id, p.enabled])),
    pets: Object.fromEntries(pets.map((p) => [p.id, p.toJSON()])),
    lastSeen: Date.now(),
  };
  api.saveState(state);
}

// ---------- 마우스: 클릭 통과 전환, 클릭/드래그/쓰다듬기 ----------
let ignoring = true;
function setIgnore(ignore) {
  if (ignore === ignoring) return;
  ignoring = ignore;
  api.setIgnoreMouse(ignore);
}

const drag = { pet: null, startX: 0, startY: 0, offX: 0, offY: 0, moved: false, samples: [] };
const rub = { pet: null, lastX: 0, lastDir: 0, flips: [] };

function petFromEvent(e) {
  const el = e.target.closest && e.target.closest('.pet');
  return el ? pets.find((p) => p.id === el.dataset.id) : null;
}

// 잡고 있는 동안 커서 위치로 펫을 옮긴다. 창 이벤트(pointermove)와 메인이 직접 읽어 주는
// 커서 좌표(drag-move) 둘 다 여기로 온다. 투명 창은 커서가 펫을 벗어나면 Windows가
// 마우스 이벤트를 안 보내 줄 때가 있어서, 메인 쪽 좌표가 있어야 빨리 끌어도 따라온다.
function dragTo(x, y) {
  if (!drag.pet) return;
  const dx = x - drag.startX, dy = y - drag.startY;
  // 집중 모드에서는 들어 옮기지 않는다 (제자리에 가만히)
  if (!drag.moved && !world.focus && Math.hypot(dx, dy) > 6) {
    drag.moved = true;
    drag.pet.grab();
    closeMenu();
  }
  if (drag.moved) {
    drag.pet.x = x - drag.offX;
    drag.pet.y = y - drag.offY;
    drag.samples.push({ x, y, t: performance.now() });
    if (drag.samples.length > 6) drag.samples.shift();
  }
}
api.onDragMove(({ x, y }) => dragTo(x, y));

window.addEventListener('pointermove', (e) => {
  if (drag.pet) dragTo(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (drag.pet) return;
  const overMenu = e.target.closest && e.target.closest('#menu');
  const pet = petFromEvent(e);
  setIgnore(!(pet || overMenu));
  trackRub(pet, e.clientX);
});

// 펫 위에서 마우스를 좌우로 여러 번 문지르면 쓰다듬기
function trackRub(pet, x) {
  if (!pet || pet !== rub.pet) {
    rub.pet = pet;
    rub.lastX = x;
    rub.lastDir = 0;
    rub.flips = [];
    return;
  }
  const dx = x - rub.lastX;
  if (Math.abs(dx) < 4) return;
  const dir = Math.sign(dx);
  rub.lastX = x;
  if (rub.lastDir && dir !== rub.lastDir) {
    const now = performance.now();
    rub.flips = rub.flips.filter((t) => now - t < 1500);
    rub.flips.push(now);
    if (rub.flips.length >= 4) {
      rub.flips = [];
      pet.onPet();
    }
  }
  rub.lastDir = dir;
}

stage.addEventListener('pointerdown', (e) => {
  const pet = petFromEvent(e);
  if (!pet || e.button !== 0) return;
  e.preventDefault();
  // 커서가 펫 밖으로 나가도 놓을 때(pointerup)까지 이벤트를 받도록 붙잡아 둔다
  try {
    pet.el.setPointerCapture(e.pointerId);
  } catch {}
  setIgnore(false);
  api.dragStart();
  drag.pet = pet;
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  drag.offX = e.clientX - pet.x;
  drag.offY = e.clientY - pet.y;
  drag.moved = false;
  drag.samples = [];
});

function endDrag() {
  const pet = drag.pet;
  if (!pet) return;
  drag.pet = null;
  api.dragEnd();
  if (drag.moved) {
    const s = drag.samples;
    let vx = 0, vy = 0;
    if (s.length >= 2) {
      const a = s[0], b = s[s.length - 1];
      const t = Math.max((b.t - a.t) / 1000, 0.016);
      vx = (b.x - a.x) / t;
      vy = (b.y - a.y) / t;
    }
    pet.release(vx * 0.6, vy * 0.6);
  } else {
    // 펫을 누르면 펫이 들고 있는 작은 메뉴가 열린다 (다시 누르면 닫힘)
    if (openMenuPet === pet) closeMenu();
    else openMenu(pet);
  }
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
// 포인터 캡처가 풀렸는데 pointerup을 못 받은 경우에도 펫이 손에 붙어 있지 않게
stage.addEventListener('lostpointercapture', () => setTimeout(endDrag, 0));

// ---------- 숏컷 ----------
async function launch(pet, s) {
  pet.say(`${s.icon || ''} 다녀올게!`.trim(), 1800, true);
  const res = await api.launchShortcut(s.id);
  if (!res.ok) {
    pet.say(`못 열었어…\n${res.error}`, 3500, true);
    return;
  }
  coins += 1;
  pet.stats.affinity += 1;
}

stage.addEventListener('contextmenu', (e) => {
  const pet = petFromEvent(e);
  if (!pet) return;
  e.preventDefault();
  openMenu(pet);
});

// ---------- 펫 메뉴 ----------
let openMenuPet = null;
let menuTab = 'shortcuts'; // 'shortcuts' | 'play'
let menuCloseTimer = null;

function openMenu(pet) {
  if (openMenuPet && openMenuPet !== pet) openMenuPet.unpause();
  openMenuPet = pet;
  menuTab = 'shortcuts';
  pet.pause(); // 메뉴가 열려 있는 동안은 제자리에 서 있는다
  menuEl.classList.remove('hidden');
  renderMenu();
  // 메뉴로 마우스를 옮기지 않으면 잠시 뒤 저절로 닫힌다
  clearTimeout(menuCloseTimer);
  menuCloseTimer = setTimeout(closeMenu, 6000);
}

function closeMenu() {
  if (openMenuPet) openMenuPet.unpause();
  openMenuPet = null;
  clearTimeout(menuCloseTimer);
  menuEl.classList.add('hidden');
}

function positionMenu() {
  const p = openMenuPet;
  if (!p) return;
  const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  const left = clamp(p.x + p.w / 2 - mw / 2, 6, window.innerWidth - mw - 6);
  const top = clamp(p.y - p.h - mh - 46, 6, window.innerHeight - mh - 6);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bar(label, value) {
  const v = Math.round(value);
  const cls = v < 25 ? 'low' : v < 55 ? 'mid' : '';
  return `<div class="stat"><span>${label}</span><div class="track"><div class="fill ${cls}" style="width:${v}%"></div></div><b>${v}</b></div>`;
}

function renderShortcutPanel(p) {
  // 이 펫에 고정한 숏컷을 맨 위로
  const list = [...shortcuts].sort((a, b) => (b.pet === p.id) - (a.pet === p.id));
  const items = list.length
    ? list
        .map(
          (sc) => `<button class="sc" data-act="shortcut" data-id="${escapeHtml(sc.id)}" title="${escapeHtml(sc.target)}">
            <span class="ic">${escapeHtml(sc.icon || (sc.type === 'app' ? '🗂️' : '🌐'))}</span>
            <span class="nm">${escapeHtml(sc.name)}</span>${sc.pet === p.id ? '<span class="pin">★</span>' : ''}
          </button>`
        )
        .join('')
    : '<div class="empty">등록된 숏컷이 없어요</div>';
  return `
    <div class="sc-list">${items}</div>
    <button class="edit" data-act="settings">⚙️ 숏컷 추가·편집</button>`;
}

function renderPlayPanel(p) {
  const s = p.stats;
  const sleeping = p.state === 'sleep';
  const pomo = pomodoro
    ? `<div class="pomo">${pomodoro.phase === 'focus' ? '📖 집중' : '☕ 휴식'} · ${pomodoro.leftMin}분 남음</div>`
    : '';
  return `
    ${bar('배부름', s.hunger)}
    ${bar('기분', s.mood)}
    ${bar('기력', s.energy)}
    <div class="coins">🪙 ${coins} 코인</div>
    ${pomo}
    <div class="label">간식 주기</div>
    <div class="row">
      ${SNACKS.map((sn) => `<button data-act="snack" data-id="${sn.id}" ${coins < sn.price ? 'disabled' : ''}>${sn.icon} ${sn.name}<small>${sn.price}</small></button>`).join('')}
    </div>
    <div class="label">같이 놀기</div>
    <div class="row">
      <button data-act="pet">🤲<small>쓰다듬기</small></button>
      <button data-act="ball" ${world.focus ? 'class="off"' : ''}>⚽<small>공놀이</small></button>
      <button data-act="jump" ${world.focus ? 'class="off"' : ''}>🎵<small>재롱 보기</small></button>
      <button data-act="sleep" ${world.focus ? 'class="off"' : ''}>${sleeping ? '☀️<small>깨우기</small>' : '🌙<small>재우기</small>'}</button>
    </div>`;
}

function renderMenu() {
  const p = openMenuPet;
  if (!p) return;
  const level = Math.floor(p.stats.affinity / 20) + 1;
  const tab = (id, label) => `<button class="tab ${menuTab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${label}</button>`;
  menuEl.innerHTML = `
    <div class="head"><b>${p.def.name}</b><span class="lv">Lv.${level} ♥${p.stats.affinity}</span><button class="x" data-act="close">✕</button></div>
    <div class="tabs">${tab('shortcuts', '🔗 숏컷')}${tab('play', '🎈 놀아주기')}</div>
    <div class="panel">${menuTab === 'play' ? renderPlayPanel(p) : renderShortcutPanel(p)}</div>`;
  positionMenu();
}

menuEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const p = openMenuPet;
  if (!btn || !p) return;
  const act = btn.dataset.act;
  if (act === 'close') return closeMenu();
  if (act === 'tab') {
    menuTab = btn.dataset.tab;
  } else if ((act === 'ball' || act === 'jump' || act === 'sleep') && world.focus) {
    p.say('집중 끝나고 놀자!', 1800, true);
  } else if (act === 'ball') {
    closeMenu();
    playBall(p);
    return;
  } else if (act === 'jump') {
    closeMenu();
    p.onClick();
    return;
  } else if (act === 'snack') {
    const snack = SNACKS.find((s) => s.id === btn.dataset.id);
    if (snack && coins >= snack.price) {
      coins -= snack.price;
      p.feed(snack);
      save();
    }
  } else if (act === 'pet') {
    p.lastPetAt = 0;
    p.onPet();
  } else if (act === 'shortcut') {
    const sc = shortcuts.find((s) => s.id === btn.dataset.id);
    closeMenu();
    if (sc) launch(p, sc);
    return;
  } else if (act === 'settings') {
    api.openSettings('shortcuts');
    closeMenu();
    return;
  } else if (act === 'sleep') {
    if (p.state === 'sleep') p.wake();
    else p.sleep();
  }
  renderMenu();
});

// 공놀이: 화면 바닥 어딘가에 공을 굴리면 펫이 쫓아가서 잡는다
function playBall(p) {
  const minX = 20, maxX = world.width - 60;
  let x = p.x + (Math.random() < 0.5 ? -1 : 1) * rand(220, 480);
  if (x < minX || x > maxX) x = p.x * 2 + p.w / 2 - x; // 반대쪽으로
  x = clamp(x, minX, maxX);

  const ball = document.createElement('div');
  ball.className = 'ball';
  ball.textContent = '⚽';
  ball.style.left = `${x}px`;
  ball.style.setProperty('--from', `${p.x + p.w / 2 - x}px`);
  stage.appendChild(ball);

  p.say('공이다!', 1200, true);
  p.chase(x + 18 - p.w / 2, () => {
    ball.remove();
    p.stats.mood = clamp(p.stats.mood + 12, 0, 100);
    p.stats.energy = clamp(p.stats.energy - 3, 0, 100);
    p.stats.affinity += 2;
    p.setState('happy', 1.8);
    p.say(p.line('play'), 2000, true);
    p.burst('♥', 3, 1100);
  });
  // 혹시 못 잡으면 공은 잠시 뒤 사라진다
  setTimeout(() => ball.remove(), 20000);
}

menuEl.addEventListener('mouseleave', () => {
  clearTimeout(menuCloseTimer);
  menuCloseTimer = setTimeout(closeMenu, 1500);
});
menuEl.addEventListener('mouseenter', () => clearTimeout(menuCloseTimer));

// ---------- 트레이 명령 ----------
function setFocus(on) {
  world.focus = on;
  pomodoro = on ? { phase: 'focus', leftMin: settings.pomodoroFocusMin } : null;
  for (const p of pets) {
    p.quiet = on;
    if (!p.enabled || p.state === 'held') continue;
    if (on) p.enterPeek(world);
    else if (p.state === 'peek') p.leavePeek();
  }
  const h = randomVisiblePet();
  if (h) setTimeout(() => h.say(on ? '여기서 조용히 지켜볼게…' : '집중 끝! 수고했어~', 3000, true), on ? 900 : 0);
}

api.onCommand(({ cmd, payload }) => {
  if (cmd === 'limit-reached') {
    const p = randomVisiblePet();
    if (p) p.say(`바탕화면엔 ${MAX_ON_DESKTOP}마리까지야!\n한 명을 먼저 쉬게 해 줘`, 3500, true);
    return;
  }
  if (cmd === 'set-enabled') {
    const p = pets.find((q) => q.id === payload.id);
    const onCount = pets.filter((q) => q.enabled).length;
    if (p && !(payload.enabled && !p.enabled && onCount >= MAX_ON_DESKTOP)) p.setEnabled(payload.enabled);
    if (openMenuPet === p) closeMenu();
    if (world.focus) for (const q of pets) if (q.enabled && q.grounded) q.chooseNext(world);
  } else if (cmd === 'set-focus') {
    setFocus(payload);
  } else if (cmd === 'settings-changed') {
    settings = { ...settings, ...payload };
    applySettings();
    return;
  } else if (cmd === 'save-now') {
    save();
    return;
  } else if (cmd === 'update-ready') {
    const p = randomVisiblePet();
    if (p) p.say(`새 버전 v${payload}이 왔어!\n트레이에서 설치할 수 있어`, 6000, true);
    return;
  } else if (cmd === 'shortcuts-changed') {
    shortcuts = payload || [];
    if (openMenuPet) renderMenu();
    return;
  } else if (cmd === 'feed-all') {
    const snack = SNACKS[0];
    for (const p of pets.filter((q) => q.enabled)) {
      if (coins < snack.price) {
        p.say('코인이 부족해…', 2000, true);
        break;
      }
      coins -= snack.price;
      p.feed(snack);
    }
  }
  save();
});
