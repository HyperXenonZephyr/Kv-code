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
use sha2::Digest;
use std::collections::BTreeMap;
use std::fmt::Write as FmtWrite;

const NAMESPACE: &str = "dev_utils";
const TOOL_NAME: &str = "hash";

struct HashOutput(String);

impl ToolOutput for HashOutput {
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
        json!({"hash": self.0})
    }
}

#[derive(Deserialize)]
struct HashParams {
    algorithm: String,
    input: String,
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(hex, "{byte:02x}").unwrap();
    }
    hex
}

pub struct HashHandler;

impl ToolExecutor<ToolInvocation> for HashHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(NAMESPACE, TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        properties.insert(
            "algorithm".to_string(),
            JsonSchema::string_enum(
                vec![json!("sha256"), json!("sha512")],
                Some("Hash algorithm to use.".to_string()),
            ),
        );
        properties.insert(
            "input".to_string(),
            JsonSchema::string(Some("The input string to hash.".to_string())),
        );
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: NAMESPACE.to_string(),
            description: "Utility tools for development.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: TOOL_NAME.to_string(),
                description: "Compute a cryptographic hash of the input string using the specified algorithm. Returns the hex-encoded hash.".to_string(),
                strict: false,
                defer_loading: None,
                parameters: JsonSchema::object(
                    properties,
                    /*required*/ Some(vec!["algorithm".to_string(), "input".to_string()]),
                    /*additional_properties*/ Some(false.into()),
                ),
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "hash": {
                            "type": "string",
                            "description": "The hex-encoded hash string."
                        }
                    },
                    "required": ["hash"],
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

            let params: HashParams = serde_json::from_str(payload).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse {TOOL_NAME} arguments: {err}"
                ))
            })?;

            let hash = match params.algorithm.as_str() {
                "sha256" => {
                    let mut hasher = sha2::Sha256::new();
                    hasher.update(params.input.as_bytes());
                    hex_encode(&hasher.finalize())
                }
                "sha512" => {
                    let mut hasher = sha2::Sha512::new();
                    hasher.update(params.input.as_bytes());
                    hex_encode(&hasher.finalize())
                }
                other => {
                    return Err(FunctionCallError::RespondToModel(format!(
                        "unsupported algorithm '{other}'; supported algorithms are 'sha256' and 'sha512'"
                    )));
                }
            };

            Ok(boxed_tool_output(HashOutput(hash)))
        })
    }
}

impl CoreToolRuntime for HashHandler {}
