use crate::auth::SharedAuthProvider;
use crate::common::ResponseEvent;
use crate::common::ResponseStream;
use crate::endpoint::session::EndpointSession;
use crate::error::ApiError;
use crate::provider::Provider;
use crate::requests::Compression;
use crate::telemetry::SseTelemetry;
use codex_client::EncodedJsonBody;
use codex_client::HttpTransport;
use codex_client::RequestCompression;
use codex_client::RequestTelemetry;
use http::HeaderMap;
use http::HeaderValue;
use http::Method;
use serde_json::Value;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::mpsc;
use tracing::instrument;

pub struct ChatCompletionsClient<T: HttpTransport> {
    session: EndpointSession<T>,
    sse_telemetry: Option<Arc<dyn SseTelemetry>>,
}

#[derive(Default)]
pub struct ChatCompletionsOptions {
    pub session_id: Option<String>,
    pub thread_id: Option<String>,
    pub extra_headers: HeaderMap,
    pub compression: Compression,
    pub turn_state: Option<Arc<OnceLock<String>>>,
}

impl<T: HttpTransport> ChatCompletionsClient<T> {
    pub fn new(transport: T, provider: Provider, auth: SharedAuthProvider) -> Self {
        Self {
            session: EndpointSession::new(transport, provider, auth),
            sse_telemetry: None,
        }
    }

    pub fn with_telemetry(
        self,
        request: Option<Arc<dyn RequestTelemetry>>,
        sse: Option<Arc<dyn SseTelemetry>>,
    ) -> Self {
        Self {
            session: self.session.with_request_telemetry(request),
            sse_telemetry: sse,
        }
    }

    fn path() -> &'static str {
        "v1/chat/completions"
    }

    pub async fn stream(
        &self,
        body: Value,
        extra_headers: HeaderMap,
        compression: Compression,
        turn_state: Option<Arc<OnceLock<String>>>,
    ) -> Result<ResponseStream, ApiError> {
        // Use non-streaming request to avoid SSE format complexity
        let mut body = body;
        body["stream"] = Value::Bool(false);

        let request_compression = match compression {
            Compression::None => RequestCompression::None,
            Compression::Zstd => RequestCompression::Zstd,
        };

        let response = self
            .session
            .stream_encoded_json_with(
                Method::POST,
                Self::path(),
                extra_headers,
                Some(EncodedJsonBody::encode(&body)
                    .map_err(|e| ApiError::Stream(format!("failed to encode chat request: {e}")))?),
                |req| {
                    req.headers.insert(
                        http::header::ACCEPT,
                        HeaderValue::from_static("application/json"),
                    );
                    req.compression = request_compression;
                },
            )
            .await?;

        let (tx_event, rx_event) = mpsc::channel::<Result<ResponseEvent, ApiError>>(16);
        let mut byte_stream = response.bytes;

        tokio::spawn(async move {
            let mut full_response = Vec::new();
            use futures::StreamExt;
            while let Some(Ok(bytes)) = byte_stream.next().await {
                full_response.extend_from_slice(&bytes);
            }

            if let Ok(response_text) = String::from_utf8(full_response) {
                if let Ok(parsed) = serde_json::from_str::<Value>(&response_text) {
                    if let Some(content) = parsed["choices"][0]["message"]["content"].as_str() {
                        let item = codex_protocol::models::ResponseItem::Message {
                            id: None,
                            role: "assistant".to_string(),
                            content: vec![codex_protocol::models::ContentItem::OutputText {
                                text: String::new(),
                            }],
                            phase: None,
                            internal_chat_message_metadata_passthrough: None,
                        };
                        let item_id = format!("chat_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
                        let mut item = item;
                        if let codex_protocol::models::ResponseItem::Message { ref mut id, .. } = item {
                            *id = Some(item_id.clone());
                        }
                        let _ = tx_event.send(Ok(ResponseEvent::OutputItemAdded(item.clone()))).await;
                        for chunk in content.chars().collect::<Vec<_>>().chunks(1024) {
                            let text: String = chunk.iter().collect();
                            let _ = tx_event.send(Ok(ResponseEvent::OutputTextDelta(text))).await;
                        }
                        let _ = tx_event.send(Ok(ResponseEvent::OutputItemDone(item))).await;
                        let _ = tx_event.send(Ok(ResponseEvent::Completed {
                            response_id: item_id,
                            token_usage: None,
                            end_turn: None,
                        })).await;
                    }
                }
            }
        });

        Ok(ResponseStream {
            rx_event,
            upstream_request_id: None,
        })
    }
}
