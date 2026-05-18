import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const AI_REQUEST_TIMEOUT_MS = 300000;

function createAiService({ logsDir, configStore }) {
  function writeAiLog(config, payload) {
    if (!config.developer_mode) return;
    fs.mkdirSync(logsDir, { recursive: true });
    const fileName = `${payload.request_id}.json`;
    fs.writeFileSync(path.join(logsDir, fileName), JSON.stringify(payload, null, 2), 'utf-8');
  }

  async function chat(config, request) {
    console.error('[AI] chat called, config:', { api_key: !!config.api_key, base_url: config.base_url, model_name: config.model_name });
    
    if (!config.api_key) {
      throw new Error('API 密钥未配置，请先在设置页面填写 API Key');
    }
    
    const baseUrl = (config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const body = {
      model: config.model_name || 'gpt-4o',
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
    };
    if (request.response_format) {
      body.response_format = request.response_format;
    }

    const requestId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
      console.error('[AI] fetching:', `${baseUrl}/chat/completions`);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api_key}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      console.error('[AI] response status:', response.status);
      
      if (!response.ok) {
        const detail = await response.text();
        console.error('[AI] response error:', detail);
        throw new Error(detail || `AI 请求失败，状态码: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      console.error('[AI] chat completed, content length:', content.length);
      return content;
    } catch (error) {
      console.error('[AI] chat error:', error.message, error.stack);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function chatStream(config, request, onEvent) {
    console.error('[AI] chatStream called, config:', { api_key: !!config.api_key, base_url: config.base_url, model_name: config.model_name });
    const baseUrl = (config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const body = {
      model: config.model_name || 'gpt-4o',
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      stream: true,
    };
    if (request.response_format) body.response_format = request.response_format;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[AI] chatStream failed:', detail);
      throw new Error(detail || 'AI 流式请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          console.error('[AI] raw SSE data:', JSON.stringify(data).slice(0, 200));
          if (data === '[DONE]') {
            onEvent({ type: 'done' });
          } else {
            try {
              const parsed = JSON.parse(data);
              // 剥离 <think>...</think> 思考标签
              let content = (parsed.choices?.[0]?.delta?.content || '');
              // 剥离 <think>...</think> 或 ‹think>...‹/think>› 思考标签（‹ = U+2039）
              content = content
                .replace(/\u2039think>[\s\S]*?\u2039\/think>/gi, '')    // ‹think>...‹/think>
                .replace(/<think>[\s\S]*?<\/think>/gi, '');             // <think>...</think>
              console.error('[AI] parsed delta content:', JSON.stringify(content).slice(0, 100), 'choices[0]:', JSON.stringify(parsed.choices?.[0]).slice(0, 100));
              if (content) {
                onEvent({ type: 'content', content });
              }
            } catch (e) {
              console.error('[AI] chatStream parse error:', e.message);
            }
          }
        }
      }
    }
  }

  // ============================================================
  // Image Generation (多服务商)
  // ============================================================

  async function testImageModel(config) {
    // 支持两种格式：config.image_model（旧）/ config.image_model.image_model（新，前端嵌套保存）
    const raw = config.image_model || config;
    const imageConfig = raw.image_model || raw;

    console.error('[DEBUG] testImageModel raw:', JSON.stringify(raw));
    console.error('[DEBUG] testImageModel imageConfig:', JSON.stringify(imageConfig));

    if (!imageConfig.api_key) {
      throw new Error('请先填写 API Key');
    }
    if (!imageConfig.model_name) {
      throw new Error('请先填写模型名称');
    }

    console.error('[DEBUG] testImageModel provider:', imageConfig.provider);

    if (imageConfig.provider === 'volcengine') {
      return testVolcengineImage(imageConfig);
    }
    if (imageConfig.provider === 'google-ai-studio') {
      return testGoogleImage(imageConfig);
    }
    if (imageConfig.provider === 'minimax') {
      console.error('[DEBUG] calling testMinimaxImage');
      return testMinimaxImage(imageConfig);
    }
    throw new Error('当前服务商暂不支持测试');
  }

  async function generateImage(config, request) {
    const raw = config.image_model || config;
    const imageConfig = (raw.image_model || raw) || {};

    if (imageConfig.provider === 'volcengine') {
      return generateVolcengineImage(imageConfig, request);
    }
    if (imageConfig.provider === 'google-ai-studio') {
      return generateGoogleImage(imageConfig, request);
    }
    if (imageConfig.provider === 'minimax') {
      return generateMinimaxImage(imageConfig, request);
    }
    throw new Error('当前服务商暂不支持生图');
  }

  // 火山方舟
  async function testVolcengineImage(imageConfig) {
    const baseUrl = (imageConfig.base_url || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageConfig.api_key}`,
      },
      body: JSON.stringify({
        model: imageConfig.model_name,
        prompt: 'a simple blue dot on a white background',
        size: '1024x1024',
        response_format: 'url',
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`火山方舟生图测试失败: ${detail}`);
    }
    const data = await response.json();
    const imageUrl = data.data?.[0]?.url || '';
    return {
      success: true,
      message: imageUrl ? `测试成功：已生成图片 ${imageUrl}` : '测试成功：已返回生图结果',
      image_url: imageUrl,
    };
  }

  async function generateVolcengineImage(imageConfig, request) {
    const baseUrl = (imageConfig.base_url || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageConfig.api_key}`,
      },
      body: JSON.stringify({
        model: imageConfig.model_name,
        prompt: request.prompt,
        size: request.size || '1024x1024',
        response_format: 'url',
      }),
    });
    if (!response.ok) throw new Error('火山方舟生图失败');
    const data = await response.json();
    const imageUrl = data.data?.[0]?.url || '';
    return { success: true, image_url: imageUrl };
  }

  // Google AI Studio
  async function testGoogleImage(imageConfig) {
    const baseUrl = (imageConfig.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(imageConfig.model_name)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': imageConfig.api_key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'a simple blue dot on a white background' }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    if (!response.ok) throw new Error('Google AI Studio 生图测试失败');
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    const inlineData = imagePart?.inlineData;
    if (!inlineData?.data) throw new Error('Google AI Studio 未返回图片数据');
    return {
      success: true,
      message: '测试成功：已返回生图结果',
      image_url: `data:${inlineData.mimeType || 'image/png'};base64,${inlineData.data}`,
      image_data: inlineData.data,
      mime_type: inlineData.mimeType,
    };
  }

  async function generateGoogleImage(imageConfig, request) {
    const baseUrl = (imageConfig.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(imageConfig.model_name)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': imageConfig.api_key,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    if (!response.ok) throw new Error('Google AI Studio 生图失败');
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    const inlineData = imagePart?.inlineData;
    if (!inlineData?.data) throw new Error('Google AI Studio 未返回图片数据');
    return {
      success: true,
      image_url: `data:${inlineData.mimeType || 'image/png'};base64,${inlineData.data}`,
      image_data: inlineData.data,
      mime_type: inlineData.mimeType,
    };
  }

  // MiniMax
  async function testMinimaxImage(imageConfig) {
    const baseUrl = (imageConfig.base_url || 'https://api.minimaxi.com').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/v1/image_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageConfig.api_key}`,
      },
      body: JSON.stringify({
        model: imageConfig.model_name || 'image-01',
        prompt: 'a simple blue dot on a white background',
        aspect_ratio: '1:1',
        response_format: 'base64',
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MiniMax 生图测试失败: ${detail}`);
    }
    const data = await response.json();
    const imageBase64 = data.data?.[0]?.image_base64 || '';
    return {
      success: true,
      message: imageBase64 ? '测试成功：已返回生图结果' : '测试成功',
      image_url: imageBase64 ? `data:image/png;base64,${imageBase64}` : '',
      image_data: imageBase64,
      mime_type: 'image/png',
    };
  }

  async function generateMinimaxImage(imageConfig, request) {
    const baseUrl = (imageConfig.base_url || 'https://api.minimaxi.com').replace(/\/$/, '');
    const body = {
      model: imageConfig.model_name || 'image-01',
      prompt: request.prompt,
      aspect_ratio: request.aspect_ratio || '1:1',
      response_format: request.response_format || 'url',
    };
    if (request.n) body.n = request.n;
    if (request.prompt_optimizer) body.prompt_optimizer = request.prompt_optimizer;
    if (request.subject_reference?.length) {
      body.subject_reference = request.subject_reference;
    }
    const response = await fetch(`${baseUrl}/v1/image_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageConfig.api_key}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('MiniMax 生图失败');
    const data = await response.json();
    // 支持 url 或 base64 格式
    const images = data.data || [];
    const results = images.map((img) => {
      if (img.image_url) return { image_url: img.image_url };
      if (img.image_base64) return { image_url: `data:image/png;base64,${img.image_base64}`, image_data: img.image_base64 };
      return {};
    });
    return { success: true, images: results };
  }

  // ============================================================
  // List Models
  // ============================================================

  async function listModels(config) {
    if (!config.api_key) {
      return { success: false, message: '请先填写文本模型 API Key', models: [] };
    }
    const baseUrl = (config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api_key}`,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      return { success: false, message: `获取模型列表失败: ${detail}`, models: [] };
    }
    const data = await response.json();
    return {
      success: true,
      message: '模型列表已更新',
      models: Array.isArray(data.data) ? data.data.map((item) => item.id).filter(Boolean) : [],
    };
  }

  async function streamChat(request, onEvent) {
    const config = configStore?.load?.() || {};
    console.error('[AI] streamChat called (wrapper), config:', { api_key: !!config.api_key, base_url: config.base_url, model_name: config.model_name });
    return chatStream(config, request, onEvent);
  }

  return { chat, chatStream, streamChat, testImageModel, generateImage, listModels };
}

export { createAiService };
