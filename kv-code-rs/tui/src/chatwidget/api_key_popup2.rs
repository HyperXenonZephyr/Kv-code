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
                    // Save logic here...
                    self.saved = true;
                }
                true
            }
            KeyCode::Char(c) => { if !self.saved { self.api_key.push(c); } true }
            KeyCode::Backspace => { if !self.saved { self.api_key.pop(); } true }
            _ => false,
        }
    }

    pub(crate) fn render(&self, _area: Rect, buf: &mut Buffer) {
        if !self.visible { return; }
        let fw = buf.area.width;
        let fh = buf.area.height;
        if fw < 20 || fh < 5 { return; }

        let w = 50.min(fw.saturating_sub(4));
        let h = 7.min(fh.saturating_sub(2));
        let x = (fw - w) / 2;
        let y = (fh - h) / 2;
        let popup = Rect { x, y, width: w, height: h };

        Clear.render(popup, buf);

        let title = format!(" Enter API Key for {} ", self.provider_name);
        let text = if self.saved {
            format!("Saved! Press ESC to continue.")
        } else {
            format!("Key: {}\n\nType & Enter to save, ESC to cancel", mask_key(&self.api_key))
        };

        Paragraph::new(text)
            .block(Block::default().title(title).borders(Borders::ALL))
            .wrap(Wrap { trim: false })
            .render(popup, buf);
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 { return "********".to_string(); }
    format!("{}****{}", &key[..4], &key[key.len()-4..])
}
