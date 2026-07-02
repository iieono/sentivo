//go:build windows

package main

import (
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"sentivo/proto"
)

// Windows toast notifications -> the app, via the WinRT UserNotificationListener
// (reached through PowerShell, like the Bluetooth toggle). Best-effort: Windows
// gates notification access, so the user grants it once (or it reports NOACCESS).
var (
	notifyOn    atomic.Bool
	notifPrimed atomic.Bool
	notifWarned atomic.Bool
	seenNotif   sync.Map // notification id -> true
)

// notifyScript reads current toast notifications and prints "id<TAB>app<TAB>text" lines.
const notifyScript = "Add-Type -AssemblyName System.Runtime.WindowsRuntime;" +
	"$as=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0];" +
	"function Await($o,$t){$k=$as.MakeGenericMethod($t).Invoke($null,@($o));$k.Wait(-1)|Out-Null;$k.Result};" +
	"[Windows.UI.Notifications.Management.UserNotificationListener,Windows.UI.Notifications.Management,ContentType=WindowsRuntime]|Out-Null;" +
	"[Windows.UI.Notifications.NotificationKinds,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;" +
	"[Windows.UI.Notifications.KnownNotificationBindings,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;" +
	"$L=[Windows.UI.Notifications.Management.UserNotificationListener]::Current;" +
	"$s=Await ($L.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]);" +
	"if(\"$s\" -ne 'Allowed'){Write-Output 'NOACCESS';exit};" +
	"$ns=Await ($L.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]);" +
	"foreach($n in $ns){$app=$n.AppInfo.DisplayInfo.DisplayName;$b=$n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric);if($b){$t=($b.GetTextElements()|%{$_.Text}) -join ' | ';Write-Output (\"$($n.Id)`t$app`t$t\")}}"

// showToast pops a real Windows toast on the laptop (under the Windows PowerShell AUMID, which is
// registered so it displays without extra setup). Used by the "test" command so you can verify a
// genuine laptop notification — not a synthetic event.
func showToast(title, body string) {
	esc := func(s string) string { return strings.ReplaceAll(s, "'", "''") }
	script := "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;" +
		"$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
		"$t=$x.GetElementsByTagName('text');" +
		"$t.Item(0).AppendChild($x.CreateTextNode('" + esc(title) + "'))|Out-Null;" +
		"$t.Item(1).AppendChild($x.CreateTextNode('" + esc(body) + "'))|Out-Null;" +
		"$toast=[Windows.UI.Notifications.ToastNotification]::new($x);" +
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)"
	noWin(exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)).Run()
}

func watchNotifications(send func(proto.Msg)) {
	for {
		if !notifyOn.Load() {
			time.Sleep(3 * time.Second)
			continue
		}
		out, err := noWin(exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", notifyScript)).Output()
		if err != nil {
			time.Sleep(8 * time.Second)
			continue
		}
		prime := !notifPrimed.Load() // first pass after enabling: baseline, don't spam existing
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(strings.TrimRight(line, "\r"))
			if line == "" {
				continue
			}
			if line == "NOACCESS" {
				if !notifWarned.Swap(true) {
					send(proto.Msg{Kind: "event", Text: "🔔 Notification access not granted.\nOn the PC: Settings → Privacy & security → Notifications → allow apps, or grant PowerShell when prompted."})
				}
				break
			}
			parts := strings.SplitN(line, "\t", 3)
			if len(parts) < 3 {
				continue
			}
			if _, seen := seenNotif.LoadOrStore(parts[0], true); seen {
				continue
			}
			if !prime {
				send(proto.Msg{Kind: "event", Text: "🔔 " + parts[1] + "\n" + parts[2]})
			}
		}
		notifPrimed.Store(true)
		time.Sleep(8 * time.Second)
	}
}
