//go:build windows

package main

import (
	"os/exec"
	"strings"
)

// smtcScript reads the current "now playing" via the Windows System Media Transport
// Controls (WinRT). Uses -like 'IAsyncOperation*' to pick AsTask so we don't need a
// backtick (which can't live in this Go raw string). Prints {title,artist,playing} or {}.
const smtcScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' } | Select-Object -First 1
function Await($op,$t){ $task=$m.MakeGenericMethod($t).Invoke($null,@($op)); $task.Wait(-1)|Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]|Out-Null
try {
  $mgr=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $s=$mgr.GetCurrentSession()
  if($s){
    $st=[int]$s.GetPlaybackInfo().PlaybackStatus
    # only Playing(4)/Paused(5) is real "now playing"; Closed/Opened/Stopped sessions are stale
    if($st -eq 4 -or $st -eq 5){
      $p=Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      if($p.Title){ [PSCustomObject]@{title=$p.Title;artist=$p.Artist;playing=($st -eq 4)}|ConvertTo-Json -Compress } else { '{}' }
    } else { '{}' }
  } else { '{}' }
} catch { '{}' }
`

// mediaState returns {title,artist,playing} JSON for whatever is playing (or {}).
func mediaState() string {
	out, err := noWin(exec.Command("powershell", "-NoProfile", "-Command", smtcScript)).Output()
	if err != nil {
		return "{}"
	}
	s := strings.TrimSpace(string(out))
	if s == "" || !strings.HasPrefix(s, "{") {
		return "{}"
	}
	return s
}
