# zcode-tps-monitor Token 速率监控条:完全透明、纯文字、无彩色、字号统一。
# 跟随 ZCode 深浅主题(像素采样);统计范围为当前会话。
# 外观(字体/字号/缩放)读取 ~/.zcode/tps-monitor.config.json 的 appearance 节,重启悬浮条生效。
# DPI:进程强制 DPI 感知,所有坐标按缩放比换算,确保落在 ZCode 布局内部。
# 启动:powershell -NoProfile -ExecutionPolicy Bypass -File overlay.ps1
# 关闭:右键菜单 → 关闭监控条。
#
# [V2.3.0 退役路径标注] 本脚本是「无 Electron 时的轻量替代」:零安装、单文件、仅 Windows,
# 覆盖悬浮条(透明/置顶/点击穿透/拖拽/悬停详情)与托盘、开机自启等能力,但不跨平台。
# 需要跨平台(Windows/macOS/Linux)桌面客户端时,请改用仓库根目录的 Electron 工程:
#   npm run dev            # 开发运行
#   npm run dist:win|mac|linux   # 打包 NSIS/dmg/AppImage
# 详见 README「桌面客户端」一节。此脚本自 V2.3.0 起仅做维护、不再新增功能。

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)]
public struct ACCENTPOLICY {
  public int AccentState; public int AccentFlags; public int GradientColor; public int AnimationId;
}
[StructLayout(LayoutKind.Sequential)]
public struct WINCOMPATTRDATA {
  public int Attribute; public IntPtr Data; public int SizeOfData;
}
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetWindowCompositionAttribute(IntPtr hWnd, ref WINCOMPATTRDATA data);
}
"@

# 必须在创建任何窗口前调用:让 GetWindowRect/CopyFromScreen 返回物理像素
[void][Win32]::SetProcessDPIAware()

# 物理像素规格
$STRIP_W = 560; $STRIP_H = 36
$script:offX = -($STRIP_W + 20)   # 相对 ZCode 窗口右下角的物理偏移(输入框上方偏右)
$script:offY = -168
$script:lastRect = $null
$script:isLight = $null
$script:S = 1.0             # DPI 缩放比(物理px / WPF DIP),SourceInitialized 时实测

# ---- 外观配置(与大屏共用同一份 ~/.zcode/tps-monitor.config.json) ----
# CSS 通用族名与 @font-face 家族名在 WPF 中无对应字体,过滤后按回退顺序取用
$CSS_GENERIC = @("system-ui", "sans-serif", "serif", "monospace", "ui-monospace", "cursive", "fantasy", "inherit", "tps-webfont")
function ConvertTo-WpfFontStack([string]$cssStack, [string]$fallback) {
  if ([string]::IsNullOrWhiteSpace($cssStack)) { return $fallback }
  $parts = $cssStack.Split(",") | ForEach-Object { $_.Trim().Trim('"').Trim("'") } |
    Where-Object { $_ -and ($CSS_GENERIC -notcontains $_.ToLower()) }
  if (-not $parts -or $parts.Count -eq 0) { return $fallback }
  return ($parts -join ", ")
}

$cfgAppearance = $null
try {
  $cfgFile = Join-Path $env:USERPROFILE ".zcode\tps-monitor.config.json"
  if (Test-Path -LiteralPath $cfgFile) {
    $cfg = Get-Content -Raw -LiteralPath $cfgFile | ConvertFrom-Json
    if ($cfg -and $cfg.PSObject.Properties.Name -contains "appearance") { $cfgAppearance = $cfg.appearance }
  }
} catch { $cfgAppearance = $null }

$FONT_UI   = ConvertTo-WpfFontStack "$($cfgAppearance.fontFamily)" "Segoe UI, Microsoft YaHei"
$FONT_MONO = ConvertTo-WpfFontStack "$($cfgAppearance.monoFont)" $FONT_UI
$cfgSize   = 0; $cfgScale = 1; $cfgGlass = 0.6
if ($cfgAppearance) {
  if ($cfgAppearance.PSObject.Properties.Name -contains "fontSize" -and $cfgAppearance.fontSize) { $cfgSize = [double]$cfgAppearance.fontSize }
  if ($cfgAppearance.PSObject.Properties.Name -contains "fontScale" -and $cfgAppearance.fontScale) { $cfgScale = [double]$cfgAppearance.fontScale }
  if ($cfgAppearance.PSObject.Properties.Name -contains "glassIntensity") { $cfgGlass = [double]$cfgAppearance.glassIntensity }
}
# 基准字号 × 整体缩放,夹紧在 8–48 物理像素
$FSZ = if ($cfgSize -gt 0) { [Math]::Round($cfgSize * $cfgScale, 1) } else { 13 }
$FSZ = [Math]::Min(48, [Math]::Max(8, $FSZ))
$ACRYLIC_ON = ($cfgGlass -gt 0)

# ---- 聚焦数据源(V2.5.0):config 的 focusAgent 决定悬浮条显示哪个客户端的速率 ----
# 缺省 zcode —— 默认 providers=["zcode"] 下查询结果与 V2.4.0 完全一致;
# "all" = 聚合全部启用源;其余值按 ?agent=<id> 圈定单一数据源(REST 只增参数,向后兼容)。
$script:focusAgent = "zcode"
if ($cfg -and $cfg.PSObject.Properties.Name -contains "focusAgent" -and $cfg.focusAgent) {
  $script:focusAgent = [string]$cfg.focusAgent
}
$FOCUS_PARAM = if ($script:focusAgent -and $script:focusAgent -ne "all") { "?agent=$($script:focusAgent)" } else { "" }
$URL = "http://127.0.0.1:7423/api/token-rate$FOCUS_PARAM"
$FOCUS_LABELS = @{ "zcode" = "ZCode"; "claude-code" = "Claude Code"; "codex" = "Codex"; "opencode" = "OpenCode"; "cline" = "Cline" }
$script:FOCUS_PREFIX = if ($script:focusAgent -and $script:focusAgent -ne "zcode" -and $script:focusAgent -ne "all") {
  "[$($FOCUS_LABELS[$script:focusAgent])] "
} else { "" }
# 亚克力着色(ARGB):深色底深色薄纱,浅色底浅色薄纱;AccentState=4 为 BlurBehind
$ACRYLIC_TINT_DARK  = 0x660B1020
$ACRYLIC_TINT_LIGHT = 0x59F2F4F8

$INK = @{
  dark  = @{ main = "#FFE8ECF7"; dim = "#FF8B94AD" }
  light = @{ main = "#FF2A3346"; dim = "#FF7A829A" }
}

function Get-ZCodeLuminance($r) {
  try {
    $x = $r.Right - 8
    $y = $r.Top + 40
    $sh = [Math]::Max(60, $r.Bottom - $r.Top - 120)
    $bmp = New-Object System.Drawing.Bitmap(4, $sh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size(4, $sh)))
    $g.Dispose()
    $vals = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $sh; $i += 8) {
      $c = $bmp.GetPixel(2, $i)
      [void]$vals.Add(($c.R * 0.299 + $c.G * 0.587 + $c.B * 0.114))
    }
    $bmp.Dispose()
    if ($vals.Count -eq 0) { return $null }
    $vals.Sort()
    return $vals[[int]($vals.Count / 2)]
  } catch { return $null }
}

function Convert-Hex([string]$hex) {
  $a = [byte]::Parse($hex.Substring(1, 2), 'HexNumber')
  $r = [byte]::Parse($hex.Substring(3, 2), 'HexNumber')
  $g = [byte]::Parse($hex.Substring(5, 2), 'HexNumber')
  $b = [byte]::Parse($hex.Substring(7, 2), 'HexNumber')
  return [Windows.Media.Color]::FromArgb($a, $r, $g, $b)
}

function BrushFrom([string]$hex) {
  $c = Convert-Hex $hex
  return [Windows.Media.SolidColorBrush]::new($c)
}

# 可选亚克力背景:SetWindowCompositionAttribute 在部分系统/合成环境下无效,
# 失败时静默回退"透明 + Opacity"的纯文字形态,不影响任何功能。
function Enable-Acrylic([bool]$light) {
  if (-not $ACRYLIC_ON) { return $false }
  try {
    $hwnd = ([System.Windows.Interop.WindowInteropHelper]::new($win)).Handle
    if ($hwnd -eq [IntPtr]::Zero) { return $false }
    $tint = if ($light) { $ACRYLIC_TINT_LIGHT } else { $ACRYLIC_TINT_DARK }
    $accent = New-Object ACCENTPOLICY
    $accent.AccentState = 4          # ACCENT_ENABLE_ACRYLICBLURBEHIND
    $accent.AccentFlags = 0x20 -bor 0x40 -bor 0x80 -bor 0x100
    $accent.GradientColor = [int]$tint
    $accent.AnimationId = 0
    $data = New-Object WINCOMPATTRDATA
    $data.Attribute = 19             # WCA_ACCENT_POLICY
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf([type]$accent)
    $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    [System.Runtime.InteropServices.Marshal]::StructureToPtr($accent, $ptr, $false)
    $data.Data = $ptr
    $data.SizeOfData = $size
    $ok = [Win32]::SetWindowCompositionAttribute($hwnd, [ref]$data)
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    return [bool]$ok
  } catch { return $false }
}

function Apply-Theme([bool]$light) {
  $t = if ($light) { $INK.light } else { $INK.dark }
  $big.Foreground = BrushFrom $t.main
  $unit.Foreground = BrushFrom $t.main
  $stat.Foreground = BrushFrom $t.dim
  Enable-Acrylic $light
}

# 按 DPI 缩放比换算物理尺寸 → WPF DIP
function Apply-Scale {
  $win.Width = [Math]::Round($STRIP_W / $script:S, 1)
  $win.Height = [Math]::Round($STRIP_H / $script:S, 1)
  $fsDip = [Math]::Round($FSZ / $script:S, 1)   # 统一字号
  $big.FontFamily = [Windows.Media.FontFamily]::new($FONT_MONO)
  $unit.FontFamily = [Windows.Media.FontFamily]::new($FONT_MONO)
  $stat.FontFamily = [Windows.Media.FontFamily]::new($FONT_UI)
  $big.FontSize = $fsDip
  $unit.FontSize = $fsDip
  $stat.FontSize = $fsDip
  $unit.Margin = [Windows.Thickness]::new(4 / $script:S, 0, 0, 0)
  $stat.Margin = [Windows.Thickness]::new(12 / $script:S, 0, 0, 0)
}

# 物理 → DIP 定位
function Place-At([int]$physX, [int]$physY) {
  $win.Left = $physX / $script:S
  $win.Top = $physY / $script:S
}

$xamlText = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" Topmost="False" Opacity="0.72" ShowInTaskbar="False"
        ShowActivated="False" ResizeMode="NoResize"
        FontFamily="Segoe UI, Microsoft YaHei">
  <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
    <TextBlock x:Name="Big" Text="--" FontWeight="SemiBold" VerticalAlignment="Center"/>
    <TextBlock x:Name="Unit" Text="tok/s" VerticalAlignment="Center"/>
    <TextBlock x:Name="Stat" Text="等待数据…" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
  </StackPanel>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xamlText)
$win = [Windows.Markup.XamlReader]::Load($reader)
$big = $win.FindName("Big"); $unit = $win.FindName("Unit"); $stat = $win.FindName("Stat")

# 左键拖动(物理坐标换算,记住相对偏移);右键菜单唯一关闭入口
$win.Add_MouseLeftButtonDown({
  try {
    $win.DragMove()
    $r = Get-ZCodeRect
    if ($r) {
      $script:offX = [int]($win.Left * $script:S) - $r.Right
      $script:offY = [int]($win.Top * $script:S) - $r.Bottom
    }
  } catch {}
})
$menu = [Windows.Controls.ContextMenu]::new()
$mi = [Windows.Controls.MenuItem]::new(); $mi.Header = "关闭监控条"
$mi.Add_Click({ $win.Close() })
[void]$menu.Items.Add($mi)
$win.ContextMenu = $menu

function Get-ZCodeRect {
  $p = Get-Process ZCode -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $r = New-Object RECT
    [void][Win32]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    return $r
  }
  return $null
}

$script:tickCount = 0
$script:lastThemeAt = [DateTime]::MinValue   # 上次主题采样时刻(按时间而非 tick 数)
$script:lastBig = $null                       # 上次写入的文本:值不变则跳过 WPF 更新
$script:lastStat = $null
$timer = [Windows.Threading.DispatcherTimer]::new()
# 2s 轮询:速率数字 2s 一跳肉眼无差,空载 CPU 减半(验收:空载 < 0.5%)
$timer.Interval = [TimeSpan]::FromSeconds(2)
$timer.Add_Tick({
  try {
    $script:tickCount++
    $r = Get-ZCodeRect
    # 每 5 秒采样 ZCode 窗口,跟随其深浅主题(与轮询间隔解耦,按墙钟时间判断)
    if ($r -and (([DateTime]::UtcNow - $script:lastThemeAt).TotalMilliseconds -ge 5000)) {
      $script:lastThemeAt = [DateTime]::UtcNow
      $lum = Get-ZCodeLuminance $r
      if ($null -ne $lum) {
        $l = ($lum -gt 127)
        if ($l -ne $script:isLight) { $script:isLight = $l; Apply-Theme $l }
      }
    }
    # 按偏移计算期望位置,并钳制在 ZCode 窗口内部(窗口缩小也不会跑出界)
    if ($r) {
      $minX = $r.Left + 8
      $maxX = [Math]::Max($minX, $r.Right - $STRIP_W - 8)
      $minY = $r.Top + 8
      $maxY = [Math]::Max($minY, $r.Bottom - $STRIP_H - 8)
      $px = [Math]::Max($minX, [Math]::Min($r.Right + $script:offX, $maxX))
      $py = [Math]::Max($minY, [Math]::Min($r.Bottom + $script:offY, $maxY))
      $curPhysX = if ([double]::IsNaN($win.Left)) { -1 } else { [int]($win.Left * $script:S) }
      $curPhysY = if ([double]::IsNaN($win.Top)) { -1 } else { [int]($win.Top * $script:S) }
      if ($curPhysX -ne $px -or $curPhysY -ne $py) {
        Place-At $px $py
      }
      $script:lastRect = $r
    }
    $d = Invoke-RestMethod -Uri $URL -TimeoutSec 2
    if ($d.latest) {
      # 文本无变化时跳过写入:少一次 WPF 属性变更 → 少一次布局/渲染 pass
      $bigText = if ($null -ne $d.latest.tokPerSec) { [Math]::Round($d.latest.tokPerSec, 0) } else { "-" }
      $ttft = if ($null -ne $d.latest.ttftMs) { [Math]::Round($d.latest.ttftMs / 1000, 1) } else { "-" }
      # 聚焦非 zcode 数据源时前缀来源名(缺省 zcode 不加前缀,与 V2.4.0 文本一致)
      $statText = "$($script:FOCUS_PREFIX)均$($d.session.avg)  峰$($d.session.max)  ·  TTFT ${ttft}s"
      if ($bigText -ne $script:lastBig) { $script:lastBig = $bigText; $big.Text = $bigText }
      if ($statText -ne $script:lastStat) { $script:lastStat = $statText; $stat.Text = $statText }
    }
  } catch {
    $msg = "连接失败,重试中…"
    if ($msg -ne $script:lastStat) { $script:lastStat = $msg; $stat.Text = $msg }
  }
})
$timer.Start()

$win.Add_SourceInitialized({
  # 不抢焦点、不进 Alt+Tab
  $hwnd = ([System.Windows.Interop.WindowInteropHelper]::new($win)).Handle
  if ($hwnd -ne [IntPtr]::Zero) {
    $cur = [Win32]::GetWindowLongPtr($hwnd, -20)
    [void][Win32]::SetWindowLongPtr($hwnd, -20, [IntPtr]([int64]$cur -bor 0x8000000 -bor 0x80))
  }
  # 层级跟随:把监控条设为 ZCode 主窗口的"所属窗口"(GWL_HWNDPARENT)
  # 效果:永远在 ZCode 之上,但被其他应用正常遮挡;ZCode 最小化/恢复时同步
  $z = Get-Process ZCode -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($z -and $hwnd -ne [IntPtr]::Zero) {
    [void][Win32]::SetWindowLongPtr($hwnd, -8, $z.MainWindowHandle)
  }
  # 实测 DPI 缩放比,应用尺寸/字号换算
  $src = [System.Windows.PresentationSource]::FromVisual($win)
  if ($src -and $src.CompositionTarget) {
    $script:S = [Math]::Max(1.0, $src.CompositionTarget.TransformToDevice.M11)
  }
  Apply-Scale
  # 缩放比就绪后才能正确定位(物理坐标 → DIP)
  $rInit = Get-ZCodeRect
  if ($rInit) {
    Place-At ($rInit.Right + $script:offX) ($rInit.Bottom + $script:offY)
    $script:lastRect = $rInit
    [Console]::Error.WriteLine("dpi S=$($script:S) zcodeRect=($($rInit.Left),$($rInit.Top),$($rInit.Right),$($rInit.Bottom)) strip=($($win.Left * $script:S),$($win.Top * $script:S))")
  }
})
$win.Add_Closed({ $win.Dispatcher.InvokeShutdown() })

# 首次主题采样(ZCode 窗口)
$r0 = Get-ZCodeRect
if ($r0) {
  $lum0 = Get-ZCodeLuminance $r0
  if ($null -ne $lum0) { $script:isLight = ($lum0 -gt 127) }
}
if ($null -eq $script:isLight) { $script:isLight = $false }
Apply-Theme $script:isLight
$win.Show()
[System.Windows.Threading.Dispatcher]::Run()
