package main

import (
	"os/exec"
	"strings"
)

// Bluetooth is best-effort: Windows has no clean non-admin CLI, so we reuse
// PowerShell (WinRT Radio API for toggle, PnP for listing). If it fails on a
// given machine it returns a clear message rather than crashing. No RSSI —
// use /locate for actual position.

func btScan() string {
	out, err := noWin(exec.Command("powershell", "-NoProfile",
		"-Command", "Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FriendlyName")).Output()
	if err != nil {
		return "bt scan failed (best-effort)"
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return "no active Bluetooth devices"
	}
	return "🔵 Bluetooth devices (no RSSI — use /locate for position):\n" + s
}

// btRadioScript toggles the Bluetooth radio via the WinRT Radio API. %STATE% is On/Off.
const btRadioScript = "Add-Type -AssemblyName System.Runtime.WindowsRuntime\n" +
	"$as=[System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'}\n" +
	"function Await($o,$t){$k=$as[0].MakeGenericMethod($t).Invoke($null,@($o));$k.Wait(-1)|Out-Null;$k.Result}\n" +
	"[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]|Out-Null\n" +
	"$rs=Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])\n" +
	"$b=$rs|?{$_.Kind -eq 'Bluetooth'}\n" +
	"if($b){Await ($b.SetStateAsync('%STATE%')) ([Windows.Devices.Radios.RadioAccessStatus])|Out-Null;'ok'}else{'no bluetooth radio'}"

func btRadio(state string) string {
	script := strings.Replace(btRadioScript, "%STATE%", state, 1)
	out, err := noWin(exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)).Output()
	if err != nil {
		return "bt " + state + " failed (best-effort; may need admin/WinRT support)"
	}
	if strings.TrimSpace(string(out)) == "ok" {
		return "🔵 Bluetooth turned " + state
	}
	return "bt: " + strings.TrimSpace(string(out))
}
