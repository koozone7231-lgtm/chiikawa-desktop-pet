// 지금 재생 중인 음악: Windows의 미디어 정보(GlobalSystemMediaTransportControls)를
// PowerShell 하나를 계속 띄워 읽는다. 바뀔 때마다 JSON 한 줄을 보내고, 표준 입력으로
// toggle / next / prev 명령을 받는다. (네이티브 모듈 없이 동작하도록)
const { spawn } = require('child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(5000)
  $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$Mgr = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$Props = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($Mgr::RequestAsync()) $Mgr
if (-not $manager) { [Console]::Out.WriteLine('{"error":"unsupported"}'); exit 1 }
# [Console]::In의 ReadLineAsync는 PowerShell 5.1에서 실제로는 멈춰 기다리므로, 원래 입력 스트림을 직접 읽는다
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$last = ''
while ($true) {
  $session = $manager.GetCurrentSession()
  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($cmd -eq $null) { exit 0 }
    if ($session) {
      switch ($cmd.Trim()) {
        'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
        'next'   { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
        'prev'   { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
      }
    }
    $pending = $stdin.ReadLineAsync()
  }
  $state = [ordered]@{ playing = $false; hasSession = $false; title = ''; artist = ''; app = '' }
  if ($session) {
    $state.hasSession = $true
    $info = $session.GetPlaybackInfo()
    $state.playing = ([string]$info.PlaybackStatus -eq 'Playing')
    $p = Await ($session.TryGetMediaPropertiesAsync()) $Props
    if ($p) { $state.title = [string]$p.Title; $state.artist = [string]$p.Artist }
    $state.app = [string]$session.SourceAppUserModelId
  }
  $json = $state | ConvertTo-Json -Compress
  if ($json -ne $last) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $last = $json }
  Start-Sleep -Milliseconds 700
}
`;

// 앱 ID(예: Spotify.exe, Chrome)를 사람이 읽기 좋은 이름으로
function appLabel(id) {
  if (!id) return '';
  const known = [
    [/spotify/i, 'Spotify'],
    [/chrome/i, 'Chrome'],
    [/msedge|edge/i, 'Edge'],
    [/firefox/i, 'Firefox'],
    [/zunemusic|music\.ui|media\.player/i, '미디어 플레이어'],
    [/melon/i, '멜론'],
    [/genie/i, '지니'],
    [/bugs/i, '벅스'],
    [/vlc/i, 'VLC'],
    [/youtube/i, 'YouTube Music'],
  ];
  const hit = known.find(([re]) => re.test(id));
  return hit ? hit[1] : id.split(/[!\\.]/)[0];
}

function createMediaWatcher(onChange) {
  let child = null;
  let buffer = '';
  let restarts = 0;
  let stopped = false;
  let state = { playing: false, hasSession: false, title: '', artist: '', app: '', supported: true };

  function start() {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.error) {
            state = { ...state, supported: false };
          } else {
            restarts = 0;
            state = { ...msg, app: appLabel(msg.app), supported: true };
          }
          onChange(state);
        } catch {}
      }
    });
    child.on('exit', () => {
      child = null;
      if (stopped || !state.supported) return;
      // 잠깐 죽었으면 다시 띄운다 (계속 실패하면 멈춤)
      if (++restarts <= 5) setTimeout(start, 3000 * restarts);
    });
  }

  start();
  return {
    command(cmd) {
      if (child && ['toggle', 'next', 'prev'].includes(cmd)) child.stdin.write(`${cmd}\n`);
    },
    getState: () => state,
    stop() {
      stopped = true;
      if (child) child.kill();
    },
  };
}

module.exports = { createMediaWatcher };
