// 설정 창: 왼쪽 탭으로 캐릭터·행동·집중·숏컷·상태·일반 설정을 바꾼다. 바꾸는 즉시 저장된다.
const api = window.petApi;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const PETS = [
  { id: 'chiikawa', name: '치이카와', desc: '소심하지만 노력파' },
  { id: 'hachiware', name: '하치와레', desc: '밝고 긍정적, 노래를 좋아함' },
  { id: 'usagi', name: '우사기', desc: '예측불가 에너지' },
  { id: 'rakko', name: '랏코', desc: '엄격하지만 디저트를 좋아하는 스승님' },
  { id: 'momonga', name: '모몽가', desc: '칭찬받고 싶은 떼쟁이' },
  { id: 'shisa', name: '시사', desc: '성실하고 열정 넘치는 긍정왕' },
  { id: 'kani', name: '헌책방', desc: '수줍지만 다정한 헌책방 주인' },
  { id: 'kurimanju', name: '쿠리만쥬', desc: '여유로운 동네 미식가' },
];
const PET_NAMES = Object.fromEntries(PETS.map((p) => [p.id, p.name]));
const sprite = (id) => `../../assets/sprites/${id}.png`;

let settings = {};
let appState = {};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 탭 ----------
let statusTimer = null;
function showTab(tab) {
  if (!$(`section[data-tab="${tab}"]`)) tab = 'pets';
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('main section').forEach((s) => s.classList.toggle('on', s.dataset.tab === tab));
  clearInterval(statusTimer);
  if (tab === 'status') {
    refreshStatus();
    statusTimer = setInterval(refreshStatus, 3000);
  }
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) showTab(b.dataset.tab);
});
api.onSettingsTab(showTab);

// ---------- 저장 표시 ----------
let savedTimer = null;
function flashSaved() {
  $('#saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('#saved').classList.remove('show'), 1200);
}

// ---------- 일반 설정 값 ↔ 입력 ----------
function formatOutput(key, v) {
  if (key === 'speed') return `${Number(v).toFixed(1)}배`;
  if (key === 'peekVisible') return `${Math.round(v * 100)}%`;
  return `${v}px`;
}

function renderSettings() {
  for (const input of $$('[data-setting]')) {
    const key = input.dataset.setting;
    const v = settings[key];
    if (input.classList.contains('seg')) {
      input.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.value === v));
    } else if (input.type === 'checkbox') {
      input.checked = !!v;
    } else {
      input.value = v;
    }
  }
  for (const out of $$('output[data-for]')) out.textContent = formatOutput(out.dataset.for, settings[out.dataset.for]);
}

let pending = {};
let pendingTimer = null;
function update(key, value) {
  settings[key] = value;
  pending[key] = value;
  const out = $(`output[data-for="${key}"]`);
  if (out) out.textContent = formatOutput(key, value);
  // 슬라이더를 끄는 동안 너무 자주 저장하지 않도록 잠깐 모았다가 보낸다
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    const patch = pending;
    pending = {};
    settings = await api.updateSettings(patch);
    renderSettings();
    flashSaved();
  }, 150);
}

document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.setting;
  if (!key) return;
  if (e.target.type === 'checkbox') update(key, e.target.checked);
  else if (e.target.type === 'range') update(key, Number(e.target.value));
});
document.addEventListener('change', (e) => {
  const key = e.target.dataset && e.target.dataset.setting;
  if (key && e.target.type === 'number') update(key, Number(e.target.value));
});
$$('.seg[data-setting]').forEach((seg) =>
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    update(seg.dataset.setting, b.value);
  })
);

// ---------- 캐릭터 카드 ----------
function renderPetCards() {
  const enabled = appState.enabled || {};
  const max = appState.maxOn || 5;
  const count = PETS.filter((p) => enabled[p.id]).length;
  const full = count >= max;
  $('#petCount').textContent = `바탕화면 ${count} / ${max}마리`;
  $('#petCount').classList.toggle('full', full);
  $('#petCards').innerHTML = PETS.map((p) => {
    const on = !!enabled[p.id];
    const locked = !on && full; // 꽉 찼으면 꺼진 친구는 켤 수 없음
    return `
    <label class="pet-card ${on ? 'on' : ''} ${locked ? 'locked' : ''}" title="${locked ? `최대 ${max}마리까지예요. 다른 친구를 먼저 꺼 주세요` : ''}">
      <img src="${sprite(p.id)}" alt="">
      <b>${p.name}</b>
      <small>${p.desc}</small>
      <span class="switch"><input type="checkbox" data-pet="${p.id}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''}><span></span></span>
    </label>`;
  }).join('');
}
$('#petCards').addEventListener('change', async (e) => {
  const id = e.target.dataset.pet;
  if (!id) return;
  appState = await api.setAppOption('pet', { id, enabled: e.target.checked });
  renderAppState();
  flashSaved();
});

// ---------- 앱 상태 (집중 모드·보이기·자동 실행) ----------
function renderAppState() {
  renderPetCards();
  $('#focusNow').checked = !!appState.focus;
  $('#visible').checked = !!appState.visible;
  $('#autoStart').checked = !!appState.autoStart;
  $('#autoStart').disabled = !appState.isPackaged;
  $('#autoStartNote').textContent = appState.isPackaged
    ? '컴퓨터를 켜면 펫도 같이 켜져요'
    : '설치한 앱에서만 쓸 수 있어요 (지금은 개발 실행 중)';
  $('#dataDir').textContent = appState.dataDir || '';
  $('#about').textContent = `먼작귀 펫 v${appState.version || '-'} · 개인용`;
}
for (const [id, key] of [['#focusNow', 'focus'], ['#visible', 'visible'], ['#autoStart', 'autoStart']]) {
  $(id).addEventListener('change', async (e) => {
    appState = await api.setAppOption(key, e.target.checked);
    renderAppState();
    flashSaved();
  });
}
api.onAppState((s) => {
  appState = s;
  renderAppState();
});

$('#openData').addEventListener('click', () => api.openDataDir());
$('#reset').addEventListener('click', async () => {
  if (!confirm('크기·속도·알림 같은 설정을 기본값으로 되돌릴까요?')) return;
  settings = await api.resetSettings();
  renderSettings();
  flashSaved();
});

// ---------- 업데이트 ----------
function renderUpdate(u) {
  const text = {
    idle: `현재 v${u.current}`,
    checking: '새 버전이 있는지 확인하는 중…',
    downloading: `새 버전 v${u.version} 받는 중… ${u.progress}%`,
    downloaded: `새 버전 v${u.version} 준비 완료! 다시 시작하면 설치돼요 (현재 v${u.current})`,
    latest: `최신 버전이에요 (v${u.current})`,
    error: `확인하지 못했어요: ${u.error || '알 수 없는 오류'}`,
    dev: `개발 실행 중이라 자동 업데이트를 쓰지 않아요 (v${u.current})`,
    portable: `포터블 버전은 자동 업데이트가 안 돼요. 설치 버전을 써 주세요 (v${u.current})`,
  }[u.status] || `현재 v${u.current}`;
  $('#updateText').textContent = text;
  $('#installUpdate').hidden = u.status !== 'downloaded';
  $('#checkUpdate').disabled = ['checking', 'downloading', 'downloaded', 'dev', 'portable'].includes(u.status);
  $('#updateProgress').hidden = u.status !== 'downloading';
  $('#updateProgress div').style.width = `${u.progress || 0}%`;
}
$('#checkUpdate').addEventListener('click', () => api.checkUpdate());
$('#installUpdate').addEventListener('click', () => api.installUpdate());
api.onUpdateState(renderUpdate);

// ---------- 상태 ----------
function bar(label, v) {
  v = Math.round(v);
  const cls = v < 25 ? 'low' : v < 55 ? 'mid' : '';
  return `<div class="stat"><span>${label}</span><div class="track"><div class="fill ${cls}" style="width:${v}%"></div></div><b>${v}</b></div>`;
}

async function refreshStatus() {
  const state = await api.getStatus();
  if (!state) {
    $('#statusCards').innerHTML = '<p class="hint">아직 상태를 받지 못했어요. 펫이 켜져 있는지 확인해 주세요.</p>';
    return;
  }
  $('#coins').textContent = `🪙 ${state.coins} 코인`;
  $('#statusCards').innerHTML = PETS.map((p) => {
    const s = (state.pets[p.id] || {}).stats || {};
    const off = state.enabled && state.enabled[p.id] === false;
    return `
      <div class="status-card ${off ? 'off' : ''}">
        <div class="who"><img src="${sprite(p.id)}" alt=""><div><b>${p.name}</b><small>친밀도 Lv.${Math.floor((s.affinity || 0) / 20) + 1} · ♥${s.affinity || 0}${off ? ' · 쉬는 중' : ''}</small></div></div>
        ${bar('배부름', s.hunger || 0)}
        ${bar('기분', s.mood || 0)}
        ${bar('기력', s.energy || 0)}
      </div>`;
  }).join('');
}
$('#feedAll').addEventListener('click', () => {
  api.petCommand('feed-all');
  setTimeout(refreshStatus, 300);
});

// ---------- 숏컷 ----------
const form = $('#form');
const listEl = $('#list');
const browseBtn = $('#browse');
const submitBtn = $('#submit');
const cancelBtn = $('#cancel');
let shortcuts = [];
let editingId = null;

function syncTypeUi() {
  const isApp = form.type.value === 'app';
  browseBtn.hidden = !isApp;
  form.target.placeholder = isApp ? 'C:\\Program Files\\...\\app.exe' : 'https://mail.google.com';
}

function resetForm() {
  form.reset();
  editingId = null;
  submitBtn.textContent = '추가';
  cancelBtn.hidden = true;
  syncTypeUi();
}

function renderShortcuts() {
  if (!shortcuts.length) {
    listEl.innerHTML = '<li class="empty">아직 숏컷이 없어요</li>';
    return;
  }
  listEl.innerHTML = shortcuts
    .map(
      (s) => `
      <li data-id="${esc(s.id)}">
        <span class="icon">${esc(s.icon || (s.type === 'app' ? '🗂️' : '🌐'))}</span>
        <span class="info">
          <span><b>${esc(s.name)}</b>${s.pet ? `<em>★ ${PET_NAMES[s.pet]}</em>` : ''}</span>
          <small>${esc(s.target)}</small>
        </span>
        <button data-act="run">열기</button>
        <button data-act="edit">수정</button>
        <button data-act="del" class="danger">삭제</button>
      </li>`
    )
    .join('');
}

async function persistShortcuts(next) {
  shortcuts = await api.saveShortcuts(next);
  renderShortcuts();
  flashSaved();
}

form.type.addEventListener('change', syncTypeUi);

browseBtn.addEventListener('click', async () => {
  const file = await api.pickApp();
  if (!file) return;
  form.target.value = file;
  if (!form.name.value) form.name.value = file.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, '');
});

cancelBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = {
    id: editingId || undefined,
    name: form.name.value,
    icon: form.icon.value,
    type: form.type.value,
    target: form.target.value,
    pet: form.pet.value,
  };
  // 한 펫에는 숏컷 하나만 고정
  const next = shortcuts
    .map((s) => (item.pet && s.pet === item.pet && s.id !== editingId ? { ...s, pet: '' } : s))
    .filter((s) => s.id !== editingId);
  if (editingId) {
    const idx = shortcuts.findIndex((s) => s.id === editingId);
    next.splice(idx, 0, item);
  } else {
    next.push(item);
  }
  await persistShortcuts(next);
  resetForm();
});

listEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const s = shortcuts.find((x) => x.id === li.dataset.id);
  if (!s) return;
  if (btn.dataset.act === 'run') {
    const res = await api.launchShortcut(s.id);
    if (!res.ok) alert(`열지 못했어요: ${res.error}`);
  } else if (btn.dataset.act === 'edit') {
    editingId = s.id;
    for (const k of ['name', 'icon', 'type', 'target', 'pet']) form[k].value = s[k] || '';
    submitBtn.textContent = '저장';
    cancelBtn.hidden = false;
    syncTypeUi();
    form.name.focus();
  } else if (btn.dataset.act === 'del') {
    if (!confirm(`'${s.name}' 숏컷을 지울까요?`)) return;
    await persistShortcuts(shortcuts.filter((x) => x.id !== s.id));
    if (editingId === s.id) resetForm();
  }
});

// 숏컷 고정 펫 목록도 캐릭터 목록에서 만든다
form.pet.innerHTML = '<option value="">없음</option>' + PETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

// ---------- 시작 ----------
(async () => {
  [settings, appState, shortcuts] = await Promise.all([api.getSettings(), api.getAppState(), api.getShortcuts()]);
  renderSettings();
  renderAppState();
  syncTypeUi();
  renderShortcuts();
  renderUpdate(await api.getUpdateState());
  showTab(location.hash.slice(1) || 'pets');
})();
