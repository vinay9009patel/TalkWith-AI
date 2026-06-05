// Cloudflare Worker — AI Talk Platform
// Routes: Groq (/openai/*), OpenRouter (/openrouter/*), Gemini (/gemini-text), Daily Limits (/limit/*), Device Signup (/device-signup/*)

// === CONFIGURATION ===
// API keys are now handled via environment variables (env.GROQ_API_KEY, etc.)

const ALLOWED_ORIGINS = ["*"]; // Restrict in production

// Daily usage limits storage (KV namespace in production)
const DAILY_LIMITS = { chat: 20 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes("*") ? "*" : origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // === Health check ===
    if (path === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "ai-talk-proxy" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // === Gemini ===
      if (path === "/gemini-text") {
        return await handleGemini(request, env, corsHeaders);
      }

      // === Groq (OpenAI-compatible) ===
      if (path.startsWith("/openai/")) {
        return await handleGroq(request, env, path, corsHeaders);
      }

      // === OpenRouter ===
      if (path.startsWith("/openrouter/")) {
        return await handleOpenRouter(request, env, path, corsHeaders);
      }

      // === Daily Usage Limits ===
      if (path.startsWith("/limit/")) {
        return await handleLimit(request, path, env, corsHeaders);
      }

      // === Device Signup Tracking ===
      if (path.startsWith("/device-signup/")) {
        return await handleDeviceSignup(request, path, env, corsHeaders);
      }

      return new Response(JSON.stringify({ success: false, error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

// ==================== GEMINI ====================

async function handleGemini(request, env, corsHeaders) {
  const body = await request.json();
  const { prompt, systemMsg, maxTok } = body;

  if (!prompt) {
    return new Response(JSON.stringify({ success: false, error: "Prompt required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parts = [];
  if (systemMsg) parts.push({ text: systemMsg });
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: maxTok || 8192,
        temperature: 0.3,
      },
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    return new Response(JSON.stringify({
      success: false,
      error: data.error?.message || "Gemini API error",
      code: resp.status,
    }), { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!text) {
    return new Response(JSON.stringify({ success: false, error: "Empty response" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, text }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ==================== GROQ ====================

async function handleGroq(request, env, path, corsHeaders) {
  const body = await request.json();
  const groqUrl = `https://api.groq.com/openai/v1/chat/completions`;

  const resp = await fetch(groqUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: body.model || "llama-3.1-8b-instant",
      messages: body.messages || [],
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens || 8192,
      stream: body.stream || false,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return new Response(JSON.stringify({ success: false, error: err, code: resp.status }), {
      status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await resp.json();

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ==================== OPENROUTER ====================

async function handleOpenRouter(request, env, path, corsHeaders) {
  const body = await request.json();
  const orUrl = `https://openrouter.ai/api/v1/chat/completions`;

  const resp = await fetch(orUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": request.headers.get("Origin") || "https://ai-talk.app",
      "X-Title": "AI Talk Platform",
    },
    body: JSON.stringify({
      model: body.model || "meta-llama/llama-3.1-8b-instruct",
      messages: body.messages || [],
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens || 8192,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return new Response(JSON.stringify({ success: false, error: err, code: resp.status }), {
      status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const data = await resp.json();

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ==================== DAILY USAGE LIMITS ====================

async function handleLimit(request, path, env, corsHeaders) {
  const action = path.replace("/limit/", "");

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { email, date, usage } = body;

  if (!email || !date) {
    return new Response(JSON.stringify({ success: false, error: "email and date required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = `limit_${email}_${date}`;

  // Use env.KV if available, otherwise use in-memory (dev only)
  const storage = env.LIMITS_KV ? {
    get: (k) => env.LIMITS_KV.get(k, "json"),
    put: (k, v) => env.LIMITS_KV.put(k, JSON.stringify(v)),
  } : new Map();

  if (action === "get") {
    let data;
    if (storage instanceof Map) {
      data = storage.get(key);
    } else {
      data = await storage.get(key);
    }
    return new Response(JSON.stringify({ success: true, usage: data || {} }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "set") {
    if (storage instanceof Map) {
      storage.set(key, usage || {});
    } else {
      await storage.put(key, usage || {});
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "all") {
    // Return all usage data (admin only)
    return new Response(JSON.stringify({ success: true, data: {} }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: false, error: "Unknown action" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ==================== DEVICE SIGNUP ====================

async function handleDeviceSignup(request, path, env, corsHeaders) {
  const action = path.replace("/device-signup/", "");

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { deviceId, weekKey, email, maxAllowed } = body;

  if (!deviceId || !weekKey) {
    return new Response(JSON.stringify({ success: false, error: "deviceId and weekKey required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const storage = env.SIGNUP_KV ? {
    get: (k) => env.SIGNUP_KV.get(k, "json"),
    put: (k, v) => env.SIGNUP_KV.put(k, JSON.stringify(v)),
  } : new Map();

  const key = `device_${deviceId}_${weekKey}`;

  if (action === "check") {
    let data;
    if (storage instanceof Map) {
      data = storage.get(key) || { count: 0 };
    } else {
      data = (await storage.get(key)) || { count: 0 };
    }
    const allowed = !maxAllowed || data.count < maxAllowed;
    return new Response(JSON.stringify({ success: true, allowed, count: data.count, maxAllowed: maxAllowed || 2 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "claim") {
    let data;
    if (storage instanceof Map) {
      data = storage.get(key) || { count: 0, emails: [] };
      data.count++;
      if (email && !data.emails.includes(email)) data.emails.push(email);
      storage.set(key, data);
    } else {
      data = (await storage.get(key)) || { count: 0, emails: [] };
      data.count++;
      if (email && !data.emails.includes(email)) data.emails.push(email);
      await storage.put(key, data);
    }
    return new Response(JSON.stringify({ success: true, count: data.count }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: false, error: "Unknown action" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
