import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import { ChatPromptValue } from "@langchain/core/prompt_values";
import { ChatOpenAI } from "@langchain/openai";
import * as vscode from "vscode";

export async function get_vscode_or_open_ai_model(
  open_ai_api_key: string,
  model_id = "gpt-4.1-mini"
): Promise<Runnable> {
  try {
    const vscode_model = await create_vscode_llm_runnable({ model_id });
    if (vscode_model) {
      console.log("Using VS Code LLM");
      return vscode_model;
    }
  } catch (error) {
    console.log("VS Code LLM not available, falling back to OpenAI:", error);
  }

  console.log("Using OpenAI LLM");
  return new ChatOpenAI({
    temperature: 0,
    openAIApiKey: open_ai_api_key,
    modelName: model_id,
  });
}

async function create_vscode_llm_runnable({
  model_id = "gpt-4o",
  parse_json = false,
}: { model_id?: string; parse_json?: boolean } = {}): Promise<RunnableLambda<
  ChatPromptValue,
  string | Record<string, any> | null
> | null> {
  try {
    const models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: model_id,
    });
    if (!models || models.length === 0) {
      const available_models = await vscode.lm.selectChatModels();
      console.log(
        `No chat models found for family: ${model_id}. Available models: ${available_models}`
      );
      return null; // Return null to indicate VS Code LLM is not available
    }

    return new RunnableLambda<ChatPromptValue, string>({
      func: async (input: ChatPromptValue) => {
        try {
          const model = models[0];

          const messages = [
            new vscode.LanguageModelChatMessage(
              vscode.LanguageModelChatMessageRole.User,
              input.toString()
            ),
          ];

          // Use a CancellationToken for the request
          const token_source = new vscode.CancellationTokenSource();
          const response = await model.sendRequest(
            messages,
            {},
            token_source.token
          );

          let full_response = "";
          for await (const chunk of response.stream) {
            full_response += (chunk as { value: string }).value;
          }
          if (parse_json) {
            try {
              // Try to extract JSON from various formats
              let json_content;
              // First attempt: Try direct parsing
              try {
                json_content = JSON.parse(full_response);
              } catch (e) {
                // Second attempt: Try extracting from markdown code block
                const markdown_json_match = full_response.match(
                  /```json\s*([\s\S]*?)\s*```/
                );
                if (markdown_json_match && markdown_json_match[1]) {
                  json_content = JSON.parse(markdown_json_match[1]);
                } else {
                  // Third attempt: Try extracting any JSON object using regex
                  const json_match = full_response.match(/{[\s\S]*?}/s);
                  if (json_match) {
                    json_content = JSON.parse(json_match[0]);
                  } else {
                    throw new Error("No valid JSON found in response");
                  }
                }
              }
              full_response = json_content;
            } catch (e) {
              console.error("Error parsing JSON response:", e);
              throw new Error(`Failed to parse JSON response: ${e.message}`);
            }
          }
          return full_response;
        } catch (err: any) {
          if (err instanceof vscode.LanguageModelError) {
            console.log(err.message, err.code, err.cause);
            // if (
            //   err.cause instanceof Error &&
            //   err.cause.message.includes("off_topic")
            // ) {
            //   stream.markdown(
            //     vscode.l10n.t(
            //       "I'm sorry, I can only explain computer science concepts."
            //     )
            //   );
            // }
          } else {
            // add other error handling logic
            throw err;
          }
          console.error("Error using VS Code LLM:", err);
          throw new Error(`VS Code LLM request failed: ${err.message}`);
        }
      },
    });
  } catch (error) {
    console.log("Failed to create VS Code LLM runnable:", error);
    return null; // Return null if VS Code LLM setup fails
  }
}
