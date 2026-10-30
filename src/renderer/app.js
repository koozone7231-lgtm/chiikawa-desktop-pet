// 펫들을 만들고, 마우스·메뉴·타이머·저장을 묶는 렌더러 진입점.
const api = window.petApi;
const stage = document.getElementById('stage');
const menuEl = document.getElementById('menu');
const nowPlayingEl = document.getElementById('nowPlaying');
const SU = window.ScheduleUtils;

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
  showMusic: true, // 지금 재생 중인 음악 표시
  danceToMusic: true, // 음악이 나오면 춤
  musicCard: true, // 끌어서 옮길 수 있는 음악 카드
  focusCard: true, // 끌어서 옮길 수 있는 집중(뽀모도로) 카드
};
const CHATTER_RATE = { normal: 1, less: 0.35, off: 0 };

const world = {
  width: window.innerWidth,
  focus: false,
  music: { playing: false, hasSession: false, title: '', artist: '', app: '' },
  get isNight() {
    const h = new Date().getHours();
    return h >= 0 && h < 6;
  },
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
let pomodoro = null; // { phase: 'focus'|'rest', endsAt(ms), totalMs }
let cardPos = {}; // 카드 위치 { music: {x, y}, focus: {x, y} } — 저장됨
let schedules = []; // 메인이 schedules.json에 저장하는 일정의 사본
let briefDay = null; // 하루 한 번 아침 일정 안내를 한 날짜
const firedReminders = new Set(); // 이미 알려 준 일정 알림 (id|날짜|10분 전/정각)
const pairCooldown = new Map();

// ---------- 시작 ----------
(async function init() {
  const saved = (await api.loadState()) || {};
  coins = Number.isFinite(saved.coins) ? saved.coins : 30;
  schedules = (await api.getSchedules()) || [];
  settings = { ...settings, ...((await api.getSettings()) || {}) };
  briefDay = saved.briefDay || null;
  cardPos = saved.cards || {};
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
  setTimeout(briefToday, 5000);
  onMusicState((await api.getMusicState()) || world.music);
  requestAnimationFrame(loop);
  setInterval(minuteTick, 60_000);
  setInterval(checkReminders, 20_000);
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

// 하루 처음 켰을 때 오늘 일정을 읽어 준다
function briefToday() {
  const today = SU.dateStr();
  if (briefDay === today) return;
  const items = SU.itemsOn(schedules, today).filter((s) => !SU.isDone(s, today));
  briefDay = today;
  save();
  if (!items.length) return;
  const first = items[0];
  const p = randomVisiblePet();
  if (p) p.cheer(`오늘 일정 ${items.length}개!\n${first.time ? first.time + ' ' : ''}${first.title}${items.length > 1 ? ' 외' : ''}`, 6000);
}

// 시간 정한 일정: 10분 전과 정각에 펫이 알려 준다
function checkReminders() {
  const now = new Date();
  const today = SU.dateStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const s of SU.itemsOn(schedules, today)) {
    if (!s.time || SU.isDone(s, today)) continue;
    const [h, m] = s.time.split(':').map(Number);
    const diff = h * 60 + m - nowMin;
    let kind = null;
    if (diff <= 10 && diff > 8) kind = 'soon';
    else if (diff <= 0 && diff > -2) kind = 'now';
    if (!kind) continue;
    const key = `${s.id}|${today}|${kind}`;
    if (firedReminders.has(key)) continue;
    firedReminders.add(key);
    const p = randomVisiblePet();
    if (p) p.cheer(kind === 'soon' ? `10분 뒤 '${s.title}'이야!` : `'${s.title}' 시간이야!`, 8000);
  }
}

// 지금 재생 중인 음악: 화면 왼쪽 아래 작은 표시 + 곡이 바뀌면 펫이 알려 줌
function onMusicState(m) {
  const prev = world.music;
  world.music = m;
  const show = settings.showMusic && !settings.musicCard && m.hasSession && m.title;
  nowPlayingEl.classList.toggle('hidden', !show);
  nowPlayingEl.classList.toggle('paused', !m.playing);
  if (show) nowPlayingEl.textContent = `${m.playing ? '♪' : '⏸'} ${m.title}${m.artist ? ' · ' + m.artist : ''}`;
  if (settings.showMusic && m.playing && m.title && m.title !== prev.title) {
    const p = randomVisiblePet();
    if (p && !world.focus) p.say(`♪ ${m.title}`, 3500, true);
  }
  // 음악이 멈추면 춤추던 친구들은 춤을 멈춘다
  if (!m.playing) for (const p of pets) if (p.state === 'dance') p.stateLeft = Math.min(p.stateLeft, 0.5);
  if (openMenuPet && menuTab === 'music') renderMenu();
  renderCards();
}

// ---------- 끌어서 옮기는 카드 (음악 · 집중) ----------
const cards = {};
for (const id of ['music', 'focus']) {
  const el = document.createElement('div');
  el.className = 'card-widget hidden';
  el.dataset.card = id;
  document.body.appendChild(el);
  cards[id] = el;
}

function defaultCardPos(id) {
  return id === 'music' ? { x: 16, y: window.innerHeight - 230 } : { x: window.innerWidth - 250, y: 16 };
}

function placeCard(id) {
  const el = cards[id];
  const pos = cardPos[id] || defaultCardPos(id);
  const x = clamp(pos.x, 0, Math.max(0, window.innerWidth - el.offsetWidth));
  const y = clamp(pos.y, 0, Math.max(0, window.innerHeight - el.offsetHeight));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// 구조가 바뀔 때만 HTML을 새로 만들고, 1초마다는 글자만 바꾼다 (누르는 중인 버튼이 사라지지 않게)
function setCardMode(el, mode, html) {
  if (el.dataset.mode === mode) return;
  el.dataset.mode = mode;
  el.innerHTML = html;
}

const fill = (el, field, text) => {
  const f = el.querySelector(`[data-f="${field}"]`);
  if (f && f.textContent !== text) f.textContent = text;
};

function renderCards() {
  // 음악 카드
  const mc = cards.music;
  const m = world.music;
  const showMusic = settings.showMusic && settings.musicCard && m.hasSession && m.title;
  mc.classList.toggle('hidden', !showMusic);
  if (showMusic) {
    setCardMode(mc, 'music', `
      <div class="card-head" data-drag><span>🎵 지금 재생</span><button class="x" data-card-act="close-music" title="카드 닫기">✕</button></div>
      <div class="card-music">
        <div class="disc">💿</div>
        <div class="meta"><b data-f="title"></b><span data-f="artist"></span><small data-f="app"></small></div>
      </div>
      <div class="card-btns">
        <button data-card-act="music" data-cmd="prev" title="이전">⏮</button>
        <button data-card-act="music" data-cmd="toggle" data-f="toggle" title="재생 / 일시 정지"></button>
        <button data-card-act="music" data-cmd="next" title="다음">⏭</button>
      </div>`);
    fill(mc, 'title', m.title);
    fill(mc, 'artist', m.artist || '');
    fill(mc, 'app', `${m.app || ''}${m.app ? ' · ' : ''}${m.playing ? '재생 중' : '일시 정지'}`);
    fill(mc, 'toggle', m.playing ? '⏸' : '▶');
    mc.querySelector('.disc').classList.toggle('spin', !!m.playing);
    placeCard('music');
  }

  // 집중 카드
  const fc = cards.focus;
  fc.classList.toggle('hidden', !settings.focusCard);
  if (settings.focusCard) {
    if (pomodoro) {
      setCardMode(fc, 'running', `
        <div class="card-head" data-drag><span data-f="phase"></span><button class="x" data-card-act="close-focus" title="카드 닫기">✕</button></div>
        <div class="card-timer" data-f="time"></div>
        <div class="card-bar"><div data-f="bar"></div></div>
        <div class="card-btns">
          <button data-card-act="skip" data-f="skip"></button>
          <button data-card-act="stop">⏹ 그만하기</button>
        </div>`);
      const left = pomoLeftMs();
      const mm = String(Math.floor(left / 60000)).padStart(2, '0');
      const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      fill(fc, 'phase', pomodoro.phase === 'focus' ? '📖 집중하는 중' : '☕ 쉬는 중');
      fill(fc, 'time', `${mm}:${ss}`);
      fill(fc, 'skip', pomodoro.phase === 'focus' ? '☕ 바로 쉬기' : '📖 바로 집중');
      fc.querySelector('[data-f="bar"]').style.width = `${100 - (left / pomodoro.totalMs) * 100}%`;
      fc.classList.toggle('rest', pomodoro.phase === 'rest');
    } else {
      setCardMode(fc, 'idle', `
        <div class="card-head" data-drag><span>📖 집중</span><button class="x" data-card-act="close-focus" title="카드 닫기">✕</button></div>
        <div class="card-idle">집중 모드가 꺼져 있어요</div>
        <div class="card-btns"><button class="primary" data-card-act="start" data-f="start"></button></div>`);
      fill(fc, 'start', `▶ ${settings.pomodoroFocusMin}분 집중 시작`);
      fc.classList.remove('rest');
    }
    placeCard('focus');
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-widget button[data-card-act]');
  if (!btn) return;
  const act = btn.dataset.cardAct;
  if (act === 'music') api.musicCommand(btn.dataset.cmd);
  else if (act === 'close-music') api.updateSettings({ musicCard: false });
  else if (act === 'close-focus') api.updateSettings({ focusCard: false });
  else if (act === 'start' || act === 'stop') {
    setFocus(act === 'start');
    save();
  } else if (act === 'skip') checkPomodoro(true);
  renderCards();
});

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
    checkPomodoro();
    renderCards();
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

// ---------- 뽀모도로 ----------
function newPhase(phase) {
  const min = phase === 'focus' ? settings.pomodoroFocusMin : settings.pomodoroRestMin;
  return { phase, endsAt: Date.now() + min * 60000, totalMs: min * 60000 };
}

function pomoLeftMs() {
  return pomodoro ? Math.max(0, pomodoro.endsAt - Date.now()) : 0;
}

// 1초마다: 시간이 다 되면 집중 ↔ 휴식을 바꾸고 펫이 알려 준다
function checkPomodoro(skip = false) {
  if (!pomodoro || (!skip && Date.now() < pomodoro.endsAt)) return;
  const toRest = pomodoro.phase === 'focus';
  pomodoro = newPhase(toRest ? 'rest' : 'focus');
  const p = pets.find((q) => q.id === 'hachiware' && q.enabled) || randomVisiblePet();
  if (p) p.cheer(toRest ? `${settings.pomodoroFocusMin}분 끝! ${settings.pomodoroRestMin}분 쉬자~` : '다시 집중해볼까?', 6000);
  if (toRest && !skip) coins += 3;
}

function minuteTick() {
  activeMin++;
  sinceCoinMin++;
  if (sinceCoinMin >= COIN_EVERY_MIN) {
    sinceCoinMin = 0;
    coins += 1; // 토벌 보상
  }

  if (pomodoro) return; // 집중 모드 중엔 휴식 알림·혼잣말 응원 없음

  sinceBreakMin++;
  if (settings.breakEveryMin > 0 && sinceBreakMin >= settings.breakEveryMin) {
    sinceBreakMin = 0;
    const p = randomVisiblePet();
    if (p) p.cheer(`${settings.breakEveryMin}분 지났어! 좀 쉬자~`, 6000);
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
    briefDay,
    cards: cardPos,
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

const drag = { pet: null, card: null, startX: 0, startY: 0, offX: 0, offY: 0, moved: false, samples: [] };
const rub = { pet: null, lastX: 0, lastDir: 0, flips: [] };

function petFromEvent(e) {
  const el = e.target.closest && e.target.closest('.pet');
  return el ? pets.find((p) => p.id === el.dataset.id) : null;
}

// 잡고 있는 동안 커서 위치로 펫을 옮긴다. 창 이벤트(pointermove)와 메인이 직접 읽어 주는
// 커서 좌표(drag-move) 둘 다 여기로 온다. 투명 창은 커서가 펫을 벗어나면 Windows가
// 마우스 이벤트를 안 보내 줄 때가 있어서, 메인 쪽 좌표가 있어야 빨리 끌어도 따라온다.
function dragTo(x, y) {
  if (drag.card) {
    cardPos[drag.card] = { x: Math.round(x - drag.offX), y: Math.round(y - drag.offY) };
    placeCard(drag.card);
    return;
  }
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
  if (drag.pet || drag.card) dragTo(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (drag.pet || drag.card) return;
  const overMenu = e.target.closest && e.target.closest('#menu, .card-widget');
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

// 카드는 머리줄(제목 부분)을 잡고 끌어서 옮긴다
document.addEventListener('pointerdown', (e) => {
  const head = e.target.closest('.card-widget [data-drag]');
  if (!head || e.button !== 0 || e.target.closest('button')) return;
  const el = head.closest('.card-widget');
  e.preventDefault();
  try {
    el.setPointerCapture(e.pointerId);
  } catch {}
  setIgnore(false);
  api.dragStart();
  const r = el.getBoundingClientRect();
  drag.card = el.dataset.card;
  drag.offX = e.clientX - r.left;
  drag.offY = e.clientY - r.top;
  el.classList.add('dragging');
});

function endDrag() {
  if (drag.card) {
    cards[drag.card].classList.remove('dragging');
    drag.card = null;
    api.dragEnd();
    save();
    return;
  }
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
document.addEventListener('lostpointercapture', () => setTimeout(endDrag, 0));

stage.addEventListener('contextmenu', (e) => {
  const pet = petFromEvent(e);
  if (!pet) return;
  e.preventDefault();
  openMenu(pet);
});

// ---------- 펫 메뉴 ----------
let openMenuPet = null;
let menuTab = 'schedule'; // 'schedule' | 'music' | 'play'
let menuCloseTimer = null;

function openMenu(pet) {
  if (openMenuPet && openMenuPet !== pet) openMenuPet.unpause();
  openMenuPet = pet;
  menuTab = 'schedule';
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

function renderSchedulePanel() {
  const today = SU.dateStr();
  const items = SU.itemsOn(schedules, today);
  const list = items.length
    ? items
        .map((s) => {
          const done = SU.isDone(s, today);
          return `<button class="sch ${done ? 'done' : ''}" data-act="sch-done" data-id="${escapeHtml(s.id)}" title="눌러서 완료 표시">
            <span class="chk">${done ? '✓' : ''}</span>
            <span class="tm">${s.time || '종일'}</span>
            <span class="nm">${escapeHtml(s.title)}</span>
          </button>`;
        })
        .join('')
    : '<div class="empty">오늘 일정이 없어요</div>';
  const next = SU.upcoming(schedules, today, 7).slice(0, 3);
  const upcoming = next.length
    ? '<div class="label">다가오는 일정</div>' +
      next.map(({ day, item }) => `<div class="up"><span>${SU.dayLabel(day, today)} ${item.time || ''}</span><b>${escapeHtml(item.title)}</b></div>`).join('')
    : '';
  return `
    <div class="label">오늘 · ${SU.dayLabel(today, '')}</div>
    <div class="sch-list">${list}</div>
    ${upcoming}
    <button class="edit" data-act="settings" data-tab="schedule">📅 일정 추가·편집</button>`;
}

function renderMusicPanel() {
  const m = world.music;
  if (m.supported === false) return '<div class="empty">이 PC에서는 음악 정보를 읽을 수 없어요</div>';
  if (!m.hasSession || !m.title) {
    return '<div class="empty">지금 재생 중인 음악이 없어요<br><small>Spotify·멜론·YouTube 등을 틀면 여기에 보여요</small></div>';
  }
  return `
    <div class="music">
      <div class="disc ${m.playing ? 'spin' : ''}">💿</div>
      <div class="meta">
        <b>${escapeHtml(m.title)}</b>
        <span>${escapeHtml(m.artist || '')}</span>
        <small>${escapeHtml(m.app || '')} · ${m.playing ? '재생 중' : '일시 정지'}</small>
      </div>
    </div>
    <div class="row">
      <button data-act="music" data-cmd="prev">⏮<small>이전</small></button>
      <button data-act="music" data-cmd="toggle">${m.playing ? '⏸<small>일시 정지</small>' : '▶<small>재생</small>'}</button>
      <button data-act="music" data-cmd="next">⏭<small>다음</small></button>
    </div>`;
}

function renderPlayPanel(p) {
  const s = p.stats;
  const sleeping = p.state === 'sleep';
  const pomo = pomodoro
    ? `<div class="pomo">${pomodoro.phase === 'focus' ? '📖 집중' : '☕ 휴식'} · ${Math.ceil(pomoLeftMs() / 60000)}분 남음</div>`
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
    </div>
    ${p.poseKeys.length ? `<div class="label">포즈 (그림 바꾸기)</div>
    <div class="row poses">
      ${p.poseKeys.map((k) => `<button data-act="pose" data-key="${k}" ${world.focus ? 'class="off"' : ''}>${POSE_LABELS[k]}</button>`).join('')}
    </div>` : ''}`;
}

function renderMenu() {
  const p = openMenuPet;
  if (!p) return;
  const level = Math.floor(p.stats.affinity / 20) + 1;
  const tab = (id, label) => `<button class="tab ${menuTab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${label}</button>`;
  menuEl.innerHTML = `
    <div class="head"><b>${p.def.name}</b><span class="lv">Lv.${level} ♥${p.stats.affinity}</span><button class="x" data-act="close">✕</button></div>
    <div class="tabs">${tab('schedule', '📅 일정')}${tab('music', '🎵 음악')}${tab('play', '🎈 놀아주기')}</div>
    <div class="panel">${menuTab === 'play' ? renderPlayPanel(p) : menuTab === 'music' ? renderMusicPanel() : renderSchedulePanel()}</div>`;
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
  } else if ((act === 'ball' || act === 'jump' || act === 'sleep' || act === 'pose') && world.focus) {
    p.say('집중 끝나고 놀자!', 1800, true);
  } else if (act === 'pose') {
    closeMenu();
    p.pose(btn.dataset.key);
    return;
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
  } else if (act === 'sch-done') {
    const today = SU.dateStr();
    const item = schedules.find((s) => s.id === btn.dataset.id);
    if (item && !SU.isDone(item, today)) {
      p.cheer('잘했어!', 1800);
      p.stats.affinity += 1;
      coins += 1;
    }
    api.toggleScheduleDone(btn.dataset.id, today);
  } else if (act === 'music') {
    api.musicCommand(btn.dataset.cmd);
  } else if (act === 'settings') {
    api.openSettings(btn.dataset.tab);
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
  pomodoro = on ? newPhase('focus') : null;
  renderCards();
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
    onMusicState(world.music);
    renderCards();
    return;
  } else if (cmd === 'save-now') {
    save();
    return;
  } else if (cmd === 'update-ready') {
    const p = randomVisiblePet();
    if (p) p.say(`새 버전 v${payload}이 왔어!\n트레이에서 설치할 수 있어`, 6000, true);
    return;
  } else if (cmd === 'schedules-changed') {
    schedules = payload || [];
    if (openMenuPet) renderMenu();
    return;
  } else if (cmd === 'music-state') {
    onMusicState(payload);
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
