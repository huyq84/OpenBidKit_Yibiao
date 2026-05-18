import type { AiStreamEvent, ChatCompletionRequest, JsonCompletionRequest } from '../types';
import { sogplan } from '../api/apiClient';

export const aiClient = {
  chat(request: ChatCompletionRequest): Promise<string> {
    return sogplan.ai.chat(request);
  },

  requestJson<TResult = unknown>(request: JsonCompletionRequest): Promise<TResult> {
    return sogplan.ai.requestJson<TResult>(request);
  },

  streamChat(request: ChatCompletionRequest, onEvent: (event: AiStreamEvent) => void): () => void {
    // sogplan.ai.streamChat 返回 void，这里包装为取消函数
    sogplan.ai.streamChat(request, onEvent);
    return () => {}; // Web 版 SSE 不需要取消
  },
};