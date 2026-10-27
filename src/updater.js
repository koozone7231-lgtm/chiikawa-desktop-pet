// 자동 업데이트: 배포 서버(GitHub Releases)에서 새 버전을 확인·다운로드하고, 다음 종료 때(또는 바로) 설치한다.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // 4시간마다
const FIRST_CHECK_DELAY_MS = 15 * 1000;

// status: idle | checking | downloading | downloaded | latest | error | dev | portable
const state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };
let listener = () => {};
let timer = null;
let enabled = true;

function set(patch) {
  Object.assign(state, patch);
  listener({ ...state, current: app.getVersion() });
}

// 개발 실행(npm start)과 포터블 exe는 electron-updater가 설치를 할 수 없다
function unsupportedReason() {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return null;
}

function init(onChange) {
  listener = onChange;
  const reason = unsupportedReason();
  if (reason) {
    set({ status: reason });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 받아 둔 업데이트는 앱을 끌 때 설치
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'downloaded', version: info.version, progress: 100 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] }));

  setEnabled(enabled);
}

function check() {
  if (unsupportedReason()) return;
  if (state.status === 'downloading' || state.status === 'downloaded') return;
  autoUpdater.checkForUpdates().catch(() => {}); // 오류는 'error' 이벤트로 표시
}

// 설정의 '자동 업데이트'가 꺼져 있으면 주기 확인을 멈춘다 (수동 확인은 가능)
function setEnabled(on) {
  enabled = !!on;
  clearInterval(timer);
  clearTimeout(timer);
  if (unsupportedReason() || !enabled) return;
  timer = setTimeout(() => {
    check();
    timer = setInterval(check, CHECK_EVERY_MS);
  }, FIRST_CHECK_DELAY_MS);
}

function installNow() {
  if (state.status !== 'downloaded') return false;
  // 조용히 설치하고 끝나면 다시 실행
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

function getState() {
  return { ...state, current: app.getVersion() };
}

module.exports = { init, check, setEnabled, installNow, getState };
