//! API Key input popup for configuring providers.
//!
//! Shows a centered popup where the user can type or paste an API key for a
//! provider, then saves it to config.toml on submit.

use crossterm::event::KeyCode;
use crossterm::event::KeyEvent;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::prelude::Widget;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::widgets::Block;
use ratatui::widgets::Borders;
use ratatui::widgets::Clear;
use ratatui::widgets::Paragraph;
use ratatui::widgets::Wrap;

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
        Self {
            visible: false,
            provider_name: String::new(),
            base_url: String::new(),
            api_key: String::new(),
            error: None,
            saved: false,
        }
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
        if !self.visible {
            return false;
        }
        match key.code {
            KeyCode::Esc => {
                self.visible = false;
                true
            }
            KeyCode::Enter => {
                if self.api_key.trim().is_empty() {
                    self.error = Some("API key cannot be empty".to_string());
                } else {
                    // Save to config.toml
                    let codex_home = std::env::var("KV_CODE_HOME")
                        .or_else(|_| std::env::var("CODEX_HOME"))
                        .unwrap_or_else(|_| {
                            let home = std::env::var("HOME")
                                .or_else(|_| std::env::var("USERPROFILE"))
                                .unwrap_or_default();
                            format!("{}\\.kv-code", home)
                        });
                    let config_path = std::path::Path::new(&codex_home).join("config.toml");

                    // Read existing config or create new
                    let mut content = std::fs::read_to_string(&config_path).unwrap_or_default();

                    // Add/update provider config using TOML table syntax
                    let provider_section = format!(
                        "\n[model_providers.{}]\ntype = \"openai\"\nbase_url = \"{}\"\napi_key = \"{}\"\n",
                        self.provider_name.to_lowercase(),
                        self.base_url,
                        self.api_key.trim()
                    );
                    content.push_str(&provider_section);

                    match std::fs::write(&config_path, &content) {
                        Ok(()) => {
                            self.saved = true;
                            self.error = None;
                        }
                        Err(e) => {
                            self.error = Some(format!("Failed to save: {}", e));
                        }
                    }
                }
                true
            }
            KeyCode::Char(c) => {
                self.api_key.push(c);
                true
            }
            KeyCode::Backspace => {
                self.api_key.pop();
                true
            }
            KeyCode::Delete => {
                self.api_key.clear();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn render(&self, area: Rect, buf: &mut Buffer) {
        if !self.visible { return; }
        // Clamp popup to buffer bounds to prevent panic
        let buf_width = buf.area.width;
        let buf_height = buf.area.height;
        if buf_width == 0 || buf_height == 0 { return; }
        if !self.visible {
            return;
        }

        let safe_width = buf.area.width.max(20);
        let safe_height = buf.area.height.max(10);
        let popup_width = (safe_width / 2).min(60);
        let popup_height = 12u16.min(safe_height.saturating_sub(4));
        let popup_x = safe_width.saturating_sub(popup_width) / 2;
        let popup_y = safe_height.saturating_sub(popup_height) / 2;
        let popup_area = Rect {
            x: popup_x,
            y: popup_y,
            width: popup_width,
            height: popup_height,
        };
        if popup_area.width == 0 || popup_area.height == 0 {
            return;
        }

        Clear.render(popup_area, buf);

        let mut lines = vec![];

        if self.saved {
            lines.push(Line::from(format!(
                "  Saved provider: {}",
                self.provider_name
            )));
            lines.push(Line::from("  Press ESC to close."));
        } else {
            lines.push(Line::from(format!("  Configure {}", self.provider_name)));
            lines.push(Line::from(format!("  URL: {}", self.base_url)));
            lines.push(Line::from(""));
            lines.push(Line::from(format!(
                "  API Key: {}",
                mask_key(&self.api_key)
            )));
            if let Some(err) = &self.error {
                lines.push(Line::from(format!("  Error: {err}")).red());
            }
            lines.push(Line::from(""));
            lines.push(Line::from(
                "  Type your API key, Enter to save, ESC to cancel",
            ));
        }

        let block = Block::default()
            .title(" API Key ".bold())
            .borders(Borders::ALL);

        Paragraph::new(lines)
            .block(block)
            .wrap(Wrap { trim: false })
            .render(popup_area, buf);
    }
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        return "********".to_string();
    }
    let prefix = &key[..4];
    let suffix = &key[key.len() - 4..];
    format!("{prefix}****{suffix}")
}
