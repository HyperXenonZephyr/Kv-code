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
const TOOL_NAME: &str = "json_query";

struct JsonQueryOutput(JsonValue);

impl ToolOutput for JsonQueryOutput {
    fn log_preview(&self) -> String {
        self.0.to_string()
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        FunctionToolOutput::from_text(self.0.to_string(), Some(true))
            .to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        json!({"result": self.0})
    }
}

#[derive(Deserialize)]
struct JsonQueryParams {
    json: String,
    #[serde(default)]
    path: Option<String>,
}

pub struct JsonQueryHandler;

impl ToolExecutor<ToolInvocation> for JsonQueryHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(NAMESPACE, TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        properties.insert(
            "json".to_string(),
            JsonSchema::string(Some("The JSON string to query.".to_string())),
        );
        properties.insert(
            "path".to_string(),
            JsonSchema::string(Some(
                "Optional slash-separated path into the JSON value, e.g. \"foo/bar/0/name\". Uses serde_json pointer syntax. If omitted, returns the pretty-printed JSON.".to_string(),
            )),
        );
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: NAMESPACE.to_string(),
            description: "Utility tools for development.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: TOOL_NAME.to_string(),
                description: "Query a JSON string using a slash-separated path and return the extracted value. Useful for inspecting nested JSON data.".to_string(),
                strict: false,
                defer_loading: None,
                parameters: JsonSchema::object(
                    properties,
                    /*required*/ Some(vec!["json".to_string()]),
                    /*additional_properties*/ Some(false.into()),
                ),
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "result": {
                            "description": "The extracted or pretty-printed JSON value."
                        }
                    },
                    "required": ["result"],
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

            let params: JsonQueryParams = serde_json::from_str(payload).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse {TOOL_NAME} arguments: {err}"
                ))
            })?;

            let value: JsonValue = serde_json::from_str(&params.json).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse input JSON: {err}"
                ))
            })?;

            let result = match &params.path {
                Some(path) if !path.is_empty() => {
                    let pointer = if path.starts_with('/') {
                        path.clone()
                    } else {
                        format!("/{path}")
                    };
                    value
                        .pointer(&pointer)
                        .cloned()
                        .ok_or_else(|| {
                            FunctionCallError::RespondToModel(format!(
                                "path '{path}' not found in JSON"
                            ))
                        })?
                }
                _ => value,
            };

            Ok(boxed_tool_output(JsonQueryOutput(result)))
        })
    }
}

impl CoreToolRuntime for JsonQueryHandler {}
