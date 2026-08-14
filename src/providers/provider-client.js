(function attachProviderClient(root) {
  "use strict";

  const GEMINI_HOST = "generativelanguage.googleapis.com";
  const OPENAI_HOST = "api.openai.com";
  const GPT_GATEWAY_HOST = "gpt.yapweijun1996.com";
  const GPT_GATEWAY_PROVIDER = "xorgateway";
  const GPT_GATEWAY_XOR_KEY = "20260515";
  const GPT_GATEWAY_KEY_CIPHER = "VUdtAwIBV1QDAlQPAVYGAVEAU1cCBFUCAVZQV1ECUwwFUQABUQJVVwFSB1cGVwIGBQAK";

  let resolvedGatewayKey = null;

  function xorCipher(base64Text, key) {
    try {
      const raw = atob(String(base64Text || ""));
      const password = String(key || "");
      if (!raw || !password) return "";
      let result = "";
      for (let i = 0; i < raw.length; i++) {
        result += String.fromCharCode(raw.charCodeAt(i) ^ password.charCodeAt(i % password.length));
      }
      return result;
    } catch {
      return "";
    }
  }

  function gatewayApiKey(inputApiKey) {
    if (String(inputApiKey || "").trim()) return inputApiKey.trim();
    if (resolvedGatewayKey === null) resolvedGatewayKey = xorCipher(GPT_GATEWAY_KEY_CIPHER, GPT_GATEWAY_XOR_KEY).trim();
    return resolvedGatewayKey;
  }

  function requireGatewayApiKey(apiKey) {
    if (!apiKey) {
      const error = new Error("Gateway API key not configured");
      error.idpCode = "provider_error";
      throw error;
    }
  }

  function imagePayload(image) {
    const dataUrl = String(image?.dataUrl || "");
    const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error("Visual evidence was not a valid base64 data URL");
    return { mimeType: image?.mimeType || match[1] || "image/png", data: match[2], dataUrl };
  }

  function safeProviderError(provider, status, payload) {
    const code = String(payload?.error?.status || payload?.error?.code || payload?.status || "provider_error")
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .slice(0, 80);
    const error = new Error(`${provider} request failed (${Number(status) || 0}; ${code})`);
    error.idpCode = "provider_error";
    error.status = Number(status) || 0;
    return error;
  }

  async function parseResponse(response, provider) {
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !payload) throw safeProviderError(provider, response.status, payload);
    return payload;
  }

  async function withTimeout(timeoutMs, callback) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 120000));
    try { return await callback(controller.signal); }
    catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("Provider request timed out");
        timeoutError.idpCode = "provider_error";
        throw timeoutError;
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function geminiUsage(payload) {
    const usage = payload?.usageMetadata || {};
    return {
      inputTokens: Number.isFinite(Number(usage.promptTokenCount)) ? Number(usage.promptTokenCount) : null,
      outputTokens: Number.isFinite(Number(usage.candidatesTokenCount)) ? Number(usage.candidatesTokenCount) : null,
      totalTokens: Number.isFinite(Number(usage.totalTokenCount)) ? Number(usage.totalTokenCount) : null
    };
  }

  async function requestGemini(request, fetchImpl) {
    const started = Date.now();
    const url = `https://${GEMINI_HOST}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
    const parts = [{ text: request.prompt }, ...(request.images || []).map((image) => {
      const payload = imagePayload(image);
      return { inlineData: { mimeType: payload.mimeType, data: payload.data } };
    })];
    const generationConfig = {};
    if (Number.isFinite(Number(request.temperature))) generationConfig.temperature = Number(request.temperature);
    if (request.schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = request.schema;
    }
    if (request.reasoning) generationConfig.thinkingConfig = { thinkingLevel: request.reasoning };
    const body = { contents: [{ role: "user", parts }], generationConfig };
    const payload = await withTimeout(request.timeoutMs, async (signal) => parseResponse(await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": request.apiKey },
      body: JSON.stringify(body),
      signal
    }), "Gemini"));
    const text = (payload.candidates || [])
      .flatMap((candidate) => candidate?.content?.parts || [])
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!text) throw safeProviderError("Gemini", 200, { status: payload.promptFeedback?.blockReason || "empty_response" });
    return { text, usage: geminiUsage(payload), durationMs: Date.now() - started, finishReason: payload.candidates?.[0]?.finishReason || null };
  }

  function openAIUsage(payload) {
    const usage = payload?.usage || {};
    return {
      inputTokens: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
      totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null
    };
  }

  function openAIText(payload) {
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
    return (payload?.output || [])
      .flatMap((item) => item?.content || [])
      .filter((part) => part?.type === "output_text" || typeof part?.text === "string")
      .map((part) => part.text || "")
      .join("")
      .trim();
  }

  async function requestGatewayOpenAIStyle(request, fetchImpl) {
    const started = Date.now();
    const content = [{ type: "input_text", text: request.prompt }, ...(request.images || []).map((image) => ({
      type: "input_image",
      image_url: imagePayload(image).dataUrl,
      detail: "high"
    }))];
    const body = {
      model: request.model,
      input: [{ role: "user", content }],
      ...(request.reasoning ? { reasoning: { effort: request.reasoning } } : {}),
      ...(request.schema ? { text: { format: { type: "json_schema", name: "idp_response", strict: true, schema: request.schema } } } : {})
    };
    const payload = await withTimeout(request.timeoutMs, async (signal) => parseResponse(await fetchImpl(`https://${GPT_GATEWAY_HOST}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify(body),
      signal
    }), "XOR Gateway"));
    const text = openAIText(payload);
    if (!text) throw safeProviderError("XOR Gateway", 200, { status: payload?.status || "empty_response" });
    return { text, usage: openAIUsage(payload), durationMs: Date.now() - started, finishReason: payload.status || null };
  }

  async function requestOpenAI(request, fetchImpl) {
    const started = Date.now();
    const content = [{ type: "input_text", text: request.prompt }, ...(request.images || []).map((image) => ({
      type: "input_image",
      image_url: imagePayload(image).dataUrl,
      detail: "high"
    }))];
    const body = {
      model: request.model,
      input: [{ role: "user", content }],
      ...(request.reasoning ? { reasoning: { effort: request.reasoning } } : {}),
      ...(request.schema ? { text: { format: { type: "json_schema", name: "idp_response", strict: true, schema: request.schema } } } : {})
    };
    const payload = await withTimeout(request.timeoutMs, async (signal) => parseResponse(await fetchImpl(`https://${OPENAI_HOST}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify(body),
      signal
    }), "OpenAI"));
    const text = openAIText(payload);
    if (!text) throw safeProviderError("OpenAI", 200, { status: payload?.status || "empty_response" });
    return { text, usage: openAIUsage(payload), durationMs: Date.now() - started, finishReason: payload.status || null };
  }

  async function request(input, fetchImpl) {
    const config = input?.config || {};
    const normalized = {
      apiKey: config.provider === GPT_GATEWAY_PROVIDER ? gatewayApiKey(input?.apiKey) : input.apiKey,
      model: config.model,
      prompt: String(input.prompt || ""),
      images: input.images || [],
      schema: input.schema || null,
      reasoning: input.reasoningOverride || config.reasoning || null,
      temperature: config.provider === "gemini" ? 0 : undefined,
      timeoutMs: input.timeoutMs || 120000
    };
    if (config.provider === GPT_GATEWAY_PROVIDER) requireGatewayApiKey(normalized.apiKey);
    if (config.provider === "gemini") return requestGemini(normalized, fetchImpl);
    if (config.provider === "openai") return requestOpenAI(normalized, fetchImpl);
    if (config.provider === GPT_GATEWAY_PROVIDER) return requestGatewayOpenAIStyle(normalized, fetchImpl);
    throw new Error("Unsupported provider");
  }

  root.IdpProviderClient = Object.freeze({ imagePayload, request, requestGemini, requestOpenAI, requestGatewayOpenAIStyle, gatewayApiKey });
})(typeof self !== "undefined" ? self : globalThis);
