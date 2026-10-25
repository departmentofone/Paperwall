// Paperwall: native Windows desktop-wallpaper host.
// Hosts web\index.html in WebView2 behind the desktop icons, one window per monitor, and
// web\gallery.html in a normal window for browsing themes and settings.
// Written for the C# 5 compiler that ships with .NET Framework 4.x (no SDK needed).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Paperwall
{
    static class Program
    {
        public const string Name = "Paperwall";
        public const string VirtualHost = "paperwall.example";

        [STAThread]
        static void Main()
        {
            bool fresh;
            using (var mutex = new Mutex(true, "Local\\Paperwall", out fresh))
            {
                if (!fresh) { Native.PostMessage(new IntPtr(0xffff), Native.RegisterWindowMessage("Paperwall.Open"), IntPtr.Zero, IntPtr.Zero); return; }
                try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } // per-monitor v2
                Autostart.Migrate();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Host());
            }
        }
    }

    // ------------------------------------------------------------------ settings
    class Settings
    {
        public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Paperwall");
        // the app's earlier names, newest first; their settings carry over on first run
        static readonly string[] OldDirs = { "Driftscape", "ShanShuiWallpaper" };
        // settings the page understands (style is sent separately, per theme)
        public static readonly string[] PageKeys = { "speed", "quality", "time", "season", "weather", "birds", "mist", "paper" };
        readonly Dictionary<string, string> v = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        readonly string path = Path.Combine(Dir, "settings.ini");

        public Settings()
        {
            string[][] defaults = {
                new[] { "seed", "0" }, new[] { "theme", "yugen" }, new[] { "speed", "1" }, new[] { "fps", "30" }, new[] { "quality", "auto" },
                new[] { "time", "auto" }, new[] { "season", "auto" }, new[] { "weather", "auto" },
                new[] { "birds", "true" }, new[] { "mist", "true" }, new[] { "paper", "true" },
                new[] { "pauseFullscreen", "true" }, new[] { "pauseMaximized", "true" }, new[] { "pauseUnfocused", "true" }, new[] { "batteryFps", "15" },
            };
            foreach (var d in defaults) v[d[0]] = d[1];
            try
            {
                Directory.CreateDirectory(Dir);
                string src = path;
                foreach (string old in OldDirs)
                    if (!File.Exists(src)) src = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), old, "settings.ini");
                if (File.Exists(src))
                    foreach (string line in File.ReadAllLines(src))
                    {
                        int i = line.IndexOf('=');
                        if (i <= 0) continue;
                        string k = line.Substring(0, i).Trim(), val = line.Substring(i + 1).Trim();
                        if (k == "style") k = "style.shanshui";
                        v[k] = val;
                    }
                if (src != path) Save();
            }
            catch { }
        }
        public string this[string k]
        {
            get { string s; return v.TryGetValue(k, out s) ? s : ""; }
            set { v[k] = value; Save(); }
        }
        public bool Bool(string k) { return this[k] == "true"; }
        public int Int(string k, int def) { int r; return int.TryParse(this[k], NumberStyles.Integer, CultureInfo.InvariantCulture, out r) ? r : def; }
        public Dictionary<string, string> All() { return new Dictionary<string, string>(v); }
        void Save()
        {
            var sb = new StringBuilder();
            foreach (var kv in v) sb.Append(kv.Key).Append('=').Append(kv.Value).Append("\r\n");
            try { File.WriteAllText(path, sb.ToString()); } catch { }
        }
    }

    // What the page reports about each theme (web/themes/*.js), so the tray menu and the
    // gallery never need a C# change when a theme is added.
    class ThemeInfo
    {
        public string Id, Name, Native, Tagline, DefaultStyle;
        public List<string[]> Styles = new List<string[]>(), Weathers = new List<string[]>(), Toggles = new List<string[]>();

        public static List<ThemeInfo> Parse(object list)
        {
            var res = new List<ThemeInfo>();
            var arr = list as IList;
            if (arr == null) return res;
            foreach (object o in arr)
            {
                var d = o as IDictionary<string, object>;
                if (d == null) continue;
                var t = new ThemeInfo { Id = S(d, "id"), Name = S(d, "name"), Native = S(d, "native"), Tagline = S(d, "tagline"), DefaultStyle = S(d, "defaultStyle") };
                Pairs(d, "styles", t.Styles); Pairs(d, "weathers", t.Weathers); Pairs(d, "toggles", t.Toggles);
                if (t.Id.Length > 0) res.Add(t);
            }
            return res;
        }
        static string S(IDictionary<string, object> d, string k) { object o; return d.TryGetValue(k, out o) && o != null ? o.ToString() : ""; }
        static void Pairs(IDictionary<string, object> d, string k, List<string[]> into)
        {
            object o;
            if (!d.TryGetValue(k, out o) || !(o is IList)) return;
            foreach (object x in (IList)o)
            {
                var e = x as IDictionary<string, object>;
                if (e != null) into.Add(new[] { S(e, "id"), S(e, "name") });
            }
        }
    }

    // ------------------------------------------------------------------ application
    class Host : ApplicationContext
    {
        readonly Settings cfg = new Settings();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly List<Wall> walls = new List<Wall>();
        readonly System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer rebuild = new System.Windows.Forms.Timer();
        readonly string webDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly int pid = Process.GetCurrentProcess().Id;
        List<ThemeInfo> themes = new List<ThemeInfo>();
        ShellWatcher shell;
        CoreWebView2Environment env;
        Gallery gallery;
        bool userPaused, locked, building, unfocused;
        int seed, watchTicks;
        DateTime awaySince = DateTime.MinValue;
        HashSet<string> covered = new HashSet<string>();

        public Host()
        {
            seed = cfg.Int("seed", 0);
            if (seed <= 0) { seed = new Random().Next(1, 1000000000); cfg["seed"] = seed.ToString(CultureInfo.InvariantCulture); }

            tray.Icon = TrayIcon();
            Microsoft.Win32.SystemEvents.UserPreferenceChanged += delegate { UpdateIcon(); };
            tray.Text = Program.Name;
            tray.ContextMenuStrip = new ContextMenuStrip();
            tray.ContextMenuStrip.Opening += delegate { FillMenu(tray.ContextMenuStrip); };
            FillMenu(tray.ContextMenuStrip);
            tray.DoubleClick += delegate { OpenGallery(); };
            tray.Visible = true;

            // Fast tick for the focus rule; the heavier window scan runs every third tick.
            watch.Interval = 500;
            watch.Tick += delegate { Watch(); };
            watch.Start();
            rebuild.Interval = 1500;
            rebuild.Tick += delegate { rebuild.Stop(); Build(); };

            SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
            SystemEvents.SessionSwitch += OnSessionSwitch;
            shell = new ShellWatcher(ScheduleRebuild, OpenGallery); // explorer.exe restarted / second launch
            Build();
        }

        string Theme { get { return cfg["theme"]; } }
        ThemeInfo Current { get { foreach (var t in themes) if (t.Id == Theme) return t; return themes.Count > 0 ? themes[0] : null; } }
        string StyleOf(string theme)
        {
            string s = cfg["style." + theme];
            if (s.Length > 0) return s;
            foreach (var t in themes) if (t.Id == theme) return t.DefaultStyle;
            return "";
        }

        void ScheduleRebuild() { rebuild.Stop(); rebuild.Start(); }
        void OnDisplayChanged(object s, EventArgs e) { ScheduleRebuild(); }
        void OnSessionSwitch(object s, SessionSwitchEventArgs e)
        {
            if (e.Reason == SessionSwitchReason.SessionLock) locked = true;
            else if (e.Reason == SessionSwitchReason.SessionUnlock) { locked = false; ScheduleRebuild(); }
            UpdatePlayback();
        }

        string Url(int monitor)
        {
            var sb = new StringBuilder("https://" + Program.VirtualHost + "/index.html?seed=");
            sb.Append((seed + monitor * 7919).ToString(CultureInfo.InvariantCulture)).Append("&fps=").Append(EffectiveFps());
            sb.Append("&theme=").Append(Uri.EscapeDataString(Theme));
            string style = StyleOf(Theme);
            if (style.Length > 0) sb.Append("&style=").Append(Uri.EscapeDataString(style));
            foreach (string k in Settings.PageKeys) sb.Append('&').Append(k).Append('=').Append(Uri.EscapeDataString(cfg[k]));
            return sb.ToString();
        }

        async void Build()
        {
            if (building) { ScheduleRebuild(); return; }
            building = true;
            try
            {
                foreach (var w in walls) { try { w.Dispose(); } catch { } }
                walls.Clear();
                if (!Directory.Exists(webDir)) { Fail("The 'web' folder was not found next to Paperwall.exe."); return; }
                if (!Desktop.Find())
                    tray.ShowBalloonTip(4000, Program.Name, "Couldn't reach the desktop layer, so the wallpaper is running as a bottom-most window instead.", ToolTipIcon.Warning);
                if (!await EnsureEnv()) return;
                Screen[] screens = Screen.AllScreens;
                for (int i = 0; i < screens.Length; i++)
                {
                    var w = new Wall(screens[i], OnPageMessage);
                    walls.Add(w);
                    w.Start(env, webDir, Url(i));
                }
                UpdatePlayback();
            }
            catch (Exception ex) { tray.ShowBalloonTip(5000, Program.Name, ex.Message, ToolTipIcon.Error); }
            finally { building = false; }
        }

        async System.Threading.Tasks.Task<bool> EnsureEnv()
        {
            if (env != null) return true;
            var opts = new CoreWebView2EnvironmentOptions(
                "--disable-background-networking --disable-component-update --disable-sync --no-first-run " +
                "--disable-features=Translate,msSmartScreenProtection,msEdgeEnhanceImagesEnabled");
            try
            {
                env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Paperwall", "WebView2"), opts);
                return true;
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Fail("The Microsoft Edge WebView2 Runtime is not installed. Get it from https://developer.microsoft.com/microsoft-edge/webview2/");
                return false;
            }
        }

        // Messages from a wallpaper page: 'ready' carries the theme list.
        void OnPageMessage(string raw)
        {
            try
            {
                var m = json.DeserializeObject(raw) as IDictionary<string, object>;
                if (m == null) return;
                object type, list;
                if (m.TryGetValue("type", out type) && (string)type == "ready" && m.TryGetValue("themes", out list))
                {
                    var parsed = ThemeInfo.Parse(list);
                    if (parsed.Count > 0) { themes = parsed; UpdateIcon(); }
                }
            }
            catch { }
        }

        void Fail(string msg)
        {
            MessageBox.Show(msg, Program.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
        }

        int EffectiveFps()
        {
            int fps = cfg.Int("fps", 30);
            if (Native.OnBatteryOrSaver()) fps = Math.Min(fps, cfg.Int("batteryFps", 15));
            return fps;
        }

        // The focus rule: once something other than the desktop has been in front for 1.5 s,
        // stop painting. Clicking the desktop (or Win+D) starts it again straight away.
        void Watch()
        {
            bool away = cfg.Bool("pauseUnfocused") && !Native.DesktopInFront(pid);
            if (!away) awaySince = DateTime.MinValue;
            else if (awaySince == DateTime.MinValue) awaySince = DateTime.UtcNow;
            bool nowUnfocused = away && (DateTime.UtcNow - awaySince).TotalMilliseconds >= 1500;
            bool scan = ++watchTicks % 3 == 0;
            if (nowUnfocused != unfocused || scan) { unfocused = nowUnfocused; UpdatePlayback(scan); }
        }

        void UpdatePlayback() { UpdatePlayback(true); }
        // Pause each monitor's wallpaper while it can't be seen; throttle on battery.
        void UpdatePlayback(bool scan)
        {
            if (scan)
            {
                var found = new HashSet<string>();
                bool full = cfg.Bool("pauseFullscreen"), max = cfg.Bool("pauseMaximized");
                if (full || max)
                    Native.EnumWindows(delegate(IntPtr h, IntPtr l)
                    {
                        if (Native.Covers(h, full, max)) found.Add(Screen.FromHandle(h).DeviceName);
                        return true;
                    }, IntPtr.Zero);
                covered = found;
            }
            int fps = EffectiveFps();
            foreach (var w in walls)
            {
                w.SetPaused(userPaused || locked || unfocused || covered.Contains(w.Monitor.DeviceName));
                w.Set("fps", fps.ToString(CultureInfo.InvariantCulture));
            }
        }

        void TogglePause()
        {
            userPaused = !userPaused;
            UpdatePlayback();
            SendState();
        }

        void Push(string key)
        {
            foreach (var w in walls) w.Set(key, cfg[key]);
        }

        // One place where every setting change lands, from the tray or the gallery.
        void Apply(string key, string value)
        {
            if (key == "theme")
            {
                cfg["theme"] = value;
                foreach (var w in walls) w.Config(value, StyleOf(value));
                UpdateIcon();
            }
            else if (key == "style")
            {
                cfg["style." + Theme] = value;
                foreach (var w in walls) w.Set("style", value);
            }
            else if (key == "seed") NewScene();
            else
            {
                cfg[key] = value;
                if (key == "fps" || key == "batteryFps" || key.StartsWith("pause")) UpdatePlayback();
                else Push(key);
            }
            SendState();
        }

        void NewScene()
        {
            seed = new Random().Next(1, 1000000000);
            cfg["seed"] = seed.ToString(CultureInfo.InvariantCulture);
            for (int i = 0; i < walls.Count; i++) walls[i].Set("seed", (seed + i * 7919).ToString(CultureInfo.InvariantCulture));
        }

        // ------------------------------------------------------------------ gallery window
        async void OpenGallery()
        {
            if (gallery != null && !gallery.IsDisposed) { gallery.Bring(); return; }
            if (!await EnsureEnv()) return;
            gallery = new Gallery(OnGalleryMessage);
            gallery.FormClosed += delegate { gallery = null; };
            gallery.Start(env, webDir);
        }

        void OnGalleryMessage(string raw)
        {
            try
            {
                var m = json.DeserializeObject(raw) as IDictionary<string, object>;
                if (m == null) return;
                string type = m.ContainsKey("type") ? m["type"] as string : null;
                object val = m.ContainsKey("value") ? m["value"] : null;
                string sval = val is bool ? ((bool)val ? "true" : "false") : Convert.ToString(val, CultureInfo.InvariantCulture);
                if (type == "hello") SendState();
                else if (type == "set" && m.ContainsKey("key")) Apply((string)m["key"], sval);
                else if (type == "newScene") { NewScene(); SendState(); }
                else if (type == "pause") { userPaused = sval == "true"; UpdatePlayback(); SendState(); }
                else if (type == "autostart") { Autostart.Enabled = sval == "true"; SendState(); }
                else if (type == "reload") Build();
                else if (type == "openFolder") Process.Start("explorer.exe", "\"" + webDir + "\"");
            }
            catch { }
        }

        void SendState()
        {
            if (gallery == null || gallery.IsDisposed) return;
            var state = new Dictionary<string, object>();
            state["type"] = "state";
            var s = new Dictionary<string, object>();
            foreach (var kv in cfg.All()) s[kv.Key] = kv.Value;
            state["settings"] = s;
            state["autostart"] = Autostart.Enabled;
            state["paused"] = userPaused;
            state["native"] = true;
            gallery.Post(json.Serialize(state));
        }

        // ------------------------------------------------------------------ tray menu
        // Rebuilt every time it opens, so it always matches the current theme.
        Font boldFont;
        void FillMenu(ContextMenuStrip m)
        {
            var old = new List<ToolStripItem>();
            foreach (ToolStripItem it in m.Items) old.Add(it);
            m.Items.Clear();
            foreach (var it in old) it.Dispose();
            var open = new ToolStripMenuItem("Open " + Program.Name + "...", null, delegate { OpenGallery(); });
            if (boldFont == null) boldFont = new Font(open.Font, FontStyle.Bold);
            open.Font = boldFont;
            m.Items.Add(open);
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem(userPaused ? "Resume" : "Pause", null, delegate { TogglePause(); }));
            m.Items.Add(new ToolStripMenuItem("New scene", null, delegate { NewScene(); SendState(); }));
            m.Items.Add(new ToolStripSeparator());

            var cur = Current;
            if (themes.Count > 0)
            {
                var th = new ToolStripMenuItem("Theme");
                foreach (var t in themes)
                {
                    string id = t.Id;
                    th.DropDownItems.Add(new ToolStripMenuItem(t.Name + "   " + t.Tagline, null, delegate { Apply("theme", id); }) { Checked = id == Theme });
                }
                m.Items.Add(th);
            }
            if (cur != null && cur.Styles.Count > 0) m.Items.Add(Choice("Style", "style", cur.Styles, StyleOf(cur.Id)));
            m.Items.Add(Choice("Speed", "speed", new[] { "Very slow|0.4", "Slow|0.7", "Normal|1", "Fast|2", "Very fast|4" }));
            m.Items.Add(Choice("Time of day", "time", new[] { "Follow the clock|auto", "Dawn|dawn", "Day|day", "Dusk|dusk", "Night|night", "Fast day cycle|cycle" }));
            m.Items.Add(Choice("Season", "season", new[] { "Follow the calendar|auto", "Spring|spring", "Summer|summer", "Autumn|autumn", "Winter|winter" }));
            if (cur != null && cur.Weathers.Count > 0) m.Items.Add(Choice("Weather", "weather", cur.Weathers, cfg["weather"]));
            else m.Items.Add(Choice("Weather", "weather", new[] { "Automatic|auto", "Clear|none", "Rain|rain", "Snow|snow" }));
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(Choice("Resolution", "quality", new[] { "Auto (matches your screen)|auto", "720p (weak GPUs)|low", "1080p|1080p", "1440p / 2K|1440p", "2160p / 4K|4k", "Native (any size)|native" }));
            m.Items.Add(Choice("Frame rate", "fps", new[] { "15 fps (lightest)|15", "24 fps|24", "30 fps|30", "60 fps|60" }));
            var opts = new ToolStripMenuItem("Options");
            if (cur != null && cur.Toggles.Count > 0) foreach (var tg in cur.Toggles) opts.DropDownItems.Add(Toggle(tg[1], tg[0]));
            else { opts.DropDownItems.Add(Toggle("Birds", "birds")); opts.DropDownItems.Add(Toggle("Drifting mist", "mist")); opts.DropDownItems.Add(Toggle("Paper texture", "paper")); }
            opts.DropDownItems.Add(new ToolStripSeparator());
            opts.DropDownItems.Add(Toggle("Pause when another app is in front", "pauseUnfocused"));
            opts.DropDownItems.Add(Toggle("Pause behind fullscreen apps", "pauseFullscreen"));
            opts.DropDownItems.Add(Toggle("Pause behind maximized windows", "pauseMaximized"));
            opts.DropDownItems.Add(Choice("On battery / energy saver", "batteryFps", new[] { "Keep normal frame rate|240", "Limit to 15 fps|15", "Limit to 10 fps|10" }));
            opts.DropDownItems.Add(new ToolStripSeparator());
            var auto = new ToolStripMenuItem("Start with Windows") { Checked = Autostart.Enabled, CheckOnClick = true };
            auto.CheckedChanged += delegate { Autostart.Enabled = auto.Checked; SendState(); };
            opts.DropDownItems.Add(auto);
            m.Items.Add(opts);
            m.Items.Add(new ToolStripMenuItem("Reload wallpaper", null, delegate { Build(); }));
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add(new ToolStripMenuItem("Exit", null, delegate { Quit(); }));
        }

        ToolStripMenuItem Choice(string title, string key, string[] items)
        {
            var l = new List<string[]>();
            foreach (string spec in items) l.Add(new[] { spec.Split('|')[1], spec.Split('|')[0] });
            return Choice(title, key, l, cfg[key]);
        }
        ToolStripMenuItem Choice(string title, string key, List<string[]> items, string current)
        {
            var root = new ToolStripMenuItem(title);
            foreach (var p in items)
            {
                string val = p[0];
                root.DropDownItems.Add(new ToolStripMenuItem(p[1], null, delegate { Apply(key, val); }) { Checked = current == val });
            }
            return root;
        }

        ToolStripMenuItem Toggle(string title, string key)
        {
            var it = new ToolStripMenuItem(title) { Checked = cfg.Bool(key), CheckOnClick = true };
            it.CheckedChanged += delegate { Apply(key, it.Checked ? "true" : "false"); };
            return it;
        }

        void Quit()
        {
            watch.Stop();
            SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
            SystemEvents.SessionSwitch -= OnSessionSwitch;
            if (gallery != null && !gallery.IsDisposed) gallery.Close();
            foreach (var w in walls) { try { w.Dispose(); } catch { } }
            walls.Clear();
            tray.Visible = false;
            Desktop.RedrawWallpaper();
            if (shell != null) shell.DestroyHandle();
            ExitThread();
        }

        void UpdateIcon()
        {
            var t = Current;
            var old = tray.Icon;
            tray.Icon = TrayIcon();
            tray.Text = Program.Name + (t != null ? " - " + t.Name : "");
            if (old != null) old.Dispose();
        }

        // The app icon from the exe's resources. The tray gets the paper-coloured tile on a dark
        // taskbar and the ink tile on a light one, so it reads on both.
        public static Icon AppIcon(bool light, Size size)
        {
            using (var st = typeof(Host).Assembly.GetManifestResourceStream(light ? "Paperwall.light.ico" : "Paperwall.ico"))
                return new Icon(st, size);
        }
        static Icon TrayIcon()
        {
            bool lightTaskbar = false;
            try
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    lightTaskbar = k != null && Convert.ToInt32(k.GetValue("SystemUsesLightTheme", 0)) == 1;
            }
            catch { }
            return AppIcon(!lightTaskbar, SystemInformation.SmallIconSize);
        }
    }

    // ------------------------------------------------------------------ gallery window
    class Gallery : Form
    {
        static readonly Color Ink = Color.FromArgb(20, 18, 16);
        readonly WebView2 web = new WebView2();
        readonly Action<string> onMessage;

        public Gallery(Action<string> onMessage)
        {
            this.onMessage = onMessage;
            Text = Program.Name;
            Icon = Host.AppIcon(false, new Size(32, 32));
            BackColor = Ink;
            StartPosition = FormStartPosition.CenterScreen;
            var wa = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1320, wa.Width - 80), Math.Min(840, wa.Height - 60));
            MinimumSize = new Size(900, 600);
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Ink;
            Controls.Add(web);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int dark = 1; // dark title bar to match the page
            try { Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4); } catch { }
        }

        public async void Start(CoreWebView2Environment env, string webDir)
        {
            Show();
            try
            {
                await web.EnsureCoreWebView2Async(env);
                if (IsDisposed) return;
                var c = web.CoreWebView2;
                c.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("PAPERWALL_DEVTOOLS") == "1";
                c.Settings.IsStatusBarEnabled = false;
                c.Settings.IsZoomControlEnabled = false;
                c.Settings.AreDefaultContextMenusEnabled = false;
                c.Settings.IsGeneralAutofillEnabled = false;
                c.Settings.IsPasswordAutosaveEnabled = false;
                c.SetVirtualHostNameToFolderMapping(Program.VirtualHost, webDir, CoreWebView2HostResourceAccessKind.Allow);
                c.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                c.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e) { onMessage(e.WebMessageAsJson); };
                c.Navigate("https://" + Program.VirtualHost + "/gallery.html");
            }
            catch (Exception) { }
        }

        public void Post(string json)
        {
            if (IsDisposed || web.CoreWebView2 == null) return;
            try { web.CoreWebView2.PostWebMessageAsJson(json); } catch { }
        }

        public void Bring()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }
    }

    // ------------------------------------------------------------------ one wallpaper window per monitor
    class Wall : Form
    {
        static readonly Color Paper = Color.FromArgb(240, 233, 216);
        readonly WebView2 web = new WebView2();
        readonly Dictionary<string, string> sent = new Dictionary<string, string>();
        readonly Action<string> onMessage;
        public readonly Screen Monitor;
        bool paused, ready;

        public Wall(Screen s, Action<string> onMessage)
        {
            Monitor = s;
            this.onMessage = onMessage;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = Paper;
            Bounds = new Rectangle(-32000, -32000, s.Bounds.Width, s.Bounds.Height); // off-screen until attached
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Paper;
            Controls.Add(web);
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE; return cp; }
        }
        protected override bool ShowWithoutActivation { get { return true; } }

        public async void Start(CoreWebView2Environment env, string webDir, string url)
        {
            Show();
            Desktop.Attach(Handle, Monitor.Bounds);
            try
            {
                await web.EnsureCoreWebView2Async(env);
                if (IsDisposed) return;
                var c = web.CoreWebView2;
                var st = c.Settings;
                st.AreDefaultContextMenusEnabled = false;
                st.AreDevToolsEnabled = false;
                st.IsStatusBarEnabled = false;
                st.IsZoomControlEnabled = false;
                st.AreBrowserAcceleratorKeysEnabled = false;
                st.AreDefaultScriptDialogsEnabled = false;
                st.IsPinchZoomEnabled = false;
                st.IsSwipeNavigationEnabled = false;
                st.IsGeneralAutofillEnabled = false;
                st.IsPasswordAutosaveEnabled = false;
                c.SetVirtualHostNameToFolderMapping(Program.VirtualHost, webDir, CoreWebView2HostResourceAccessKind.Allow);
                c.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                c.WebMessageReceived += delegate(object s, CoreWebView2WebMessageReceivedEventArgs e) { onMessage(e.WebMessageAsJson); };
                c.NavigationCompleted += delegate
                {
                    ready = true;
                    sent.Clear();
                    if (paused) Post("{\"type\":\"pause\",\"value\":true}");
                };
                c.Navigate(url);
            }
            catch (Exception) { /* window was torn down (display change / explorer restart); a rebuild follows */ }
        }

        void Post(string json)
        {
            if (!ready || IsDisposed || web.CoreWebView2 == null) return;
            try { web.CoreWebView2.PostWebMessageAsJson(json); } catch { }
        }

        static string Js(string value)
        {
            double num;
            bool raw = value == "true" || value == "false" || double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out num);
            return raw ? value : "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        public void Set(string key, string value)
        {
            string old;
            if (sent.TryGetValue(key, out old) && old == value) return;
            if (!ready) return;
            sent[key] = value;
            Post("{\"type\":\"set\",\"key\":\"" + key + "\",\"value\":" + Js(value) + "}");
        }

        // Switch theme and its style in one message, so the new theme starts in the right style.
        public void Config(string theme, string style)
        {
            if (!ready) return;
            sent["style"] = style;
            Post("{\"type\":\"config\",\"value\":{\"theme\":" + Js(theme) + (style.Length > 0 ? ",\"style\":" + Js(style) : "") + "}}");
        }

        public void SetPaused(bool p)
        {
            if (p == paused) return;
            paused = p;
            Post("{\"type\":\"pause\",\"value\":" + (p ? "true" : "false") + "}");
            try
            {
                if (web.CoreWebView2 != null)
                    web.CoreWebView2.MemoryUsageTargetLevel = p ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
            }
            catch { }
        }
    }

    // ------------------------------------------------------------------ desktop layer
    static class Desktop
    {
        static IntPtr progman, workerw, defView;
        static bool raised; // Windows 11 24H2+: icons and wallpaper are both children of Progman
        public static bool Layered = Environment.GetEnvironmentVariable("PAPERWALL_LAYERED") != "0";

        public static bool Find()
        {
            progman = Native.FindWindow("Progman", null);
            workerw = defView = IntPtr.Zero;
            if (progman == IntPtr.Zero) return false;
            IntPtr res;
            // Ask Explorer to split the wallpaper into its own WorkerW layer.
            Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
            Native.SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);

            IntPtr childDef = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            IntPtr childWorker = Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
            if (childDef != IntPtr.Zero && childWorker != IntPtr.Zero)
            {
                raised = true; defView = childDef; workerw = childWorker;
                return true;
            }
            raised = false;
            Native.EnumWindows(delegate(IntPtr top, IntPtr l)
            {
                IntPtr dv = Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (dv != IntPtr.Zero) { defView = dv; workerw = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null); }
                return true;
            }, IntPtr.Zero);
            return workerw != IntPtr.Zero;
        }

        public static void Attach(IntPtr hwnd, Rectangle screen)
        {
            IntPtr parent = raised ? progman : workerw;
            if (parent == IntPtr.Zero)
            {   // fallback: plain bottom-most window
                Native.SetWindowPos(hwnd, new IntPtr(1), screen.X, screen.Y, screen.Width, screen.Height, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
                return;
            }
            int style = Native.GetWindowLong(hwnd, Native.GWL_STYLE);
            style = (style & ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME)) | Native.WS_CHILD;
            Native.SetWindowLong(hwnd, Native.GWL_STYLE, style);
            if (raised && Layered)
            {
                int ex = Native.GetWindowLong(hwnd, Native.GWL_EXSTYLE) | Native.WS_EX_LAYERED;
                Native.SetWindowLong(hwnd, Native.GWL_EXSTYLE, ex);
                Native.SetLayeredWindowAttributes(hwnd, 0, 255, 2 /*LWA_ALPHA*/);
            }
            Native.SetParent(hwnd, parent);
            var r = new Native.RECT { Left = screen.Left, Top = screen.Top, Right = screen.Right, Bottom = screen.Bottom };
            Native.MapWindowPoints(IntPtr.Zero, parent, ref r, 2);
            // In the raised layout, sit directly beneath the icon layer (and above the static wallpaper).
            IntPtr after = raised ? defView : IntPtr.Zero;
            uint flags = Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | (raised ? 0u : Native.SWP_NOZORDER);
            Native.SetWindowPos(hwnd, after, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, flags);
        }

        // Re-apply the user's static wallpaper so no stale frame lingers after exit.
        public static void RedrawWallpaper()
        {
            var sb = new StringBuilder(1024);
            if (Native.SystemParametersInfo(0x0073 /*SPI_GETDESKWALLPAPER*/, (uint)sb.Capacity, sb, 0))
                Native.SystemParametersInfo(0x0014 /*SPI_SETDESKWALLPAPER*/, 0, sb, 0);
        }
    }

    // Detects explorer.exe restarts so the wallpaper can re-attach, and a second launch of the
    // app (which asks this one to open the gallery instead).
    class ShellWatcher : NativeWindow
    {
        readonly int taskbar = (int)Native.RegisterWindowMessage("TaskbarCreated");
        readonly int open = (int)Native.RegisterWindowMessage("Paperwall.Open");
        readonly Action onShell, onOpen;
        public ShellWatcher(Action shellCb, Action openCb)
        {
            onShell = shellCb; onOpen = openCb;
            CreateHandle(new CreateParams());
            try { Native.ChangeWindowMessageFilterEx(Handle, (uint)open, 1, IntPtr.Zero); } catch { }
        }
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == taskbar) onShell();
            else if (m.Msg == open) onOpen();
            base.WndProc(ref m);
        }
    }

    static class Autostart
    {
        const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run", Name = "Paperwall";
        static readonly string[] OldNames = { "Driftscape", "ShanShuiWallpaper" };
        public static bool Enabled
        {
            get { using (var k = Registry.CurrentUser.OpenSubKey(Key)) return k != null && k.GetValue(Name) != null; }
            set
            {
                using (var k = Registry.CurrentUser.CreateSubKey(Key))
                {
                    if (value) k.SetValue(Name, "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue(Name, false);
                    foreach (string old in OldNames) k.DeleteValue(old, false); // the app's old names; never start two
                }
            }
        }
        // Someone who had Start with Windows on under an old name keeps it under the new one.
        public static void Migrate()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(Key))
                {
                    if (k == null) return;
                    bool had = false;
                    foreach (string old in OldNames) if (k.GetValue(old) != null) had = true;
                    if (!had) return;
                }
                Enabled = true;
            }
            catch { }
        }
    }

    // ------------------------------------------------------------------ Win32
    static class Native
    {
        public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
        public const int WS_CHILD = 0x40000000, WS_POPUP = unchecked((int)0x80000000), WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
        public const int WS_EX_TOOLWINDOW = 0x80, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;
        public const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

        public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        public struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
        [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool ChangeWindowMessageFilterEx(IntPtr h, uint msg, uint action, IntPtr info);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
        [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int idx, int v);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("user32.dll")] public static extern int MapWindowPoints(IntPtr from, IntPtr to, ref RECT r, int n);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string s);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool SystemParametersInfo(uint action, uint p, StringBuilder v, uint flags);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
        [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);

        public static bool OnBatteryOrSaver()
        {
            SYSTEM_POWER_STATUS s;
            if (!GetSystemPowerStatus(out s)) return false;
            return s.ACLineStatus == 0 || s.SystemStatusFlag == 1;
        }

        static readonly HashSet<string> ShellClasses = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow" };
        // Windows that count as "looking at the desktop": the desktop itself, the taskbar and
        // its tray flyouts. Our own windows (tray menu, gallery) count too.
        static readonly HashSet<string> DesktopClasses = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland" };

        public static bool DesktopInFront(int ownPid)
        {
            IntPtr h = GetForegroundWindow();
            if (h == IntPtr.Zero) return true;
            int fpid;
            GetWindowThreadProcessId(h, out fpid);
            if (fpid == ownPid) return true;
            var sb = new StringBuilder(64);
            GetClassName(h, sb, 64);
            return DesktopClasses.Contains(sb.ToString());
        }

        // True when a real, visible app window is maximized or covers its whole monitor.
        public static bool Covers(IntPtr h, bool full, bool max)
        {
            if (!IsWindowVisible(h) || IsIconic(h)) return false;
            int ex = GetWindowLong(h, GWL_EXSTYLE);
            if ((ex & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)) != 0) return false;
            int cloaked;
            if (DwmGetWindowAttribute(h, 14 /*DWMWA_CLOAKED*/, out cloaked, 4) == 0 && cloaked != 0) return false;
            var sb = new StringBuilder(64);
            GetClassName(h, sb, 64);
            if (ShellClasses.Contains(sb.ToString())) return false;
            if (max && IsZoomed(h)) return true;
            if (!full) return false;
            RECT r;
            if (!GetWindowRect(h, out r)) return false;
            Rectangle s = Screen.FromHandle(h).Bounds;
            return r.Left <= s.Left && r.Top <= s.Top && r.Right >= s.Right && r.Bottom >= s.Bottom;
        }
    }
}
