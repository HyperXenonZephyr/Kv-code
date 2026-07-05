use crossterm::event::{KeyCode, KeyEvent};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap, Clear};

pub(crate) struct ApiKeyPopup2 {
    pub(crate) visible: bool,
    pub(crate) provider_name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) saved: bool,
}

impl ApiKeyPopup2 {
    pub(crate) fn new() -> Self {
        Self { visible: false, provider_name: String::new(), base_url: String::new(), api_key: String::new(), saved: false }
    }

    pub(crate) fn open(&mut self, name: &str, url: &str) {
        self.provider_name = name.to_string();
        self.base_url = url.to_string();
        self.api_key.clear();
        self.saved = false;
        self.visible = true;
    }

    pub(crate) fn handle_key(&mut self, key: KeyEvent) -> bool {
        if !self.visible { return false; }
        match key.code {
            KeyCode::Esc => { self.visible = false; true }
            KeyCode::Enter => {
                if !self.api_key.trim().is_empty() && !self.saved {
                    let home = std::env::var("KV_CODE_HOME")
                        .or_else(|_| std::env::var("CODEX_HOME"))
                        .unwrap_or_else(|_| {
                            let h = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
                            format!("{}/.kv-code", h)
                        });
                    let p = std::path::Path::new(&home).join("config.toml");
                    let mut c = std::fs::read_to_string(&p).unwrap_or_default();
                    let hdr = format!("[model_providers.{}]", self.provider_name);
                    if !c.contains(&hdr) {
                        c.push_str(&format!("\n[model_providers.{}]\ntype = \"openai\"\nbase_url = \"{}\"\napi_key = \"{}\"\n", self.provider_name, self.base_url, self.api_key.trim()));
                    }
                    let _ = std::fs::write(&p, &c);
                    self.saved = true;
                }
                true
            }
            KeyCode::Char(c) => { if !self.saved { self.api_key.push(c); } true }
            KeyCode::Backspace => { if !self.saved { self.api_key.pop(); } true }
            _ => false,
        }
    }

    pub(crate) fn render(&self, area: Rect, buf: &mut Buffer) {
        if !self.visible || area.width < 20 || area.height < 5 { return; }
        // Use area (full frame) for positioning, NOT buf.area (sub-buffer)
        let pw = 46.min(area.width.saturating_sub(4));
        let ph = 6.min(area.height.saturating_sub(2));
        let px = (area.width - pw) / 2;
        let py = (area.height - ph) / 3;
        let popup = Rect { x: area.x + px, y: area.y + py, width: pw, height: ph };

        let title = if self.saved {
            format!(" Saved: {} API Key ", self.provider_name)
        } else {
            format!(" Enter API Key for {} ", self.provider_name)
        };

        let bullet = "\u{2022}";
        let dots: String = self.api_key.chars().map(|_| bullet).collect();
        let display = if self.api_key.is_empty() { "(type your key...)".to_string() } else { dots };

        let text = if self.saved {
            "API Key saved! Press ESC to close.".to_string()
        } else {
            format!("{}\n\n[Enter] Save  [ESC] Cancel", display)
        };

        Clear.render(popup, buf);
        Paragraph::new(text)
            .block(Block::default().title(title).borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)))
            .wrap(Wrap { trim: false })
            .render(popup, buf);
    }
}
