use crossterm::event::{KeyCode, KeyEvent};
use ratatui::buffer::Buffer;
use ratatui::layout::{Rect, Alignment};
use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap, Clear};
use crate::style::user_message_style;

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
                    let codex_home = std::env::var("KV_CODE_HOME")
                        .or_else(|_| std::env::var("CODEX_HOME"))
                        .unwrap_or_else(|_| {
                            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
                            format!("{}/.kv-code", home)
                        });
                    let config_path = std::path::Path::new(&codex_home).join("config.toml");
                    let mut content = std::fs::read_to_string(&config_path).unwrap_or_default();
                    let header = format!("[providers.{}]", self.provider_name);
                    if !content.contains(&header) {
                        content.push_str(&format!("\n[providers.{}]\ntype = \"openai\"\nbase_url = \"{}\"\napi_key = \"{}\"\n", self.provider_name, self.base_url, self.api_key.trim()));
                    }
                    let _ = std::fs::write(&config_path, &content);
                    self.saved = true;
                }
                true
            }
            KeyCode::Char(c) => { if !self.saved { self.api_key.push(c); } true }
            KeyCode::Backspace => { if !self.saved { self.api_key.pop(); } true }
            KeyCode::Delete => { if !self.saved { self.api_key.clear(); } true }
            _ => false,
        }
    }

    pub(crate) fn render(&self, area: Rect, buf: &mut Buffer) {
        if !self.visible { return; }
        let fw = buf.area.width;
        let fh = buf.area.height;
        if fw < 30 || fh < 10 { return; }

        // Full-screen semi-transparent overlay
        let overlay = Rect { x: 0, y: 0, width: fw, height: fh };
        Clear.render(overlay, buf);

        // Chat bubble style - like a user message in the chat
        let bubble_w = 44.min(fw.saturating_sub(8));
        let bubble_h = 6;
        let bx = fw.saturating_sub(bubble_w) - 2;
        let by = 8.min(fh.saturating_sub(bubble_h + 4));
        let bubble = Rect { x: bx, y: by, width: bubble_w, height: bubble_h };

        // Draw user-message-style bubble background
        let style = user_message_style();
        for y in by..by + bubble_h {
            for x in bx..bx + bubble_w {
                if x < fw && y < fh { buf[(x, y)].set_style(style); }
            }
        }

        if self.saved {
            let msg = format!(" API Key saved for {}! [ESC]", self.provider_name);
            Paragraph::new(msg).render(bubble, buf);
            return;
        }

        // Title line
        let title = format!(" API Key for {} ", self.provider_name);
        for (i, c) in title.chars().enumerate() {
            let cx = bx + 2 + i as u16;
            if cx < fw && by < fh { buf[(cx, by)].set_symbol(&c.to_string()).set_style(Style::default().fg(Color::White).bold()); }
        }

        // Dots for API key
        let dot = "\u{2022}";
        let dots: String = self.api_key.chars().map(|_| dot).collect();
        let display = if dots.is_empty() { "Type your API key...".into() } else { dots };

        // Input area styled like chat message
        for (i, c) in display.chars().enumerate() {
            let cx = bx + 2 + i as u16;
            let cy = by + 2;
            if cx < fw && cy < fh { buf[(cx, cy)].set_symbol(&c.to_string()).set_style(Style::default().fg(Color::Cyan)); }
        }

        // Hint at bottom
        let hint = "[Enter] Save  [ESC] Cancel";
        for (i, c) in hint.chars().enumerate() {
            let cx = bx + 2 + i as u16;
            let cy = by + 4;
            if cx < fw && cy < fh { buf[(cx, cy)].set_symbol(&c.to_string()).set_style(Style::default().fg(Color::DarkGray)); }
        }
    }
}
