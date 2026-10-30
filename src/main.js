// 메인 프로세스: 화면 전체를 덮는 투명·클릭 통과 창 하나와 트레이 메뉴, 설정 창,
// 일정 저장, 지금 재생 중인 음악 읽기를 관리한다.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const { createMediaWatcher } = require('./media');
const ScheduleUtils = require('./renderer/schedule-utils');

const SAVE_FILE = () => path.join(app.getPath('userData'), 'save.json');
const SCHEDULE_FILE = () => path.join(app.getPath('userData'), 'schedules.json');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const ICON_SPRITE = path.join(__dirname, '..', 'assets', 'sprites', 'chiikawa', 'default.png');

const CHARACTERS = [
  { id: 'chiikawa', name: '치이카와', defaultOn: true },
  { id: 'hachiware', name: '하치와레', defaultOn: true },
  { id: 'usagi', name: '우사기', defaultOn: true },
  { id: 'rakko', name: '랏코' },
  { id: 'momonga', name: '모몽가' },
  { id: 'shisa', name: '시사' },
  { id: 'kani', name: '헌책방' },
  { id: 'kurimanju', name: '쿠리만쥬' },
];
const MAX_ON_DESKTOP = 5; // 바탕화면에 한 번에 나오는 최대 마리 수

// 설정 기본값과 허용 범위 (설정 창에서 바꿀 수 있는 값)
const SETTING_RULES = {
  petSize: { def: 104, min: 70, max: 170 },
  speed: { def: 1, min: 0.5, max: 2 },
  chatter: { def: 'normal', options: ['normal', 'less', 'off'] },
  breakEveryMin: { def: 50, min: 0, max: 180 }, // 0이면 끔
  pomodoroFocusMin: { def: 25, min: 5, max: 90 },
  pomodoroRestMin: { def: 5, min: 1, max: 30 },
  peekVisible: { def: 0.6, min: 0.35, max: 0.9 },
  meetings: { def: true, bool: true },
  petGap: { def: 24, min: 0, max: 200 },
  autoUpdate: { def: true, bool: true }, // 새 버전 자동 확인·다운로드
  showMusic: { def: true, bool: true }, // 지금 재생 중인 음악 표시
  danceToMusic: { def: true, bool: true }, // 음악이 나오면 펫들이 춤
  musicCard: { def: true, bool: true }, // 끌어서 옮기는 음악 카드
  focusCard: { def: true, bool: true }, // 끌어서 옮기는 집중(뽀모도로) 카드
};

let win = null;
let settingsWin = null;
let tray = null;
let schedules = [];
let settings = {};
let media = null;
let musicState = { playing: false, hasSession: false, title: '', artist: '', app: '', supported: true };
let updateState = updater.getState();
let lastState = null; // 펫 창이 마지막으로 저장한 상태 (설정 창의 상태 탭에 보여줌)
const ui = {
  visible: true,
  focus: false,
  enabled: Object.fromEntries(CHARACTERS.map((c) => [c.id, !!c.defaultOn])),
};

// productName(한글)이 붙어도 개발 실행 때와 같은 저장 폴더를 쓰도록 고정
app.setPath('userData', path.join(app.getPath('appData'), 'chiikawa-desktop-pet'));
app.setAppUserModelId('com.koozone.chiikawa-desktop-pet');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
// 이미 켜져 있는데 또 실행하면(바로가기 더블클릭 등) 설정 창을 연다
app.on('second-instance', () => openSettings());

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-removed', fitToScreen);
}

function fitToScreen() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
}

function openSettings(tab) {
  if (settingsWin) {
    if (tab) settingsWin.webContents.send('settings-tab', tab);
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    title: '먼작귀 펫 설정',
    autoHideMenuBar: true,
    backgroundColor: '#fffaf0',
    icon: ICON_SPRITE,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { hash: tab || '' });
  settingsWin.on('closed', () => (settingsWin = null));
}

function send(cmd, payload) {
  if (win) win.webContents.send('command', { cmd, payload });
}

// 펫 창·트레이·설정 창이 같은 상태를 보도록 알린다
function broadcastAppState() {
  if (tray) buildTrayMenu();
  if (settingsWin) settingsWin.webContents.send('app-state', getAppState());
}

const onCount = () => Object.values(ui.enabled).filter(Boolean).length;

// 켜려는데 이미 MAX_ON_DESKTOP마리가 나와 있으면 거절하고 펫이 알려준다
function setPetEnabled(id, enabled) {
  if (!(id in ui.enabled)) return false;
  if (enabled && !ui.enabled[id] && onCount() >= MAX_ON_DESKTOP) {
    send('limit-reached');
    broadcastAppState(); // 트레이 체크 표시를 원래대로 되돌림
    return false;
  }
  ui.enabled[id] = !!enabled;
  send('set-enabled', { id, enabled: !!enabled });
  broadcastAppState();
  return true;
}

function setFocusMode(on) {
  ui.focus = !!on;
  send('set-focus', ui.focus);
  broadcastAppState();
}

function buildTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '먼작귀 펫', enabled: false },
    { type: 'separator' },
    {
      label: `캐릭터 (${onCount()}/${MAX_ON_DESKTOP})`,
      submenu: CHARACTERS.map((c) => ({
        label: c.name,
        type: 'checkbox',
        checked: ui.enabled[c.id],
        click: (item) => setPetEnabled(c.id, item.checked),
      })),
    },
    { type: 'separator' },
    todayScheduleTrayItem(),
    { label: '일정 관리…', click: () => openSettings('schedule') },
    musicTrayItem(),
    {
      label: '카드',
      submenu: [
        { label: '🎵 음악 카드', type: 'checkbox', checked: settings.musicCard, click: (i) => updateSettings({ musicCard: i.checked }) },
        { label: '📖 집중 카드', type: 'checkbox', checked: settings.focusCard, click: (i) => updateSettings({ focusCard: i.checked }) },
      ],
    },
    { type: 'separator' },
    {
      label: `집중 모드 (${settings.pomodoroFocusMin}분 뽀모도로)`,
      type: 'checkbox',
      checked: ui.focus,
      click: (item) => setFocusMode(item.checked),
    },
    {
      label: '모두 간식 주기',
      click: () => send('feed-all'),
    },
    {
      label: ui.visible ? '숨기기' : '보이기',
      click: toggleVisible,
    },
    { type: 'separator' },
    updateTrayItem(),
    { label: '설정…', click: () => openSettings() },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function updateTrayItem() {
  const u = updateState;
  if (u.status === 'downloaded') return { label: `🎁 새 버전 v${u.version} 설치하고 다시 시작`, click: () => updater.installNow() };
  if (u.status === 'downloading') return { label: `새 버전 받는 중… ${u.progress}%`, enabled: false };
  if (u.status === 'checking') return { label: '업데이트 확인 중…', enabled: false };
  if (u.status === 'dev' || u.status === 'portable') return { label: `버전 ${app.getVersion()}`, enabled: false };
  return { label: `업데이트 확인 (현재 v${app.getVersion()})`, click: () => updater.check() };
}

function onUpdateState(s) {
  const justDownloaded = s.status === 'downloaded' && updateState.status !== 'downloaded';
  updateState = s;
  if (tray) buildTrayMenu();
  if (settingsWin) settingsWin.webContents.send('update-state', s);
  if (justDownloaded) send('update-ready', s.version);
}

function toggleVisible() {
  ui.visible = !ui.visible;
  if (ui.visible) win.showInactive();
  else win.hide();
  broadcastAppState();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(ICON_SPRITE)
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('먼작귀 펫');
  tray.on('click', toggleVisible);
  tray.on('double-click', () => openSettings());
  buildTrayMenu();
}

// ---------- 설정 ----------
function sanitizeSettings(input) {
  const out = {};
  for (const [key, rule] of Object.entries(SETTING_RULES)) {
    const v = input[key];
    if (rule.bool) out[key] = typeof v === 'boolean' ? v : rule.def;
    else if (rule.options) out[key] = rule.options.includes(v) ? v : rule.def;
    else out[key] = Number.isFinite(Number(v)) ? Math.min(rule.max, Math.max(rule.min, Number(v))) : rule.def;
  }
  return out;
}

function loadSettings() {
  try {
    settings = sanitizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')));
  } catch {
    settings = sanitizeSettings({});
  }
}

function getAppState() {
  return {
    enabled: ui.enabled,
    focus: ui.focus,
    visible: ui.visible,
    isPackaged: app.isPackaged,
    autoStart: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    characters: CHARACTERS,
    maxOn: MAX_ON_DESKTOP,
  };
}

ipcMain.handle('get-settings', () => settings);

function updateSettings(patch) {
  settings = sanitizeSettings({ ...settings, ...patch });
  updater.setEnabled(settings.autoUpdate);
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  send('settings-changed', settings);
  if (settingsWin) settingsWin.webContents.send('settings-changed', settings);
  if (tray) buildTrayMenu();
  return settings;
}

ipcMain.handle('update-settings', (_e, patch) => updateSettings(patch));

ipcMain.handle('reset-settings', () => {
  settings = sanitizeSettings({});
  updater.setEnabled(settings.autoUpdate);
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  send('settings-changed', settings);
  if (tray) buildTrayMenu();
  return settings;
});

ipcMain.handle('get-app-state', () => getAppState());

ipcMain.handle('get-update-state', () => updateState);
ipcMain.on('check-update', () => updater.check());
ipcMain.on('install-update', () => updater.installNow());

ipcMain.handle('set-app-option', (_e, { key, value }) => {
  if (key === 'autoStart' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value });
  else if (key === 'focus') setFocusMode(value);
  else if (key === 'visible' && !!value !== ui.visible) toggleVisible();
  else if (key === 'pet') setPetEnabled(value.id, value.enabled);
  return getAppState();
});

// 상태 탭: 펫 창에 지금 상태를 저장하게 한 뒤 그 값을 돌려준다
ipcMain.handle('get-status', async () => {
  send('save-now');
  await new Promise((r) => setTimeout(r, 200));
  return lastState;
});

ipcMain.on('pet-command', (_e, cmd) => {
  if (cmd === 'feed-all') send('feed-all');
});

ipcMain.on('open-data-dir', () => shell.openPath(app.getPath('userData')));

// ---------- 일정 ----------
function loadSchedules() {
  try {
    const list = JSON.parse(fs.readFileSync(SCHEDULE_FILE(), 'utf8'));
    schedules = Array.isArray(list) ? list.map(sanitizeSchedule) : [];
  } catch {
    schedules = [];
  }
}

function sanitizeSchedule(s) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : ScheduleUtils.dateStr();
  const time = /^\d{2}:\d{2}$/.test(s.time) ? s.time : '';
  return {
    id: String(s.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    title: String(s.title || '').trim().slice(0, 40) || '일정',
    date,
    time,
    repeat: ['none', 'daily', 'weekdays', 'weekly'].includes(s.repeat) ? s.repeat : 'none',
    // 끝낸 날짜 기록은 최근 60개만 (반복 일정이 끝없이 쌓이지 않게)
    doneOn: (Array.isArray(s.doneOn) ? s.doneOn : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-60),
  };
}

function saveSchedules(list) {
  schedules = (Array.isArray(list) ? list : []).map(sanitizeSchedule);
  fs.writeFileSync(SCHEDULE_FILE(), JSON.stringify(schedules, null, 2));
  send('schedules-changed', schedules);
  if (settingsWin) settingsWin.webContents.send('schedules-changed', schedules);
  if (tray) buildTrayMenu();
  return schedules;
}

function todayScheduleTrayItem() {
  const today = ScheduleUtils.dateStr();
  const items = ScheduleUtils.itemsOn(schedules, today);
  return {
    label: `오늘 일정 (${items.length})`,
    submenu: items.length
      ? items.map((s) => ({
          label: `${ScheduleUtils.isDone(s, today) ? '✓ ' : ''}${s.time || '하루 종일'}  ${s.title}`,
          click: () => toggleScheduleDone(s.id, today),
        }))
      : [{ label: '(오늘 일정 없음)', enabled: false }],
  };
}

function toggleScheduleDone(id, day) {
  const next = schedules.map((s) => {
    if (s.id !== id) return s;
    const done = new Set(s.doneOn || []);
    if (done.has(day)) done.delete(day);
    else done.add(day);
    return { ...s, doneOn: [...done].sort() };
  });
  return saveSchedules(next);
}

ipcMain.handle('get-schedules', () => schedules);
ipcMain.handle('save-schedules', (_e, list) => saveSchedules(list));
ipcMain.handle('toggle-schedule-done', (_e, { id, day }) => toggleScheduleDone(id, day));

// 날짜가 바뀌면 트레이의 '오늘 일정'도 새로 만든다
let trayDay = ScheduleUtils.dateStr();
setInterval(() => {
  const today = ScheduleUtils.dateStr();
  if (today !== trayDay && tray) {
    trayDay = today;
    buildTrayMenu();
  }
}, 60000);

// ---------- 음악 ----------
function musicTrayItem() {
  const m = musicState;
  if (!m.hasSession || !m.title) return { label: '🎵 재생 중인 음악 없음', enabled: false };
  const text = `${m.playing ? '🎵' : '⏸'} ${m.title}${m.artist ? ' - ' + m.artist : ''}`;
  return { label: text.length > 40 ? text.slice(0, 39) + '…' : text, click: () => media && media.command('toggle') };
}

function onMusicState(s) {
  const changed = s.title !== musicState.title || s.playing !== musicState.playing || s.hasSession !== musicState.hasSession;
  musicState = s;
  send('music-state', s);
  if (settingsWin) settingsWin.webContents.send('music-state', s);
  if (changed && tray) buildTrayMenu();
}

ipcMain.handle('get-music-state', () => musicState);
ipcMain.on('music-command', (_e, cmd) => media && media.command(cmd));

ipcMain.on('open-settings', (_e, tab) => openSettings(tab));

// ---------- 펫 창 ----------
// 렌더러가 펫 위에 마우스가 있는지 알려주면 그때만 클릭을 받는다.
ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// 펫을 잡고 있는 동안 커서 위치를 직접 읽어 펫 창에 보낸다.
// (투명 창은 빨리 끌면 마우스 이벤트가 끊길 수 있어서, 창 이벤트에만 기대지 않는다)
let dragTimer = null;
let dragSafety = null;
function stopDragFeed() {
  clearInterval(dragTimer);
  clearTimeout(dragSafety);
  dragTimer = null;
}
ipcMain.on('drag-start', () => {
  if (!win) return;
  stopDragFeed();
  win.setIgnoreMouseEvents(false);
  dragTimer = setInterval(() => {
    if (!win) return stopDragFeed();
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('drag-move', { x: pt.x - b.x, y: pt.y - b.y });
  }, 16);
  dragSafety = setTimeout(stopDragFeed, 60000); // 놓는 신호를 못 받아도 1분 뒤엔 멈춤
});
ipcMain.on('drag-end', stopDragFeed);

ipcMain.handle('load-state', () => {
  try {
    return JSON.parse(fs.readFileSync(SAVE_FILE(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.on('save-state', (_e, state) => {
  lastState = state;
  try {
    fs.writeFileSync(SAVE_FILE(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('저장 실패', err);
  }
  // 저장된 설정(활성 캐릭터, 집중 모드)을 트레이·설정 창과 맞춘다.
  if (state && state.enabled) {
    const changed = JSON.stringify(state.enabled) !== JSON.stringify(ui.enabled) || state.focus !== ui.focus;
    ui.enabled = { ...ui.enabled, ...state.enabled };
    ui.focus = !!state.focus;
    if (changed) broadcastAppState();
  }
});

app.whenReady().then(() => {
  loadSettings();
  loadSchedules();
  createWindow();
  createTray();
  media = createMediaWatcher(onMusicState);
  updater.init(onUpdateState);
  updater.setEnabled(settings.autoUpdate);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => media && media.stop());
