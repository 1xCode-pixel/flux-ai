require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Redis = require('ioredis');
const fetch = require('node-fetch');

// ==========================================
// 🔑 КЛЮЧИ (Только OpenRouter)
// ==========================================
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CREATOR_ID = "C8N-HPY";
const SECRET_SIGNATURE = "MY_VERY_SECRET_KEY_2025_FLUX";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// 💎 МОДЕЛИ С ЦЕНАМИ (Все :free на OpenRouter)
// ==========================================
const MODELS = {
    // Бесплатные (0 токенов)
    'google/gemini-2.0-flash-exp:free': { inputCost: 0, outputCost: 0, isFree: true, name: 'Gemini 2.0 Flash', provider: 'google', vision: false },
    'meta-llama/llama-3.3-70b-instruct:free': { inputCost: 0, outputCost: 0, isFree: true, name: 'Llama 3.3 70B', provider: 'meta', vision: false },
    'qwen/qwen-2-vl-7b-instruct:free': { inputCost: 0, outputCost: 0, isFree: true, name: 'Qwen 2 VL 7B', provider: 'qwen', vision: true },

    // Платные (списывают токены)
    'anthropic/claude-3.5-sonnet:free': { inputCost: 70, outputCost: 100, isFree: false, name: 'Claude 3.5 Sonnet', provider: 'anthropic', vision: false },
    'deepseek/deepseek-r1:free': { inputCost: 50, outputCost: 70, isFree: false, name: 'DeepSeek R1', provider: 'deepseek', vision: false },
    'meta-llama/llama-3.1-405b-instruct:free': { inputCost: 60, outputCost: 90, isFree: false, name: 'Llama 3.1 405B', provider: 'meta', vision: false },
    'meta-llama/llama-3.1-70b-instruct:free': { inputCost: 35, outputCost: 55, isFree: false, name: 'Llama 3.1 70B', provider: 'meta', vision: false },
    'meta-llama/llama-3.2-11b-vision-instruct:free': { inputCost: 25, outputCost: 40, isFree: false, name: 'Llama 3.2 11B Vision', provider: 'meta', vision: true },
    'meta-llama/llama-3.2-90b-vision-instruct:free': { inputCost: 45, outputCost: 70, isFree: false, name: 'Llama 3.2 90B Vision', provider: 'meta', vision: true },
    'qwen/qwen-2-vl-72b-instruct:free': { inputCost: 35, outputCost: 55, isFree: false, name: 'Qwen 2 VL 72B', provider: 'qwen', vision: true },
    'qwen/qwen-2.5-coder-32b-instruct:free': { inputCost: 40, outputCost: 60, isFree: false, name: 'Qwen 2.5 Coder 32B', provider: 'qwen', vision: false },
    'deepseek/deepseek-coder-33b-instruct:free': { inputCost: 40, outputCost: 65, isFree: false, name: 'DeepSeek Coder 33B', provider: 'deepseek', vision: false },
    'cohere/command-r-plus:free': { inputCost: 30, outputCost: 50, isFree: false, name: 'Command R+', provider: 'cohere', vision: false },
    'mistralai/mistral-nemo:free': { inputCost: 25, outputCost: 40, isFree: false, name: 'Mistral Nemo', provider: 'mistralai', vision: false },
    'mistralai/codestral-mamba:free': { inputCost: 30, outputCost: 50, isFree: false, name: 'Codestral Mamba', provider: 'mistralai', vision: false },
    'microsoft/phi-3-medium-128k-instruct:free': { inputCost: 25, outputCost: 40, isFree: false, name: 'Phi-3 Medium 128K', provider: 'microsoft', vision: false },
    'nousresearch/hermes-3-llama-3.1-405b:free': { inputCost: 55, outputCost: 85, isFree: false, name: 'Hermes 3 405B', provider: 'nousresearch', vision: false },
    'liquid/lfm-40b:free': { inputCost: 35, outputCost: 55, isFree: false, name: 'LFM 40B', provider: 'liquid', vision: false },
    'google/gemini-flash-1.5:free': { inputCost: 15, outputCost: 30, isFree: false, name: 'Gemini Flash 1.5', provider: 'google', vision: false },
    'google/gemini-pro-vision:free': { inputCost: 40, outputCost: 60, isFree: false, name: 'Gemini Pro Vision', provider: 'google', vision: true },
    'google/gemini-2.0-flash-thinking-exp:free': { inputCost: 50, outputCost: 80, isFree: false, name: 'Gemini 2.0 Thinking', provider: 'google', vision: false },
    'google/gemma-2-9b-it:free': { inputCost: 20, outputCost: 35, isFree: false, name: 'Gemma 2 9B', provider: 'google', vision: false }
};

// ==========================================
// 🔑 КОДЫ АКТИВАЦИИ
// ==========================================
const ACTIVATION_CODES = {
    'ADMIN_1XCODE_2026': { tokens: 100000, isAdmin: true },
    'GIVE_5000_TOKENS': { tokens: 5000, isAdmin: false },
    'GIVE_1000_TOKENS': { tokens: 1000, isAdmin: false },
    'FREE_500': { tokens: 500, isAdmin: false },
    'PREMIUM_10K': { tokens: 10000, isAdmin: false },
    'ULTRA_50K': { tokens: 50000, isAdmin: false }
};

// ==========================================
// 🛠 ХЕЛПЕРЫ
// ==========================================
function generateSignature(text) { 
    return crypto.createHmac('sha256', SECRET_SIGNATURE).update(text).digest('hex').substring(0, 10).toUpperCase(); 
}

async function getUserData(uid) { 
    if (!redis) return { tokens: 1000, isAdmin: false, activatedCodes: [] };
    const data = await redis.get(`user:${uid}`);
    return data ? JSON.parse(data) : { tokens: 1000, isAdmin: false, activatedCodes: [] };
}

async function saveUserData(uid, data) { 
    if (redis) await redis.set(`user:${uid}`, JSON.stringify(data));
}

// Подсчёт токенов (примерно 4 символа = 1 токен)
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

// Расчёт стоимости
function calculateCost(inputTokens, outputTokens, modelId) {
    const model = MODELS[modelId];
    if (!model || model.isFree) return 0;

    const inputCost = (inputTokens / 1000) * model.inputCost;
    const outputCost = (outputTokens / 1000) * model.outputCost;

    return Math.ceil(inputCost + outputCost);
}

// ==========================================
// 📊 API: Список моделей
// ==========================================
app.get('/api/models', (req, res) => {
    const modelsList = Object.entries(MODELS).map(([id, data]) => ({
        id,
        name: data.name,
        provider: data.provider,
        inputCost: data.inputCost,
        outputCost: data.outputCost,
        isFree: data.isFree,
        supportsVision: data.vision,
        supportsText: true
    }));

    res.json({ success: true, models: modelsList });
});

// ==========================================
// 💎 API: Баланс токенов
// ==========================================
app.get('/api/balance', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: 'User ID required' });

    const user = await getUserData(uid);
    res.json({ 
        success: true, 
        tokens: user.tokens, 
        isAdmin: user.isAdmin || uid === CREATOR_ID
    });
});

// ==========================================
// 🔑 API: Активация кода
// ==========================================
app.post('/api/activate', async (req, res) => {
    const { uid, code } = req.body;

    if (!uid || !code) {
        return res.status(400).json({ error: 'User ID and code required' });
    }

    const user = await getUserData(uid);
    const codeData = ACTIVATION_CODES[code];

    if (!codeData) {
        return res.status(404).json({ error: 'Неверный код' });
    }

    // Проверка на повторное использование
    if (user.activatedCodes && user.activatedCodes.includes(code)) {
        return res.status(400).json({ error: 'Код уже использован' });
    }

    // Активация
    user.tokens += codeData.tokens;
    if (codeData.isAdmin) {
        user.isAdmin = true;
    }

    if (!user.activatedCodes) user.activatedCodes = [];
    user.activatedCodes.push(code);

    await saveUserData(uid, user);

    res.json({
        success: true,
        message: 'Код активирован!',
        tokensAdded: codeData.tokens,
        newBalance: user.tokens,
        isAdmin: user.isAdmin
    });
});

// ==========================================
// 👑 API: Админ - Выдать токены
// ==========================================
app.post('/api/admin/give-tokens', async (req, res) => {
    const { adminUid, targetUid, amount } = req.body;

    if (!adminUid || !targetUid || !amount) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const admin = await getUserData(adminUid);
    if (!admin.isAdmin && adminUid !== CREATOR_ID) {
        return res.status(403).json({ error: 'Требуются права администратора' });
    }

    const target = await getUserData(targetUid);
    target.tokens += parseInt(amount);

    await saveUserData(targetUid, target);

    res.json({
        success: true,
        message: `Выдано ${amount} токенов пользователю ${targetUid}`,
        newBalance: target.tokens
    });
});

// ==========================================
// 🤖 API: ЧАТ С ТОКЕНАМИ
// ==========================================
app.post('/api/chat', async (req, res) => {
    const { message, file, uid, selectedModel } = req.body;

    if (!uid || !message) {
        return res.status(400).json({ error: 'User ID and message required' });
    }

    // Получаем данные пользователя
    let user = await getUserData(uid);

    // Если админ - даём неограниченные токены
    if (uid === CREATOR_ID) {
        user.isAdmin = true;
        user.tokens = 999999999;
    }

    // Проверяем модель
    const modelId = selectedModel || 'google/gemini-2.0-flash-exp:free';
    const modelData = MODELS[modelId];

    if (!modelData) {
        return res.status(400).json({ error: 'Модель не найдена' });
    }

    // Подсчёт входящих токенов
    const inputTokens = estimateTokens(message);

    // Проверка баланса (если модель платная и не админ)
    if (!modelData.isFree && !user.isAdmin) {
        const estimatedCost = calculateCost(inputTokens, inputTokens * 2, modelId);

        if (user.tokens < estimatedCost) {
            return res.json({ 
                reply: `⛔ Недостаточно токенов!\n\nНужно: ${estimatedCost}\nДоступно: ${user.tokens}\n\n💡 Активируйте код для пополнения`,
                error: 'insufficient_tokens',
                required: estimatedCost,
                available: user.tokens
            });
        }
    }

    // Формируем запрос
    let messages = [];

    if (file && modelData.vision) {
        messages.push({
            role: "user",
            content: [
                { type: "text", text: message },
                { type: "image_url", image_url: { url: file } }
            ]
        });
    } else {
        messages.push({ role: "user", content: message });
    }

    try {
        // Отправляем в OpenRouter
        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://flux-ai.vercel.app",
                "X-Title": "Flux AI"
            },
            body: JSON.stringify({
                model: modelId,
                messages: messages
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter error:', errorText);
            return res.json({ reply: "❌ Ошибка API. Попробуйте другую модель." });
        }

        const data = await response.json();
        const aiReply = data.choices?.[0]?.message?.content || "Нет ответа";

        // Подсчёт выходящих токенов
        const outputTokens = estimateTokens(aiReply);

        // Списываем токены (если платная модель и не админ)
        let tokensUsed = 0;
        if (!modelData.isFree && !user.isAdmin) {
            tokensUsed = calculateCost(inputTokens, outputTokens, modelId);
            user.tokens -= tokensUsed;
            await saveUserData(uid, user);
        }

        res.json({
            reply: aiReply,
            tokens: {
                input: inputTokens,
                output: outputTokens,
                used: tokensUsed,
                remaining: user.tokens
            }
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.json({ reply: "❌ Ошибка сети. Попробуйте позже." });
    }
});

// ==========================================
// ✅ СТАТУС
// ==========================================
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online', 
        redis: !!redis,
        models: Object.keys(MODELS).length
    });
});

// ==========================================
// 🚀 ЗАПУСК
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Flux AI запущен на порту ${PORT}`);
    console.log(`💎 Моделей: ${Object.keys(MODELS).length}`);
    console.log(`🔑 Кодов активации: ${Object.keys(ACTIVATION_CODES).length}`);
});

module.exports = app;



























