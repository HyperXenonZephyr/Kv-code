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
const TOOL_NAME: &str = "calculator";

struct CalculatorOutput {
    expression: String,
    result: f64,
}

impl ToolOutput for CalculatorOutput {
    fn log_preview(&self) -> String {
        format!("{} = {}", self.expression, self.result)
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        FunctionToolOutput::from_text(self.log_preview(), Some(true))
            .to_response_item(call_id, payload)
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        json!({
            "expression": self.expression,
            "result": self.result,
        })
    }
}

#[derive(Deserialize)]
struct CalculatorParams {
    expression: String,
}

pub struct CalculatorHandler;

impl ToolExecutor<ToolInvocation> for CalculatorHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::namespaced(NAMESPACE, TOOL_NAME)
    }

    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        properties.insert(
            "expression".to_string(),
            JsonSchema::string(Some(
                "A mathematical expression to evaluate. Supports: +, -, *, /, ^ (power), sqrt(), sin(), cos(). Example: \"sqrt(25) + 3 * 2 ^ 3\"".to_string(),
            )),
        );
        ToolSpec::Namespace(ResponsesApiNamespace {
            name: NAMESPACE.to_string(),
            description: "Utility tools for development.".to_string(),
            tools: vec![ResponsesApiNamespaceTool::Function(ResponsesApiTool {
                name: TOOL_NAME.to_string(),
                description: "Evaluate a mathematical expression and return the result. Supports operators: +, -, *, /, ^, and functions: sqrt, sin, cos.".to_string(),
                strict: false,
                defer_loading: None,
                parameters: JsonSchema::object(
                    properties,
                    /*required*/ Some(vec!["expression".to_string()]),
                    /*additional_properties*/ Some(false.into()),
                ),
                output_schema: Some(json!({
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "The original expression."
                        },
                        "result": {
                            "type": "number",
                            "description": "The computed result."
                        }
                    },
                    "required": ["expression", "result"],
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

            let params: CalculatorParams = serde_json::from_str(payload).map_err(|err| {
                FunctionCallError::RespondToModel(format!(
                    "failed to parse {TOOL_NAME} arguments: {err}"
                ))
            })?;

            let result = eval_expression(&params.expression)?;

            Ok(boxed_tool_output(CalculatorOutput {
                expression: params.expression,
                result,
            }))
        })
    }
}

impl CoreToolRuntime for CalculatorHandler {}

// --- Simple recursive descent expression evaluator ---

type CalcResult = Result<f64, FunctionCallError>;

struct ExprParser {
    chars: Vec<char>,
    pos: usize,
}

impl ExprParser {
    fn new(input: &str) -> Self {
        Self {
            chars: input.chars().collect(),
            pos: 0,
        }
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.chars.len() && self.chars[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn peek(&mut self) -> Option<char> {
        self.skip_whitespace();
        self.chars.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<char> {
        self.skip_whitespace();
        let ch = self.chars.get(self.pos).copied();
        if ch.is_some() {
            self.pos += 1;
        }
        ch
    }

    fn expect(&mut self, expected: char) -> CalcResult {
        let ch = self.next();
        if ch == Some(expected) {
            // Return a dummy value so the type is f64, not ()
            Ok(0.0)
        } else {
            Err(FunctionCallError::RespondToModel(format!(
                "calculator: expected '{expected}' at position {}",
                self.pos
            )))
        }
    }

    /// Parse expression: sum/difference of terms
    fn parse_expr(&mut self) -> CalcResult {
        let mut left = self.parse_term()?;
        loop {
            match self.peek() {
                Some('+') => {
                    self.next();
                    left += self.parse_term()?;
                }
                Some('-') => {
                    self.next();
                    left -= self.parse_term()?;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    /// Parse term: product/quotient of factors
    fn parse_term(&mut self) -> CalcResult {
        let mut left = self.parse_power()?;
        loop {
            match self.peek() {
                Some('*') => {
                    self.next();
                    left *= self.parse_power()?;
                }
                Some('/') => {
                    self.next();
                    let right = self.parse_power()?;
                    if right == 0.0 {
                        return Err(FunctionCallError::RespondToModel(
                            "calculator: division by zero".to_string(),
                        ));
                    }
                    left /= right;
                }
                _ => break,
            }
        }
        Ok(left)
    }

    /// Parse power (right-associative)
    fn parse_power(&mut self) -> CalcResult {
        let base = self.parse_unary()?;
        if self.peek() == Some('^') {
            self.next();
            let exp = self.parse_power()?;
            Ok(base.powf(exp))
        } else {
            Ok(base)
        }
    }

    /// Parse unary operators: +, -
    fn parse_unary(&mut self) -> CalcResult {
        match self.peek() {
            Some('+') => {
                self.next();
                self.parse_unary()
            }
            Some('-') => {
                self.next();
                Ok(-self.parse_unary()?)
            }
            _ => self.parse_atom(),
        }
    }

    /// Parse atoms: number, function call, parenthesized expression
    fn parse_atom(&mut self) -> CalcResult {
        self.skip_whitespace();

        // Function calls
        if let Some(ch) = self.peek() {
            if ch.is_alphabetic() {
                return self.parse_function();
            }
        }

        // Parenthesized expression
        if self.peek() == Some('(') {
            self.next();
            let val = self.parse_expr()?;
            self.expect(')')?;
            return Ok(val);
        }

        // Number
        self.parse_number()
    }

    fn parse_number(&mut self) -> CalcResult {
        self.skip_whitespace();
        let start = self.pos;
        let mut has_dot = false;

        while self.pos < self.chars.len() {
            let ch = self.chars[self.pos];
            if ch.is_ascii_digit() {
                self.pos += 1;
            } else if ch == '.' && !has_dot {
                has_dot = true;
                self.pos += 1;
            } else {
                break;
            }
        }

        if self.pos == start {
            return Err(FunctionCallError::RespondToModel(format!(
                "calculator: expected a number at position {}",
                self.pos
            )));
        }

        let s: String = self.chars[start..self.pos].iter().collect();
        s.parse::<f64>().map_err(|_| {
            FunctionCallError::RespondToModel(format!("calculator: invalid number '{s}'"))
        })
    }

    fn parse_function(&mut self) -> CalcResult {
        let start = self.pos;
        while self.pos < self.chars.len() && self.chars[self.pos].is_alphabetic() {
            self.pos += 1;
        }
        let name: String = self.chars[start..self.pos].iter().collect();

        self.expect('(')?;
        let arg = self.parse_expr()?;
        self.expect(')')?;

        match name.as_str() {
            "sqrt" => Ok(arg.sqrt()),
            "sin" => Ok(arg.sin()),
            "cos" => Ok(arg.cos()),
            _ => Err(FunctionCallError::RespondToModel(format!(
                "calculator: unknown function '{name}'"
            ))),
        }
    }
}

fn eval_expression(expression: &str) -> CalcResult {
    let mut parser = ExprParser::new(expression);
    let result = parser.parse_expr()?;
    parser.skip_whitespace();
    if parser.pos < parser.chars.len() {
        return Err(FunctionCallError::RespondToModel(format!(
            "calculator: unexpected character '{}' at position {}",
            parser.chars[parser.pos], parser.pos
        )));
    }
    Ok(result)
}
