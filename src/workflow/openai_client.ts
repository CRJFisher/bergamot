import OpenAI from 'openai';
import * as vscode from 'vscode';

interface LLMClient {
  complete(prompt: string, system_prompt: string, model?: string): Promise<string>;
  complete_json<T>(prompt: string, system_prompt: string, model?: string): Promise<T>;
}

export class OpenAIClient implements LLMClient {
  private openai: OpenAI;
  
  constructor(api_key: string) {
    this.openai = new OpenAI({ apiKey: api_key });
  }

  async complete(prompt: string, system_prompt: string, model = 'gpt-4o-mini'): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0
    });
    
    return response.choices[0]?.message?.content || '';
  }

  async complete_json<T>(prompt: string, system_prompt: string, model = 'gpt-4o-mini'): Promise<T> {
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    });
    
    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as T;
  }
}

export class VSCodeLLMClient implements LLMClient {
  private model: vscode.LanguageModelChat | null = null;
  
  async initialize(model_id = 'gpt-4o'): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: model_id,
      });
      
      if (!models || models.length === 0) {
        console.log(`No chat models found for family: ${model_id}`);
        return false;
      }
      
      this.model = models[0];
      return true;
    } catch (error) {
      console.log('Failed to initialize VS Code LLM:', error);
      return false;
    }
  }

  async complete(prompt: string, system_prompt: string): Promise<string> {
    if (!this.model) {
      throw new Error('VS Code LLM not initialized');
    }

    const messages = [
      new vscode.LanguageModelChatMessage(
        vscode.LanguageModelChatMessageRole.User,
        `${system_prompt}\n\n${prompt}`
      ),
    ];

    const token_source = new vscode.CancellationTokenSource();
    const response = await this.model.sendRequest(messages, {}, token_source.token);

    let full_response = '';
    for await (const chunk of response.stream) {
      full_response += (chunk as any).value;
    }
    
    return full_response;
  }

  async complete_json<T>(prompt: string, system_prompt: string): Promise<T> {
    const response = await this.complete(
      prompt,
      `${system_prompt}\n\nIMPORTANT: Return only valid JSON, no markdown formatting or additional text.`
    );
    
    // Try to extract JSON from various formats
    let json_content;
    try {
      // First attempt: Try direct parsing
      json_content = JSON.parse(response);
    } catch (e) {
      // Second attempt: Try extracting from markdown code block
      const markdown_json_match = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (markdown_json_match && markdown_json_match[1]) {
        json_content = JSON.parse(markdown_json_match[1]);
      } else {
        // Third attempt: Try extracting any JSON object using regex
        const json_match = response.match(/{[\s\S]*?}/);
        if (json_match) {
          json_content = JSON.parse(json_match[0]);
        } else {
          throw new Error('No valid JSON found in response');
        }
      }
    }
    
    return json_content as T;
  }
}

export async function get_llm_client(open_ai_api_key: string, prefer_vscode = true): Promise<LLMClient> {
  if (prefer_vscode) {
    const vscode_client = new VSCodeLLMClient();
    const initialized = await vscode_client.initialize();
    if (initialized) {
      console.log('Using VS Code LLM');
      return vscode_client;
    }
  }
  
  console.log('Using OpenAI LLM');
  return new OpenAIClient(open_ai_api_key);
}