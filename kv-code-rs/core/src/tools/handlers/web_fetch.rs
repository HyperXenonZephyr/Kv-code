use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use codex_protocol::models::ResponseInputItem;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiNamespace;
use codex_tools::ResponsesApiNamespaceTool;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde_json::Value as JsonValue;
use serde_json::json;
use std::collections::BTreeMap;

const NAMESPACE: &str = "dev_utils";
const TOOL_NAME: &str = "web_fetch";

struct WebFetchOutput(String);

impl ToolOutput for WebFetchOutput {
    fn log_preview(&self) -> String {
        if self.0.len() > 200 {
            format!("{}... (truncated)", &self.0[..200])
        } else {
            self.0.clone()
        }
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        FunctionToolOutput::from_text(self.0.clone(), Some(true)).to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        json!({"content": self.0})
    }
}

#[derive(Deserialize)]
struct WebFetchParams {
    url: String,
}

pub struct WebFetchHandler;

impl ToolExecutor<ToolInvocation> for WebFetchHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(NAMESPACE, TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        properties.insert(
            "url".to_string(),
            JsonSchema::string(Some("The URL to fetch content from.".to_string())),
        );
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: NAMESPACE.to_string(),
            description: "Utility tools for development.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: TOOL_NAME.to_string(),
                description: "Fetch content from a URL and return the response body as text. Useful for retrieving web pages, API responses, or raw text content.".to_string(),
                strict: false,
                defer_loading: None,
                parameters: JsonSchema::object(
                    properties,
                    /*required*/ Some(vec!["url".to_string()]),
                    /*additional_properties*/ Some(false.into()),
                ),
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "The response body content as text."
                        }
                    },
                    "required": ["content"],
                    "additionalProperties": false
                })),
            })],
        })
    }

    fn handle(&self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'_> {
        Box::pin(async move {
            let payload = match &invocation.payload {
                ToolPayload::Function { arguments, .. } => arguments,
                _ => {
                    return Err(FunctionCallError::RespondToModel(format!(
                        "{TOOL_NAME} handler received unsupported payload"
                    )));
                }
            };

            let params: WebFetchParams = serde_json::from_str(payload).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse {TOOL_NAME} arguments: {err}"
                ))
            })?;

            let response = reqwest::get(&params.url).await.map_err(|err| {
                FunctionCallError::RespondToModel(format!("failed to fetch URL: {err}"))
            })?;

            let status = response.status();
            if !status.is_success() {
                return Err(FunctionCallError::RespondToModel(format!(
                    "URL returned HTTP {status}"
                )));
            }

            let body = response.text().await.map_err(|err| {
                FunctionCallError::RespondToModel(format!("failed to read response body: {err}"))
            })?;

            Ok(boxed_tool_output(WebFetchOutput(body)))
        })
    }
}

impl CoreToolRuntime for WebFetchHandler {}
