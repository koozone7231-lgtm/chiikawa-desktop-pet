// 메인 프로세스: 화면 전체를 덮는 투명·클릭 통과 창 하나와 트레이 메뉴, 설정 창을 관리한다.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const updater = require('./updater');

const SAVE_FILE = () => path.join(app.getPath('userData'), 'save.json');
const SHORTCUT_FILE = () => path.join(app.getPath('userData'), 'shortcuts.json');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const SPRITES = path.join(__dirname, '..', 'assets', 'sprites');

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
};

let win = null;
let settingsWin = null;
let tray = null;
let shortcuts = [];
let settings = {};
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
    icon: path.join(SPRITES, 'chiikawa.png'),
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
    {
      label: '숏컷',
      submenu: shortcuts.length
        ? shortcuts.map((s) => ({ label: `${s.icon || ''} ${s.name}`.trim(), click: () => launchShortcut(s.id) }))
        : [{ label: '(등록된 숏컷 없음)', enabled: false }],
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
    .createFromPath(path.join(SPRITES, 'chiikawa.png'))
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

ipcMain.handle('update-settings', (_e, patch) => {
  settings = sanitizeSettings({ ...settings, ...patch });
  updater.setEnabled(settings.autoUpdate);
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  send('settings-changed', settings);
  if (tray) buildTrayMenu();
  return settings;
});

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

// ---------- 숏컷 ----------
function loadShortcuts() {
  try {
    const list = JSON.parse(fs.readFileSync(SHORTCUT_FILE(), 'utf8'));
    shortcuts = Array.isArray(list) ? list : [];
  } catch {
    shortcuts = [];
  }
}

function sanitizeShortcut(s) {
  const type = s.type === 'app' ? 'app' : 'url';
  let target = String(s.target || '').trim();
  if (type === 'url' && !/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;
  return {
    id: String(s.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    name: String(s.name || '').trim().slice(0, 30) || '숏컷',
    icon: String(s.icon || '').trim().slice(0, 4),
    type,
    target,
    pet: CHARACTERS.some((c) => c.id === s.pet) ? s.pet : '',
  };
}

// 렌더러에서는 id만 받고, 실제 실행 대상은 메인이 저장한 목록에서 찾는다.
async function launchShortcut(id) {
  const s = shortcuts.find((x) => x.id === id);
  if (!s) return { ok: false, error: '없는 숏컷이에요' };
  try {
    if (s.type === 'url') {
      if (!/^https?:\/\//i.test(s.target)) return { ok: false, error: 'http/https 주소만 열 수 있어요' };
      await shell.openExternal(s.target);
    } else if (/^shell:AppsFolder\\[\w.-]+![\w.-]+$/i.test(s.target)) {
      // 스토어(MSIX) 앱은 실행 파일 경로가 없어 탐색기로 앱 ID를 연다
      spawn('explorer.exe', [s.target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const err = await shell.openPath(s.target);
      if (err) return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

ipcMain.handle('get-shortcuts', () => shortcuts);

ipcMain.handle('save-shortcuts', (_e, list) => {
  shortcuts = (Array.isArray(list) ? list : []).map(sanitizeShortcut);
  fs.writeFileSync(SHORTCUT_FILE(), JSON.stringify(shortcuts, null, 2));
  send('shortcuts-changed', shortcuts);
  if (tray) buildTrayMenu();
  return shortcuts;
});

ipcMain.handle('launch-shortcut', (_e, id) => launchShortcut(id));

ipcMain.handle('pick-app', async () => {
  const res = await dialog.showOpenDialog(settingsWin, {
    title: '실행할 앱 선택',
    properties: ['openFile'],
    filters: [
      { name: '앱 / 바로가기', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

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
  loadShortcuts();
  createWindow();
  createTray();
  updater.init(onUpdateState);
  updater.setEnabled(settings.autoUpdate);
});

app.on('window-all-closed', () => app.quit());
