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
use futures::StreamExt;
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
        mut body: Value,
        extra_headers: HeaderMap,
        compression: Compression,
        turn_state: Option<Arc<OnceLock<String>>>,
    ) -> Result<ResponseStream, ApiError> {
        // Use streaming
        body["stream"] = Value::Bool(true);

        let request_compression = match compression {
            Compression::None => RequestCompression::None,
            Compression::Zstd => RequestCompression::Zstd,
        };

        let stream_response = self
            .session
            .stream_encoded_json_with(
                Method::POST,
                Self::path(),
                extra_headers,
                Some(EncodedJsonBody::encode(&body)
                    .map_err(|e| ApiError::Stream(format!("encode error: {e}")))?),
                |req| {
                    req.headers.insert(
                        http::header::ACCEPT,
                        HeaderValue::from_static("text/event-stream"),
                    );
                    req.compression = request_compression;
                },
            )
            .await?;

        let (tx_event, rx_event) = mpsc::channel::<Result<ResponseEvent, ApiError>>(64);
        let mut byte_stream = stream_response.bytes;

        tokio::spawn(async move {
            let mut buf = String::new();
            let mut content_accum = String::new();
            let mut sent_item = false;

            while let Some(Ok(bytes)) = byte_stream.next().await {
                buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(nl) = buf.find('\n') {
                    let line = buf[..nl].trim().to_string();
                    buf = buf[nl + 1..].to_string();
                    if !line.starts_with("data: ") { continue; }
                    let data = &line[6..];
                    if data == "[DONE]" {
                        let item_id = format!("chat_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
                        if sent_item {
                            let done_item = codex_protocol::models::ResponseItem::Message {
                                id: Some(item_id.clone()),
                                role: "assistant".to_string(),
                                content: vec![codex_protocol::models::ContentItem::OutputText { text: content_accum.clone() }],
                                phase: None,
                                internal_chat_message_metadata_passthrough: None,
                            };
                            let _ = tx_event.send(Ok(ResponseEvent::OutputItemDone(done_item))).await;
                        }
                        let _ = tx_event.send(Ok(ResponseEvent::Completed {
                            response_id: item_id,
                            token_usage: None,
                            end_turn: None,
                        })).await;
                        return;
                    }
                    if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                        // Text content delta - always send OutputItemAdded if first text chunk
                        if let Some(delta) = parsed["choices"][0]["delta"]["content"].as_str() {
                            if !delta.is_empty() {
                                if !sent_item || content_accum.is_empty() {
                                    let item = codex_protocol::models::ResponseItem::Message {
                                        id: None,
                                        role: "assistant".to_string(),
                                        content: vec![codex_protocol::models::ContentItem::OutputText { text: String::new() }],
                                        phase: None,
                                        internal_chat_message_metadata_passthrough: None,
                                    };
                                    let _ = tx_event.send(Ok(ResponseEvent::OutputItemAdded(item))).await;
                                    sent_item = true;
                                }
                                content_accum.push_str(delta);
                                let _ = tx_event.send(Ok(ResponseEvent::OutputTextDelta(delta.to_string()))).await;
                            }
                        }
                        // Tool call delta
                        if let Some(tcs) = parsed["choices"][0]["delta"]["tool_calls"].as_array() {
                            for tc in tcs {
                                if tc.get("id").and_then(|v| v.as_str()).is_some() {
                                    // New tool call with ID - send OutputItemAdded
                                    let id = tc["id"].as_str().unwrap_or("");
                                    if let Some(func) = tc["function"].as_object() {
                                        let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                        let args = func.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
                                        let fn_call = codex_protocol::models::ResponseItem::FunctionCall {
                                            id: None,
                                            call_id: id.to_string(),
                                            name: name.to_string(),
                                            namespace: None,
                                            arguments: args.to_string(),
                                            internal_chat_message_metadata_passthrough: None,
                                        };
                                        let _ = tx_event.send(Ok(ResponseEvent::OutputItemAdded(fn_call.clone()))).await;
                                        let _ = tx_event.send(Ok(ResponseEvent::OutputItemDone(fn_call))).await;
                                        sent_item = true;
                                    }
                                } else if let Some(func) = tc["function"].as_object() {
                                    if let Some(args) = func.get("arguments").and_then(|v| v.as_str()) {
                                        if !args.is_empty() {
                                            // Send partial args as text delta so the UI shows progress
                                            // Actually skip this for now - tool calls are handled differently
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        Ok(ResponseStream { rx_event, upstream_request_id: None })
    }
}
