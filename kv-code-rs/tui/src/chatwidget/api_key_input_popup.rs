use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::style::Style;

pub(crate) struct ApiKeyPopup {
    pub(crate) visible: bool,
    pub(crate) provider_name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) error: Option<String>,
    pub(crate) saved: bool,
}

impl ApiKeyPopup {
    pub(crate) fn new() -> Self {
        Self { visible: false, provider_name: String::new(), base_url: String::new(), api_key: String::new(), error: None, saved: false }
    }

    pub(crate) fn open(&mut self, name: &str, base_url: &str) {
        self.provider_name = name.to_string();
        self.base_url = base_url.to_string();
        self.api_key.clear();
        self.error = None;
        self.saved = false;
        self.visible = true;
    }

    pub(crate) fn handle_key(&mut self, key: KeyEvent) -> bool {
        if !self.visible { return false; }
        match key.code {
            KeyCode::Esc => { self.visible = false; true }
            KeyCode::Enter => {
                if self.api_key.trim().is_empty() {
                    self.error = Some("API key cannot be empty".to_string());
                } else {
                    let codex_home = std::env::var("KV_CODE_HOME")
                        .or_else(|_| std::env::var("CODEX_HOME"))
                        .unwrap_or_else(|_| {
                            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
                            format!("{}/.kv-code", home)
                        });
                    let config_path = std::path::Path::new(&codex_home).join("config.toml");
                    let mut content = std::fs::read_to_string(&config_path).unwrap_or_default();
                    content.push_str(&format!("\n[providers.{}]\ntype = \"openai\"\nbase_url = \"{}\"\napi_key = \"{}\"\n", self.provider_name, self.base_url, self.api_key.trim()));
                    match std::fs::write(&config_path, &content) {
                        Ok(()) => { self.saved = true; self.error = None; }
                        Err(e) => { self.error = Some(format!("Failed to save: {}", e)); }
                    }
                }
                true
            }
            KeyCode::Char(c) => { self.api_key.push(c); true }
            KeyCode::Backspace => { self.api_key.pop(); true }
            KeyCode::Delete => { self.api_key.clear(); true }
            _ => false,
        }
    }

    pub(crate) fn render(&self, _area: Rect, buf: &mut Buffer) {
        //eprintln!("[KVCODE] render v={} buf={}x{}", self.visible, buf.area.width, buf.area.height);
        if !self.visible || buf.area.width < 40 || buf.area.height < 10 { return; }
        let w = 56i16.min((buf.area.width as i16).saturating_sub(4)) as u16;
        let h = 10i16.min((buf.area.height as i16).saturating_sub(2)) as u16;
        let x0 = (buf.area.width - w) / 2;
        let y0 = (buf.area.height - h) / 2;
        let style = Style::default().fg(Color::Cyan);

        for y in y0..y0 + h {
            for x in x0..x0 + w {
                if x < buf.area.width && y < buf.area.height { buf[(x, y)].reset(); }
            }
        }

        let hz = "-";
        let vt = "|";
        let tl = "+"; let tr = "+";
        let bl = "+"; let br = "+";

        if x0 < buf.area.width && y0 < buf.area.height { buf[(x0, y0)].set_symbol(tl).set_style(style); }
        if x0 + w - 1 < buf.area.width && y0 < buf.area.height { buf[(x0 + w - 1, y0)].set_symbol(tr).set_style(style); }
        if x0 < buf.area.width && y0 + h - 1 < buf.area.height { buf[(x0, y0 + h - 1)].set_symbol(bl).set_style(style); }
        if x0 + w - 1 < buf.area.width && y0 + h - 1 < buf.area.height { buf[(x0 + w - 1, y0 + h - 1)].set_symbol(br).set_style(style); }

        for x in x0 + 1..x0 + w - 1 {
            if x < buf.area.width && y0 < buf.area.height { buf[(x, y0)].set_symbol(hz).set_style(style); }
            if x < buf.area.width && y0 + h - 1 < buf.area.height { buf[(x, y0 + h - 1)].set_symbol(hz).set_style(style); }
        }
        for y in y0 + 1..y0 + h - 1 {
            if x0 < buf.area.width && y < buf.area.height { buf[(x0, y)].set_symbol(vt).set_style(style); }
            if x0 + w - 1 < buf.area.width && y < buf.area.height { buf[(x0 + w - 1, y)].set_symbol(vt).set_style(style); }
        }

        let title = " API Key ";
        for (i, c) in title.chars().enumerate() {
            let cx = x0 + 2 + i as u16;
            if cx < buf.area.width && y0 < buf.area.height { buf[(cx, y0)].set_symbol(&c.to_string()).set_style(style); }
        }

        let texts: Vec<String> = if self.saved {
            vec![format!(" Saved provider: {}", self.provider_name), " Press ESC to close.".into()]
        } else {
            let mut t = vec![
                format!(" Configure {}", self.provider_name),
                format!(" URL: {}", self.base_url),
                "".into(),
                format!(" API Key: {}", mask_key(&self.api_key)),
            ];
            if let Some(err) = &self.error { t.push(format!(" Error: {err}")); }
            t.push("".into());
            t.push(" Type your key, Enter to save, ESC to cancel".into());
            t
        };
        for (i, text) in texts.iter().enumerate() {
            let ty = y0 + 1 + i as u16;
            if ty >= y0 + h - 1 { break; }
            for (j, c) in text.chars().enumerate() {
                let tx = x0 + j as u16;
                if tx >= x0 + w { break; }
                if tx < buf.area.width && ty < buf.area.height {
                    buf[(tx, ty)].set_symbol(&c.to_string());
                }
            }
        }
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 { return "********".to_string(); }
    format!("{}****{}", &key[..4], &key[key.len()-4..])
}
