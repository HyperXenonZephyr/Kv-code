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
use uuid::Uuid;

const NAMESPACE: &str = "dev_utils";
const TOOL_NAME: &str = "uuid_gen";

struct UuidGenOutput(String);

impl ToolOutput for UuidGenOutput {
    fn log_preview(&self) -> String {
        self.0.clone()
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        FunctionToolOutput::from_text(self.0.clone(), Some(true)).to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        json!({"uuid": self.0})
    }
}

#[derive(Deserialize)]
struct UuidGenParams {
    #[serde(default = "default_version")]
    version: String,
}

fn default_version() -> String {
    "v4".to_string()
}

pub struct UuidGenHandler;

impl ToolExecutor<ToolInvocation> for UuidGenHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(NAMESPACE, TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        properties.insert(
            "version".to_string(),
            JsonSchema::string_enum(
                vec![json!("v4"), json!("v7")],
                Some(
                    "UUID version to generate. \"v4\" (random), \"v7\" (time-ordered). Default: \"v4\"."
                        .to_string(),
                ),
            ),
        );
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: NAMESPACE.to_string(),
            description: "Utility tools for development.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: TOOL_NAME.to_string(),
                description: "Generate a UUID string. Supports v4 (random) and v7 (time-ordered). Use when you need a unique identifier.".to_string(),
                strict: false,
                defer_loading: None,
                parameters: JsonSchema::object(
                    properties,
                    /*required*/ None,
                    /*additional_properties*/ Some(false.into()),
                ),
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "uuid": {
                            "type": "string",
                            "description": "A generated UUID string."
                        }
                    },
                    "required": ["uuid"],
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

            let params: UuidGenParams = serde_json::from_str(payload).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse {TOOL_NAME} arguments: {err}"
                ))
            })?;

            let uuid = match params.version.as_str() {
                "v4" => Uuid::new_v4().to_string(),
                "v7" => Uuid::now_v7().to_string(),
                other => {
                    return Err(FunctionCallError::RespondToModel(format!(
                        "unsupported UUID version '{other}'; supported versions are 'v4' and 'v7'"
                    )));
                }
            };

            Ok(boxed_tool_output(UuidGenOutput(uuid)))
        })
    }
}

impl CoreToolRuntime for UuidGenHandler {}
